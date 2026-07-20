/**
 * Backfill Cache-Control on existing Firebase Storage objects.
 *
 * Usage:
 *   node --env-file=.env.production scripts/backfill-storage-cache-control.mjs --dry-run
 *   node --env-file=.env.production scripts/backfill-storage-cache-control.mjs --apply
 *
 * Default is dry-run. Does not change object bytes or tokens.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import fs from 'fs';

const CACHE_CONTROL = 'public, max-age=31536000, immutable';

function parseServiceAccount(value) {
  if (!value) return null;
  const trimmed = value.trim();
  const candidates = [trimmed];
  if (trimmed.endsWith('.json') && fs.existsSync(trimmed)) {
    candidates.push(fs.readFileSync(trimmed, 'utf8'));
  }
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (!parsed.projectId && parsed.project_id) parsed.projectId = parsed.project_id;
      return parsed;
    } catch {
      /* next */
    }
  }
  return null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const sa = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '');

  if (!bucketName) {
    console.error('Missing NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET');
    process.exit(1);
  }

  if (!getApps().length) {
    initializeApp({
      credential: sa ? cert(sa) : undefined,
      projectId: projectId || sa?.projectId,
      storageBucket: bucketName,
    });
  }

  const bucket = getStorage().bucket(bucketName);
  const [files] = await bucket.getFiles({ autoPaginate: true });
  const objects = files.filter((f) => f.name && !f.name.endsWith('/'));

  let alreadyOk = 0;
  let toUpdate = 0;
  let updated = 0;
  let failed = 0;

  console.log(`\n=== Backfill cacheControl ===`);
  console.log(`Bucket: ${bucketName}`);
  console.log(`Mode:   ${dryRun ? 'DRY-RUN (pass --apply to write)' : 'APPLY'}`);
  console.log(`Target: ${CACHE_CONTROL}`);
  console.log(`Objects: ${objects.length}\n`);

  for (const file of objects) {
    const current = file.metadata?.cacheControl || '';
    if (current.includes('max-age=31536000')) {
      alreadyOk += 1;
      continue;
    }
    toUpdate += 1;
    if (dryRun) {
      if (toUpdate <= 15) {
        console.log(`  would update: ${file.name} (was: ${current || '(none)'})`);
      }
      continue;
    }
    try {
      await file.setMetadata({ cacheControl: CACHE_CONTROL });
      updated += 1;
      if (updated <= 20 || updated % 50 === 0) {
        console.log(`  updated (${updated}): ${file.name}`);
      }
    } catch (err) {
      failed += 1;
      console.warn(`  FAIL ${file.name}:`, err.message);
    }
  }

  if (dryRun && toUpdate > 15) {
    console.log(`  ... and ${toUpdate - 15} more`);
  }

  console.log(`\nAlready had long cacheControl: ${alreadyOk}`);
  console.log(`Need update: ${toUpdate}`);
  if (!dryRun) {
    console.log(`Updated: ${updated}`);
    console.log(`Failed:  ${failed}`);
  } else {
    console.log(`(No changes written. Re-run with --apply to backfill.)`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

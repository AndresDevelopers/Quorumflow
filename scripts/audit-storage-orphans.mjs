/**
 * Audit Firebase Storage vs Firestore image references.
 *
 * Usage (from repo root):
 *   node --env-file=.env.local scripts/audit-storage-orphans.mjs
 *   node --env-file=.env.production scripts/audit-storage-orphans.mjs
 *
 * Read-only: lists orphan candidates, does NOT delete.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import fs from 'fs';

function parseServiceAccount(value) {
  if (!value) return null;
  const trimmed = value.trim();
  const candidates = [trimmed];
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    candidates.push(trimmed.slice(1, -1));
  }
  const compact = trimmed.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length % 4 === 0) {
    try {
      candidates.push(Buffer.from(compact, 'base64').toString('utf8'));
    } catch {
      /* ignore */
    }
  }
  if (trimmed.endsWith('.json') && fs.existsSync(trimmed)) {
    candidates.push(fs.readFileSync(trimmed, 'utf8'));
  }
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (!parsed.projectId && parsed.project_id) parsed.projectId = parsed.project_id;
      return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Extract Storage object path from a download URL or return path-like strings as-is. */
function extractStoragePath(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;

  // Already a path (legacy or photoPath field)
  if (
    !v.startsWith('http') &&
    (v.startsWith('users/') ||
      v.startsWith('profile_pictures/') ||
      v.startsWith('members/') ||
      v.includes('/'))
  ) {
    return decodeURIComponent(v.split('?')[0]);
  }

  try {
    const u = new URL(v);
    // https://firebasestorage.googleapis.com/v0/b/BUCKET/o/ENCODED_PATH?alt=media&token=...
    const oIdx = u.pathname.indexOf('/o/');
    if (oIdx >= 0) {
      return decodeURIComponent(u.pathname.slice(oIdx + 3));
    }
    // https://storage.googleapis.com/BUCKET/path
    if (u.hostname === 'storage.googleapis.com') {
      const parts = u.pathname.replace(/^\//, '').split('/');
      if (parts.length >= 2) return parts.slice(1).join('/');
    }
    // https://BUCKET.storage.googleapis.com/path
    if (u.hostname.endsWith('.storage.googleapis.com')) {
      return u.pathname.replace(/^\//, '');
    }
  } catch {
    /* not a URL */
  }
  return null;
}

function addRef(set, value, source) {
  if (Array.isArray(value)) {
    for (const item of value) addRef(set, item, source);
    return;
  }
  const path = extractStoragePath(value);
  if (path) set.set(path, (set.get(path) || 0) + 1);
  void source;
}

const COLLECTIONS = [
  { name: 'c_miembros', fields: ['photoURL', 'baptismPhotos', 'imageUrls'] },
  { name: 'c_users', fields: ['photoURL'] },
  { name: 'c_conversos', fields: ['photoURL'] },
  { name: 'converts', fields: ['photoURL'] },
  { name: 'c_futuros_miembros', fields: ['photoURL', 'baptismPhotos'] },
  { name: 'c_cumpleanos', fields: ['photoURL'] },
  { name: 'c_bautismos', fields: ['photoURL', 'baptismPhotos'] },
  { name: 'c_actividades', fields: ['imageUrls'] },
  { name: 'c_servicios', fields: ['imageUrls'] },
  { name: 'c_obra_misional_imagenes', fields: ['imageUrl'] },
  { name: 'c_observaciones_salud', fields: ['photoURL', 'photoPath'] },
  { name: 'c_donate_config', fields: ['qrImageUrl'] },
  { name: 'c_reporte_anual', fields: ['imageUrl', 'imageUrls', 'photoURL', 'fileUrl'] },
];

// Also scan Auth user photoURL via Firestore c_users only (Auth bulk is separate).

async function main() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const sa = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '');

  if (!bucketName) {
    console.error('Missing NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET');
    process.exit(1);
  }
  if (!sa && !projectId) {
    console.error('Missing FIREBASE_SERVICE_ACCOUNT_KEY / project id');
    process.exit(1);
  }

  if (!getApps().length) {
    initializeApp({
      credential: sa ? cert(sa) : undefined,
      projectId: projectId || sa?.projectId,
      storageBucket: bucketName,
    });
  }

  const db = getFirestore();
  const bucket = getStorage().bucket(bucketName);

  console.log(`\n=== Storage orphan audit ===`);
  console.log(`Project: ${projectId || sa?.projectId}`);
  console.log(`Bucket:  ${bucketName}`);
  console.log(`Mode:    read-only (no deletes)\n`);

  // 1) Collect referenced paths from Firestore
  const referenced = new Map(); // path -> ref count
  const fieldHits = {};

  for (const { name, fields } of COLLECTIONS) {
    fieldHits[name] = { docs: 0, refs: 0 };
    try {
      const snap = await db.collection(name).get();
      fieldHits[name].docs = snap.size;
      for (const doc of snap.docs) {
        const data = doc.data();
        for (const field of fields) {
          const before = referenced.size;
          addRef(referenced, data[field], `${name}/${doc.id}.${field}`);
          // count new-ish refs roughly
          if (data[field]) {
            if (Array.isArray(data[field])) {
              fieldHits[name].refs += data[field].filter(Boolean).length;
            } else if (typeof data[field] === 'string' && data[field].trim()) {
              fieldHits[name].refs += 1;
            }
          }
          void before;
        }
      }
    } catch (err) {
      console.warn(`  ! could not read ${name}:`, err.message);
    }
  }

  console.log('Firestore collections scanned:');
  for (const [name, info] of Object.entries(fieldHits)) {
    console.log(`  ${name}: ${info.docs} docs, ~${info.refs} image field values`);
  }
  console.log(`  Unique Storage paths referenced: ${referenced.size}\n`);

  // 2) List all Storage objects
  const [files] = await bucket.getFiles({ autoPaginate: true });
  const objects = files.filter((f) => f.name && !f.name.endsWith('/'));

  let totalBytes = 0;
  const byPrefix = {};
  const orphanPaths = [];
  const orphanBytes = [];
  const missingCacheControl = [];
  const withCacheControl = [];

  for (const file of objects) {
    const meta = file.metadata || {};
    const size = Number(meta.size || 0);
    totalBytes += size;

    const top = file.name.split('/')[0] || '(root)';
    const second = file.name.split('/')[1];
    const prefix =
      top === 'users' && second
        ? `users/*/${file.name.split('/').slice(2, 3)[0] || ''}`
        : top;
    // Better grouping: users/{uid}/category → category under users
    let group = top;
    if (top === 'users') {
      const parts = file.name.split('/');
      // users/uid/category/... or users/uid/profile_pictures/users/...
      if (parts.length >= 3) {
        if (parts[2] === 'profile_pictures' && parts[3]) {
          group = `users/*/profile_pictures/${parts[3]}`;
        } else {
          group = `users/*/${parts[2]}`;
        }
      } else {
        group = 'users/*';
      }
    }
    if (!byPrefix[group]) byPrefix[group] = { count: 0, bytes: 0 };
    byPrefix[group].count += 1;
    byPrefix[group].bytes += size;

    const cc = meta.cacheControl || meta.cache_control || '';
    if (cc) withCacheControl.push(file.name);
    else missingCacheControl.push(file.name);

    if (!referenced.has(file.name)) {
      orphanPaths.push(file.name);
      orphanBytes.push(size);
    }
  }

  const orphanTotalBytes = orphanBytes.reduce((a, b) => a + b, 0);
  const fmt = (n) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  };

  console.log(`Storage objects: ${objects.length}`);
  console.log(`Total size:      ${fmt(totalBytes)}`);
  console.log(`With cacheControl metadata: ${withCacheControl.length}`);
  console.log(`Missing cacheControl:       ${missingCacheControl.length}`);
  console.log('');

  console.log('By path group:');
  for (const [g, info] of Object.entries(byPrefix).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${g}: ${info.count} objects, ${fmt(info.bytes)}`);
  }

  // Referenced but missing from Storage
  const missingFromStorage = [...referenced.keys()].filter(
    (p) => !objects.some((f) => f.name === p)
  );

  console.log(`\nReferenced paths not found in bucket: ${missingFromStorage.length}`);
  if (missingFromStorage.length && missingFromStorage.length <= 20) {
    for (const p of missingFromStorage) console.log(`  - ${p}`);
  } else if (missingFromStorage.length > 20) {
    for (const p of missingFromStorage.slice(0, 15)) console.log(`  - ${p}`);
    console.log(`  ... and ${missingFromStorage.length - 15} more`);
  }

  console.log(`\nOrphan candidates (in Storage, not referenced in scanned fields): ${orphanPaths.length}`);
  console.log(`Orphan total size: ${fmt(orphanTotalBytes)}`);

  if (orphanPaths.length) {
    // Sample largest orphans
    const ranked = orphanPaths
      .map((p, i) => ({ path: p, size: orphanBytes[i] }))
      .sort((a, b) => b.size - a.size);
    console.log('\nLargest orphan candidates (top 25):');
    for (const item of ranked.slice(0, 25)) {
      console.log(`  ${fmt(item.size).padStart(10)}  ${item.path}`);
    }
    if (ranked.length > 25) {
      console.log(`  ... and ${ranked.length - 25} more`);
    }
  }

  // Write full report next to script for review
  const report = {
    projectId: projectId || sa?.projectId,
    bucket: bucketName,
    scannedAt: new Date().toISOString(),
    storageObjectCount: objects.length,
    totalBytes,
    referencedPathCount: referenced.size,
    orphanCount: orphanPaths.length,
    orphanTotalBytes,
    missingFromStorageCount: missingFromStorage.length,
    missingCacheControlCount: missingCacheControl.length,
    withCacheControlCount: withCacheControl.length,
    byPrefix,
    orphanPaths: orphanPaths
      .map((p, i) => ({ path: p, size: orphanBytes[i] }))
      .sort((a, b) => b.size - a.size),
    missingFromStorage: missingFromStorage.slice(0, 200),
  };

  const outPath = 'scripts/storage-orphan-report.json';
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report written to ${outPath}`);
  console.log('(No objects were deleted.)\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

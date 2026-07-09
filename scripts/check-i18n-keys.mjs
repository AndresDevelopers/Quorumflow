#!/usr/bin/env node
/**
 * Scans src for t('key') / t("key") usage and compares against locale catalogs.
 * Also expands known dynamic key families used via template literals.
 *
 * Exit 0 if catalogs cover all keys and es/en key sets match.
 * Exit 1 otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src");
const esPath = path.join(root, "src/locales/es.json");
const enPath = path.join(root, "src/locales/en.json");

const KEY_RE = /\bt\(\s*(['"])([^'"`{}$]+)\1/g;
const TEMPLATE_RE = /\bt\(\s*`([^`$]*)\$\{/g;

/** Expand known dynamic families when prefix is used with ${...} */
const DYNAMIC_EXPANSIONS = {
  "churchChat.option.": [
    "presidente",
    "consejero",
    "secretario",
    "otrosCargos",
    "novedades",
  ],
  "reports.questions.": ["p1", "p2", "p3", "p4", "p5", "p6"],
  "role.": ["user", "counselor", "president", "secretary", "other"],
  "role.description.": ["user", "counselor", "president", "secretary", "other"],
  "permission.": ["read", "all"],
  "member.status.": ["active", "less_active", "inactive", "deceased"],
};

/** FAQ-style keys stored as string literals and passed via variables */
const LITERAL_KEY_RE =
  /['"]((?:familySearch|missionaryWork)\.faq\.[qa]\d+)['"]/g;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function collectKeys() {
  const keys = new Set();
  const dynPrefixes = new Set();

  for (const file of walk(srcDir)) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(KEY_RE)) {
      keys.add(m[2]);
    }
    for (const m of text.matchAll(TEMPLATE_RE)) {
      dynPrefixes.add(m[1]);
    }
    for (const m of text.matchAll(LITERAL_KEY_RE)) {
      keys.add(m[1]);
    }
  }

  for (const prefix of dynPrefixes) {
    const values = DYNAMIC_EXPANSIONS[prefix];
    if (values) {
      for (const v of values) keys.add(`${prefix}${v}`);
    } else if (prefix === "audit.action.") {
      // audit keys are defined in catalogs; prefix alone is not a key
      continue;
    }
  }

  // Always ensure known expansions exist even if regex misses a file
  for (const [prefix, values] of Object.entries(DYNAMIC_EXPANSIONS)) {
    for (const v of values) keys.add(`${prefix}${v}`);
  }

  return { keys, dynPrefixes: [...dynPrefixes].sort() };
}

function main() {
  const es = JSON.parse(fs.readFileSync(esPath, "utf8"));
  const en = JSON.parse(fs.readFileSync(enPath, "utf8"));
  const { keys, dynPrefixes } = collectKeys();

  const missingEs = [...keys].filter((k) => !(k in es)).sort();
  const missingEn = [...keys].filter((k) => !(k in en)).sort();
  const onlyEs = Object.keys(es)
    .filter((k) => !(k in en))
    .sort();
  const onlyEn = Object.keys(en)
    .filter((k) => !(k in es))
    .sort();

  const ok =
    missingEs.length === 0 &&
    missingEn.length === 0 &&
    onlyEs.length === 0 &&
    onlyEn.length === 0;

  console.log(`Scanned keys used in code: ${keys.size}`);
  console.log(`Dynamic prefixes found: ${dynPrefixes.join(", ") || "(none)"}`);
  console.log(`es.json keys: ${Object.keys(es).length}`);
  console.log(`en.json keys: ${Object.keys(en).length}`);
  console.log(`Missing in es.json: ${missingEs.length}`);
  console.log(`Missing in en.json: ${missingEn.length}`);
  console.log(`Only in es (not en): ${onlyEs.length}`);
  console.log(`Only in en (not es): ${onlyEn.length}`);

  if (missingEs.length) {
    console.log("\n--- Missing es ---");
    missingEs.forEach((k) => console.log(k));
  }
  if (missingEn.length) {
    console.log("\n--- Missing en ---");
    missingEn.forEach((k) => console.log(k));
  }
  if (onlyEs.length) {
    console.log("\n--- Only es ---");
    onlyEs.forEach((k) => console.log(k));
  }
  if (onlyEn.length) {
    console.log("\n--- Only en ---");
    onlyEn.forEach((k) => console.log(k));
  }

  if (!ok) {
    process.exit(1);
  }
  console.log("\n✓ i18n catalogs OK");
}

main();

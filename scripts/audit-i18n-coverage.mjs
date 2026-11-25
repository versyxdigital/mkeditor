#!/usr/bin/env node
/**
 * One-off audit: scan `src/` for every `t('namespace:key')` /
 * `t("namespace:key")` call, then check whether the key exists in
 * each locale's combined `all.json`. Reports:
 *
 *   1. Keys that exist in the English baseline but are missing in
 *      one or more other locales.
 *   2. Keys referenced from source but absent EVERYWHERE (typos /
 *      dead links / never-translated additions).
 *
 * Reads only the combined `all.json` per locale; the per-namespace
 * files are the source of truth but the combined file is what
 * runtime actually loads.
 */
import fs from 'fs';
import path from 'path';

const SRC_ROOT = 'src';
const LOCALE_ROOT = 'locale';

// Plain ASCII chars + dot + dash, then a `:` separator.
const KEY_RE = /\bt\(\s*['"`]([a-z][a-z0-9_-]*):([a-zA-Z0-9_]+)['"`]/g;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
    ) {
      yield full;
    }
  }
}

// 1. Collect used keys.
const usedKeys = new Map(); // "namespace:key" -> Set<file>
for (const file of walk(SRC_ROOT)) {
  const text = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = KEY_RE.exec(text))) {
    const ns = match[1];
    const key = match[2];
    const full = `${ns}:${key}`;
    if (!usedKeys.has(full)) usedKeys.set(full, new Set());
    usedKeys.get(full).add(file);
  }
}

// 2. Load every locale's combined translations.
const locales = fs
  .readdirSync(LOCALE_ROOT)
  .filter((n) => {
    const allJson = path.join(LOCALE_ROOT, n, 'all.json');
    return (
      fs.statSync(path.join(LOCALE_ROOT, n)).isDirectory() &&
      fs.existsSync(allJson)
    );
  })
  .sort();

const localeData = {};
for (const lang of locales) {
  localeData[lang] = JSON.parse(
    fs.readFileSync(path.join(LOCALE_ROOT, lang, 'all.json'), 'utf8'),
  );
}

// 3. Helper to check existence in a locale's namespaced data.
function has(localeJson, ns, key) {
  const nsObj = localeJson[ns];
  if (!nsObj || typeof nsObj !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(nsObj, key);
}

// 4. Report missing keys per locale.
const missingPerLocale = {};
const missingEverywhere = [];

const sortedUsedKeys = [...usedKeys.keys()].sort();
for (const full of sortedUsedKeys) {
  const [ns, key] = full.split(':');
  const presence = locales.map((lang) => has(localeData[lang], ns, key));
  const presentSomewhere = presence.some(Boolean);
  if (!presentSomewhere) {
    missingEverywhere.push(full);
    continue;
  }
  for (let i = 0; i < locales.length; i++) {
    if (presence[i]) continue;
    const lang = locales[i];
    (missingPerLocale[lang] ||= []).push(full);
  }
}

// 5. Print report.
console.log(
  `\nScanned ${usedKeys.size} unique t(...) keys across the ${
    [...new Set([...usedKeys.values()].flatMap((s) => [...s]))].length
  } source files that reference them.\n`,
);

if (missingEverywhere.length > 0) {
  console.log(
    `▸ ${missingEverywhere.length} keys are referenced from source but absent from EVERY locale (typo, dead reference, or never translated):\n`,
  );
  for (const k of missingEverywhere) {
    console.log(`    ${k}`);
    for (const file of usedKeys.get(k)) console.log(`      ↳ ${file}`);
  }
  console.log('');
}

for (const lang of locales) {
  const missing = missingPerLocale[lang];
  if (!missing || missing.length === 0) {
    console.log(`  [${lang}] ✓ all referenced keys present`);
    continue;
  }
  console.log(`  [${lang}] missing ${missing.length}:`);
  for (const k of missing) console.log(`      ${k}`);
}

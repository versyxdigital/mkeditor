#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';

async function isDirectory(p) {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function readJson(file) {
  const content = await fs.readFile(file, 'utf8');
  return JSON.parse(content);
}

async function walkJsonFiles(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkJsonFiles(full);
      out.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

function toNamespace(langDir, filePath) {
  const rel = path.relative(langDir, filePath);
  const noExt = rel.replace(/\\/g, '/').replace(/\.json$/i, '');
  return noExt.split('/').join('-');
}

async function combineLanguage(langDir) {
  const files = (await walkJsonFiles(langDir)).filter(
    (f) => !f.endsWith(`${path.sep}all.json`),
  );
  const combined = {};
  for (const file of files) {
    const ns = toNamespace(langDir, file);
    try {
      const data = await readJson(file);
      if (data && typeof data === 'object') {
        combined[ns] = data;
      }
    } catch (e) {
      console.warn(`Skipping invalid JSON: ${file}:`, e.message);
    }
  }
  const outFile = path.join(langDir, 'all.json');
  await fs.writeFile(outFile, JSON.stringify(combined, null, 2) + '\n', 'utf8');
  return { count: Object.keys(combined).length, outFile };
}

async function main() {
  const root = path.resolve(process.cwd(), 'locale');
  if (!(await isDirectory(root))) {
    console.error('No locale directory found at', root);
    process.exit(1);
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const langs = entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name));
  if (langs.length === 0) {
    console.warn('No language folders found under locale/. Nothing to do.');
    return;
  }
  let total = 0;
  for (const langDir of langs) {
    const { count, outFile } = await combineLanguage(langDir);
    total += count;
    console.log(
      `Wrote ${count} namespaces to ${path.relative(process.cwd(), outFile)}`,
    );
  }
  console.log(`Done. Combined namespaces across ${langs.length} languages.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Copies the built data the app reads at runtime into public/data/ (served as static files).
 * Nothing is transformed: the app uses exactly the files the engines and tests use.
 *   ../dist/syllabus.json, ../dist/weightage/<exam>.json        (Phase 1–2 build output)
 *   ../data/mapping/{master-topics,cross-exam-mapping,config}.json   (Phase 4)
 *   ../data/progress/config.json, ../data/planner/config.json      (Phase 3, 5 defaults)
 * Runs `npm run build` in the project root first when dist/ is missing.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '..');
const OUT = join(APP, 'public', 'data');

if (!existsSync(join(ROOT, 'dist', 'syllabus.json')) || !existsSync(join(ROOT, 'dist', 'weightage'))) {
  console.log('dist/ missing: running the data build in the project root …');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'weightage'), { recursive: true });
const copy = (from, to) => cpSync(join(ROOT, from), join(OUT, to));
copy('dist/syllabus.json', 'syllabus.json');
for (const f of readdirSync(join(ROOT, 'dist', 'weightage')).filter((f) => f.endsWith('.json'))) copy(`dist/weightage/${f}`, `weightage/${f}`);
for (const f of ['master-topics.json', 'cross-exam-mapping.json', 'config.json']) copy(`data/mapping/${f}`, `mapping-${f}`);
copy('data/progress/config.json', 'progress-config.json');
copy('data/planner/config.json', 'planner-config.json');
const files = readdirSync(OUT, { recursive: true }).filter((f) => String(f).endsWith('.json'));
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), files: files.map(String).sort() }, null, 2));
const size = files.reduce((a, f) => a + statSync(join(OUT, String(f))).size, 0);
console.log(`synced ${files.length} data files (${(size / 1048576).toFixed(1)} MB) → public/data/`);

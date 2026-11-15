// Shared helpers for the weightage seed and build scripts.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA = join(ROOT, 'data');
export const DIST = join(ROOT, 'dist');
export const WDIR = join(DATA, 'weightage');

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function loadSyllabus() {
  const p = join(DIST, 'syllabus.json');
  if (!existsSync(p)) throw new Error('dist/syllabus.json missing. Run `npm run build:data` first.');
  return readJson(p);
}

/** Round non-negative values to `decimals` so that they sum exactly to `total` (largest-remainder method). */
export function roundToTotal(values, total = 100, decimals = 2) {
  const f = 10 ** decimals;
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('roundToTotal: values sum to 0');
  const exact = values.map((v) => (v / sum) * total * f);
  const floors = exact.map(Math.floor);
  let rest = Math.round(total * f) - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < order.length && rest > 0; k++, rest--) floors[order[k][1]]++;
  return floors.map((v) => v / f);
}

export const effective = (w) => (w.custom ?? w.default);
export const round2 = (x) => Math.round(x * 100) / 100;
export const round4 = (x) => Math.round(x * 10000) / 10000;

/** Stage is a pass/fail gate (weight 0 in every track). */
export function isGateStage(stage) {
  if (['physical', 'medical', 'assessment', 'language-test'].includes(stage.mode)) return true;
  return !stage.sections.some((s) => typeof s.marks === 'number' && s.marks > 0);
}

/** Total marks of a stage (choice groups counted once). */
export function stageMarks(stage) {
  const seen = new Set();
  let m = 0;
  for (const s of stage.sections) {
    if (s.choiceGroup) { if (seen.has(s.choiceGroup)) continue; seen.add(s.choiceGroup); }
    if (typeof s.marks === 'number') m += s.marks;
  }
  return m;
}

/** Sum of section weights counting each choice group once (uses the first member's weight). */
export function sumSections(sections, get) {
  const seen = new Set();
  let total = 0;
  for (const s of sections) {
    if (s.choiceGroup) { if (seen.has(s.choiceGroup)) continue; seen.add(s.choiceGroup); }
    total += get(s);
  }
  return total;
}

// Ad-hoc visual check: node e2e/shots.mjs [baseURL] → screenshots of every page (desktop light/dark + mobile) into test-results/shots
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = 'test-results/shots';
mkdirSync(out, { recursive: true });
const routes = ['dashboard', 'syllabus', 'compare', 'common', 'priorities', 'planner', 'revision', 'practice', 'settings'];
const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];

async function seed(page) {
  await page.waitForFunction(() => window.__store?.status === 'ready');
  await page.evaluate(async () => {
    const store = window.__store; const e = store.engine; const today = store.today();
    const day = (n) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
    await store.planner.setTargets([{ examId: 'ssc-cgl', importance: 60 }, { examId: 'sbi-po', importance: 40 }]);
    await e.switchExam('sbi-po');
    e.setStatus('quant.simplification', 'practicing');
    e.recordPractice('quant.simplification', { attempted: 30, correct: 27, timeSeconds: 1650, stageId: 'prelims', date: day(16) });
    for (const [d, c] of [[14, 8], [12, 8], [10, 8], [4, 4], [3, 5], [2, 4]]) { e.setStatus('reasoning.seating-arrangement', 'practicing'); e.recordPractice('reasoning.seating-arrangement', { attempted: 10, correct: c, timeSeconds: 700, stageId: 'prelims', date: day(d) }); }
    await e.switchExam('ssc-cgl');
    e.updateConcept('quant.percentage', { status: 'concept-completed' });
    e.setStatus('quant.percentage', 'practicing');
    e.recordPractice('quant.percentage', { attempted: 40, correct: 33, timeSeconds: 1500, stageId: 'tier1', date: day(20) });
    e.setStatus('quant.ratio-proportion', 'completed');
    e.recordPractice('quant.ratio-proportion', { attempted: 25, correct: 22, timeSeconds: 900, stageId: 'tier1', date: day(18) });
    e.setStatus('reasoning.coding-decoding', 'practicing');
    e.recordPractice('reasoning.coding-decoding', { attempted: 20, correct: 9, timeSeconds: 700, stageId: 'tier1', date: day(12) });
    e.recordPractice('reasoning.coding-decoding', { attempted: 20, correct: 10, timeSeconds: 650, stageId: 'tier1', date: day(8) });
    e.setStatus('english.synonyms-antonyms', 'learning');
    e.addRevision('quant.percentage', { date: day(6) });
    await store.planner.generateDailyPlan(today);
    // history points on two days so the trend renders
    store.history = { schemaVersion: 1, kind: 'history', exams: {} };
    await store.flush(); await store.recordHistory();
  });
}

for (const [name, viewport, scheme] of [['desktop', { width: 1440, height: 900 }, 'light'], ['dark', { width: 1440, height: 900 }, 'dark'], ['mobile', { width: 390, height: 844 }, 'light']]) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await page.goto(base);
  if (name === 'desktop') await page.screenshot({ path: `${out}/welcome.png` });
  await seed(page);
  for (const r of routes) {
    await page.goto(`${base}#/${r}`);
    await page.waitForTimeout(700);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) errors.push(`[${name}] ${r}: horizontal overflow ${overflow}px`);
    await page.screenshot({ path: `${out}/${name}-${r}.png`, fullPage: name !== 'mobile' });
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no console errors, no horizontal overflow');

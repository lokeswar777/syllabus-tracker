// Phase 7 final system tests: persistence (IndexedDB), backup/restore, CSV, recovery, migration.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedThroughEngines } from './seed';

type W = { __store: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
// runs fn(window.__store) in the page (the app's real store and engines)
const store = <T,>(page: Page, fn: (s: any) => T) => page.evaluate(`(${fn.toString()})(window.__store)`) as Promise<Awaited<T>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ready = (page: Page) => page.waitForFunction(() => (window as unknown as W).__store?.status === 'ready');
const saved = (page: Page) => expect(page.getByTestId('save-state')).not.toContainText(/Saving|failed/);
const tmp = join('test-results', 'files');
async function chooseExam(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByTestId('page-dashboard')).toBeVisible(); // exam loaded
}
mkdirSync(tmp, { recursive: true });

async function downloadBackup(page: Page) {
  await page.goto('./#/settings?section=data');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
  const path = join(tmp, `${Date.now()}-${dl.suggestedFilename()}`);
  await dl.saveAs(path);
  return { path, json: JSON.parse(readFileSync(path, 'utf8')) };
}
async function importFile(page: Page, path: string, mode: 'merge' | 'replace') {
  await page.goto('./#/settings?section=data');
  await page.getByTestId('import-file').setInputFiles(path);
  await expect(page.getByTestId('import-preview')).toBeVisible();
  await page.getByTestId(`mode-${mode}`).check();
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-preview')).toBeHidden();
}

test('topic progress, notes and mastery override persist after refreshing (IndexedDB, not localStorage)', async ({ page }) => {
  await page.goto('./');
  await chooseExam(page, 'SSC CGL');
  await page.goto('./#/syllabus');
  await page.getByTestId('syllabus-search').fill('Percentage');
  const row = page.getByTestId('topic-quant.percentage').first();
  await row.getByLabel('Status of Percentage', { exact: true }).selectOption('practicing');
  await row.getByRole('button', { name: /Percentage/ }).first().click();
  await row.getByLabel('Notes').fill('fraction table up to 1/20');
  await row.getByLabel('Notes').blur();
  await row.locator('summary', { hasText: 'Manual overrides' }).click();
  await row.getByLabel('Mastery override of Percentage').fill('64');
  await row.getByRole('button', { name: 'Save overrides' }).click();
  await saved(page);
  await page.reload();
  await ready(page);
  const t = await store(page, (s) => s.report().topics['quant.percentage']);
  expect([t.status, t.notes, t.mastery, t.masteryOverridden]).toEqual(['practicing', 'fraction table up to 1/20', 64, true]);
  const inLocalStorage = await page.evaluate(() => Object.keys(localStorage).filter((k) => /:(progress|practice|planner)$/.test(k)));
  expect(inLocalStorage).toEqual([]);
});

test('switching exams and returning shows the original exam unchanged', async ({ page }) => {
  await page.goto('./');
  await seedThroughEngines(page);
  await page.goto('./#/dashboard');
  const cgl = await page.getByTestId('stat-completion').textContent();
  for (const e of ['sbi-po', 'ibps-clerk', 'ssc-chsl']) {
    await page.getByTestId('exam-select').selectOption(e);
    await expect(page.getByTestId('stat-completion')).toBeVisible();
  }
  await page.getByTestId('exam-select').selectOption('ssc-cgl');
  await expect(page.getByTestId('stat-completion')).toHaveText(cgl!);
  await page.reload();
  await expect(page.getByTestId('stat-completion')).toHaveText(cgl!);
});

test('practice and revisions recorded in the UI survive reload and update mastery', async ({ page }) => {
  await page.goto('./');
  await seedThroughEngines(page);
  const before = await store(page, (s) => s.report().topics['quant.percentage'].mastery);
  await page.goto('./#/practice');
  await page.getByRole('button', { name: 'Log practice' }).first().click();
  const form = page.getByRole('form', { name: 'Log practice' });
  await form.getByLabel('Topic').selectOption('quant.percentage');
  await form.getByLabel('Questions attempted').fill('40');
  await form.getByLabel('Correct answers').fill('38');
  await form.getByLabel('Minutes').fill('20');
  await form.getByRole('button', { name: 'Log practice' }).click();
  await saved(page);
  await page.goto('./#/revision');
  await page.getByRole('radio', { name: /Due now/ }).click();
  await page.getByTestId('list-overdue').locator('li', { hasText: 'Percentage' }).getByRole('button', { name: 'Confirm revision' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await saved(page);
  await page.reload();
  await ready(page);
  const t = await store(page, (s) => s.report().topics['quant.percentage']);
  expect(t.attempted).toBe(80);
  expect(t.mastery).toBeGreaterThan(before);
  expect(t.revisionCount).toBe(2);
  await page.goto('./#/revision');
  await page.getByRole('radio', { name: /History/ }).click();
  await expect(page.getByTestId('revision-history')).toContainText('Percentage');
});

test('deleting a practice session asks first, and Undo restores the same session', async ({ page }) => {
  await page.goto('./');
  await seedThroughEngines(page);
  await page.goto('./#/practice');
  const sessions = () => store(page, (s) => [...s.engine.getExamSessions('ssc-cgl')].map(({ createdAt, ...rest }: { createdAt: string; id: string }) => rest).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id))); // eslint-disable-line @typescript-eslint/no-unused-vars
  const before = await sessions();
  await page.getByTestId('recent-sessions').getByRole('button', { name: 'Delete session' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect(await sessions()).toEqual(before);
  await page.getByTestId('recent-sessions').getByRole('button', { name: 'Delete session' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete session' }).click();
  await expect.poll(async () => (await sessions()).length).toBe(before.length - 1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await sessions()).length).toBe(before.length);
  expect(await sessions()).toEqual(before);
  await saved(page);
  await page.reload();
  await ready(page);
  expect(await sessions()).toEqual(before);
});

test('custom weightage edits persist and change the calculation', async ({ page }) => {
  await page.goto('./');
  await chooseExam(page, 'SSC CGL');
  const w0 = await store(page, (s) => s.engine.getReport({ stageId: null }).topics['reasoning.analogy'].effectiveWeight);
  await page.goto('./#/settings?section=weightage');
  const table = page.getByTestId('weight-table');
  await table.getByLabel('Custom weight of Analogy').fill('30');
  await table.locator('tr', { hasText: 'Analogy' }).getByRole('button', { name: 'Apply' }).click();
  await expect(table.locator('tr', { hasText: 'Analogy' })).toContainText('custom');
  await saved(page);
  await page.reload();
  await ready(page);
  const w1 = await store(page, (s) => s.engine.getReport({ stageId: null }).topics['reasoning.analogy'].effectiveWeight);
  expect(w1).toBeGreaterThan(w0);
  await page.goto('./#/settings?section=weightage');
  await expect(page.getByTestId('weight-table').locator('tr', { hasText: 'Analogy' })).toContainText('custom');
});

test('common-topic sync preferences and shared concepts persist and survive backup/restore', async ({ page, browser }) => {
  await page.goto('./');
  await chooseExam(page, 'SSC CGL');
  await page.goto('./#/common');
  const row = page.getByTestId('common-mt.quant.percentage');
  await row.getByRole('button', { name: /Percentage/ }).click();
  await row.getByLabel('Shared concept status of Percentage').selectOption('concept-completed');
  await row.getByLabel('Sync mode of Percentage').selectOption('partial');
  await saved(page);
  await page.reload();
  await ready(page);
  const s1 = await store(page, (s) => [s.engine.getConcept('quant.percentage').status, s.engine.syncModeFor('sbi-po', 'quant.percentage')]);
  expect(s1).toEqual(['concept-completed', 'partial']);
  const { path } = await downloadBackup(page);
  const ctx2: BrowserContext = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto('./');
  await ready(p2);
  await importFile(p2, path, 'replace');
  await ready(p2);
  expect(await store(p2, (s) => [s.engine.getConcept('quant.percentage').status, s.engine.syncModeFor('sbi-po', 'quant.percentage')])).toEqual(['concept-completed', 'partial']);
  await ctx2.close();
});

test('export a complete backup, then full restore and merge in another browser profile', async ({ page, browser }) => {
  await page.goto('./');
  await seedThroughEngines(page);
  const original = await store(page, (s) => ({ summary: s.report().summary, sessions: s.engine.getExamSessions('sbi-po').length, plan: s.planner.getDailyPlan(s.today()).tasks.length }));
  const { path, json } = await downloadBackup(page);
  expect(json.format).toBe('syllabus-tracker-export');
  expect(json.formatVersion).toBe(2);
  expect(json.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(Object.keys(json.schema.collections)).toEqual(expect.arrayContaining(['progress', 'practice', 'sharedLearning', 'planner', 'syncSettings', 'weightOverrides', 'history', 'progressConfig']));
  expect(json.summary.exams['sbi-po'].sessions).toBe(original.sessions);

  // full restore into an empty profile
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('./');
  await ready(p);
  await importFile(p, path, 'replace');
  await ready(p);
  const restored = await store(p, (s) => ({ summary: s.report().summary, sessions: s.engine.getExamSessions('sbi-po').length, plan: s.planner.getDailyPlan(s.today()).tasks.length }));
  expect(restored).toEqual(original);

  // merge into a profile that already has other data: nothing lost, nothing duplicated
  const ctx3 = await browser.newContext();
  const q = await ctx3.newPage();
  await q.goto('./');
  await chooseExam(q, 'IBPS PO');
  await store(q, (s) => { s.engine.setStatus('reasoning.puzzles', 'learning'); s.engine.recordPractice('reasoning.puzzles', { attempted: 10, correct: 6 }); return s.flush(); });
  await importFile(q, path, 'merge');
  await ready(q);
  await importFile(q, path, 'merge'); // twice: still no duplicates
  await ready(q);
  const merged = await store(q, (s) => ({ ibps: s.engine.getExamSessions('ibps-po').length, sbi: s.engine.getExamSessions('sbi-po').length, puzzles: s.engine.getExamRecords('ibps-po').topics['reasoning.puzzles'].status }));
  expect(merged).toEqual({ ibps: 1, sbi: original.sessions, puzzles: 'learning' });
  await q.goto('./#/settings?section=data');
  await expect(q.getByTestId('snapshot-list')).toContainText('Before an import');
  await ctx.close();
  await ctx3.close();
});

test('invalid or tampered backups are refused with a clear explanation', async ({ page }) => {
  await page.goto('./');
  await seedThroughEngines(page);
  const { json } = await downloadBackup(page);
  json.collections.practice.exams['sbi-po'].sessions[0].correct = 999; // tampered after export
  const bad = join(tmp, 'tampered.json');
  writeFileSync(bad, JSON.stringify(json));
  await page.getByTestId('import-file').setInputFiles(bad);
  await expect(page.getByTestId('import-errors')).toContainText('Checksum mismatch');
  await expect(page.getByTestId('import-confirm')).toBeDisabled();
  const notBackup = join(tmp, 'other.json');
  writeFileSync(notBackup, JSON.stringify({ hello: 'world' }));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByTestId('import-file').setInputFiles(notBackup);
  await expect(page.getByTestId('import-errors')).toContainText('not a Syllabus Tracker backup');
});

test('CSV exports download with the engine’s values', async ({ page }) => {
  await page.goto('./');
  await seedThroughEngines(page);
  await page.goto('./#/settings?section=data');
  const completion = await store(page, (s) => s.engine.getReport({ stageId: null }).summary.syllabusCompletion);
  for (const kind of ['overall', 'sections', 'topics', 'mastery', 'revisions', 'activity']) {
    await page.getByTestId('csv-kind').selectOption(kind);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('csv-export').click()]);
    const text = readFileSync(await dl.path(), 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.split('\r\n').length).toBeGreaterThan(2);
    if (kind === 'overall') expect(text).toContain(`ssc-cgl,SSC CGL,All posts (default),${Math.round(completion * 100) / 100}`);
  }
});

test('Phase 6 data in localStorage is migrated to IndexedDB on first start', async ({ browser }) => {
  // produce genuine Phase 6-format collections with the engines, then place them where Phase 6 stored them
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await a.goto('./');
  await seedThroughEngines(a);
  const { json } = await downloadBackup(a);
  await ctxA.close();
  const ctx = await browser.newContext();
  await ctx.addInitScript((collections: Record<string, unknown>) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    for (const [k, v] of Object.entries(collections)) if (v !== null) localStorage.setItem(`syllabus-tracker:${k}`, JSON.stringify(v));
  }, json.collections);
  const p = await ctx.newPage();
  await p.goto('./');
  await ready(p);
  expect(await store(p, (s) => s.engine.getExamSessions('sbi-po').length)).toBe(json.summary.exams['sbi-po'].sessions);
  expect(await p.evaluate(() => Object.keys(localStorage).filter((k) => /:(progress|practice)$/.test(k)))).toEqual([]);
  await p.reload();
  await ready(p);
  expect(await store(p, (s) => s.activeExamId)).toBe('ssc-cgl');
  await ctx.close();
});

test('a failed save shows “Save failed”, keeps the change, and Retry saves it', async ({ page }) => {
  await page.goto('./');
  await chooseExam(page, 'SSC CGL');
  await saved(page);
  await store(page, (s) => { const idb = s.storage.idb; idb.__real = idb.transaction; idb.transaction = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); }; });
  await store(page, (s) => s.engine.setStatus('quant.average', 'completed'));
  await expect(page.getByTestId('save-state')).toContainText('Save failed');
  await store(page, (s) => { const idb = s.storage.idb; idb.transaction = idb.__real; });
  // the next write retries pending data automatically; otherwise the user clicks Retry
  await page.getByTestId('save-retry').click({ timeout: 2000 }).catch(() => {});
  await expect(page.getByTestId('save-state')).toContainText('Saved');
  await page.reload();
  await ready(page);
  expect(await store(page, (s) => s.engine.getExamRecords('ssc-cgl').topics['quant.average'].status)).toBe('completed');
});

test('restore points: create, then restore an earlier state', async ({ page }) => {
  await page.goto('./');
  await chooseExam(page, 'SSC CGL');
  await store(page, (s) => { s.engine.setStatus('quant.average', 'learning'); return s.flush(); });
  await page.goto('./#/settings?section=data');
  await page.getByTestId('snapshot-create').click();
  await expect(page.getByTestId('snapshot-list')).toContainText('Created by you');
  await store(page, (s) => { s.engine.setStatus('quant.average', 'mastered'); return s.flush(); });
  await page.getByTestId('snapshot-list').locator('li', { hasText: 'Created by you' }).getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => store(page, (s) => s.status === 'ready' && s.engine.getExamRecords('ssc-cgl').topics['quant.average'].status)).toBe('learning');
});

test('settings data page states clearly that data is local to this browser', async ({ page }) => {
  await page.goto('./#/settings?section=data');
  await expect(page.getByTestId('local-only-notice')).toContainText('No cloud sync is configured');
  await expect(page.getByTestId('storage-card')).toContainText('Browser database (IndexedDB)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

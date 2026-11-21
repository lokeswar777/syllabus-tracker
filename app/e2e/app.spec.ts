// Real browser, production build, real engines and data; browser storage starts empty for every test.
import { test, expect, type Page } from '@playwright/test';
import { seedThroughEngines } from './seed';

type Win = { __store: { status: string; activeExamId: string | null; report(): { summary: { syllabusCompletion: number; topicCounts: { completed: number; total: number } }; scope: { stageId?: string } } } };
const pctText = (x: number) => `${Number(x).toFixed(1).replace(/\.0+$/, '')}%`;
const engineSummary = (page: Page) => page.evaluate(() => (window as unknown as Win).__store.report().summary);
const NAV = ['Dashboard', 'Syllabus Tracker', 'Exam Comparison', 'Common Topics', 'Smart Priorities', 'Study Planner', 'Revision Tracker', 'Practice Analytics', 'Settings'];

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function openNav(page: Page, isMobile: boolean, label: string) {
  if (isMobile) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByTestId('mobile-sidebar').getByRole('link', { name: label }).click();
  } else {
    await page.getByTestId('sidebar').getByRole('link', { name: label }).click();
  }
}

test('first run: loading → exam chooser → dashboard with the engine’s values', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByRole('button', { name: /^SBI PO/ }).click();
  await expect(page.getByRole('heading', { name: 'SBI PO dashboard' })).toBeVisible();
  const s = await engineSummary(page);
  await expect(page.getByTestId('stat-completion')).toHaveText(pctText(s.syllabusCompletion));
  await expect(page.getByTestId('stat-remaining')).toHaveText(String(s.topicCounts.total - s.topicCounts.completed));
  expect(errors).toEqual([]);
});

test('sidebar navigation reaches every page, highlights it, no errors and no horizontal scrolling', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await seedThroughEngines(page);
  await page.reload();
  for (const label of NAV) {
    await openNav(page, isMobile, label);
    await expect(page.locator('main h1')).toBeVisible();
    if (!isMobile) await expect(page.getByTestId('sidebar').getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    expect(await noHorizontalScroll(page), `${label} must not scroll horizontally`).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('collapsible sidebar (desktop)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop sidebar');
  await page.goto('./');
  const sb = page.getByTestId('sidebar');
  const wide = (await sb.boundingBox())!.width;
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect.poll(async () => (await sb.boundingBox())!.width).toBeLessThan(wide / 2);
  await page.reload();
  await expect.poll(async () => (await sb.boundingBox())!.width).toBeLessThan(wide / 2); // remembered
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
});

test('exam and stage switching recalculate everything without mixing progress', async ({ page, isMobile }) => {
  await page.goto('./');
  await seedThroughEngines(page);
  await page.goto('./#/dashboard');
  const cgl = await engineSummary(page);
  await expect(page.getByTestId('stat-completion')).toHaveText(pctText(cgl.syllabusCompletion));
  await page.getByTestId('exam-select').selectOption('sbi-po');
  await expect(page.getByRole('heading', { name: 'SBI PO dashboard' })).toBeVisible();
  const sbi = await engineSummary(page);
  await expect(page.getByTestId('stat-completion')).toHaveText(pctText(sbi.syllabusCompletion));
  if (isMobile) await page.getByRole('button', { name: /Exam options/ }).click();
  await page.getByTestId('stage-select').selectOption('prelims');
  if (isMobile) await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__store.report().scope.stageId)).toBe('prelims');
  const pre = await engineSummary(page);
  await expect(page.getByTestId('stat-completion')).toHaveText(pctText(pre.syllabusCompletion));
  await page.getByTestId('exam-select').selectOption('ssc-cgl');
  await expect(page.getByTestId('stat-completion')).toHaveText(pctText(cgl.syllabusCompletion));
});

test('syllabus: search, filters, inline edit, and persistence after reload', async ({ page, isMobile }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /^SSC CGL/ }).click();
  await page.goto('./#/syllabus');
  await page.getByTestId('syllabus-search').fill('Boats');
  await expect(page.getByTestId('visible-count')).toContainText('1 of');
  const row = page.getByTestId('topic-quant.boats-streams').first();
  await row.getByLabel('Status of Boats & Streams').selectOption('completed');
  await expect(page.getByTestId('save-state')).toContainText('Saved');
  await page.getByTestId('syllabus-search').fill('');
  if (isMobile) await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByTestId('filter-status').selectOption('completed');
  if (isMobile) await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('visible-count')).toContainText('1 of');
  await page.reload();
  await page.getByTestId('syllabus-search').fill('Boats');
  await expect(page.getByTestId('topic-quant.boats-streams').first().getByLabel('Status of Boats & Streams')).toHaveValue('completed');
  await page.goto('./#/dashboard');
  await expect(page.getByTestId('stat-completed')).toHaveText('1');
});

test('planner: generate, drag a task to another day, complete it manually', async ({ page, isMobile }) => {
  test.skip(isMobile, 'HTML5 drag-and-drop needs a mouse; mobile uses the “Move to…” menu (covered below)');
  await page.goto('./');
  await seedThroughEngines(page);
  await page.goto('./#/planner');
  const today = await page.evaluate(() => (window as unknown as { __store: { today(): string } }).__store.today());
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const todayCol = page.getByTestId(`day-${today}`);
  const tomorrowCol = page.getByTestId(`day-${tomorrow}`);
  const first = todayCol.locator('li').first();
  const name = (await first.locator('span.font-medium').textContent())!.trim();
  await first.dragTo(tomorrowCol);
  await expect(tomorrowCol).toContainText(name);
  await expect(todayCol).not.toContainText(name);
  // complete a task manually without changing progress
  const before = await page.evaluate(() => JSON.stringify((window as unknown as { __store: { engine: { getExamRecords(e: string): unknown } } }).__store.engine.getExamRecords('ssc-cgl')));
  await page.getByTestId('task-0').getByRole('button', { name: 'Complete' }).click();
  await page.getByRole('button', { name: 'Mark completed' }).click();
  await expect(page.getByTestId('task-0')).toContainText('Completed');
  const after = await page.evaluate(() => JSON.stringify((window as unknown as { __store: { engine: { getExamRecords(e: string): unknown } } }).__store.engine.getExamRecords('ssc-cgl')));
  expect(after).toBe(before);
});

test('planner on touch devices: move a task with the menu', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile only');
  await page.goto('./');
  await seedThroughEngines(page);
  await page.goto('./#/planner');
  const name = (await page.getByTestId('task-0').locator('span.text-sm.font-medium').textContent())!.trim();
  const select = page.getByTestId('task-0').getByRole('combobox');
  const target = await select.locator('option').nth(1).getAttribute('value');
  await select.selectOption(target!);
  await expect(page.getByTestId(`day-${target}`)).toContainText(name);
});

test('revision tracker: manual confirmation moves a topic out of overdue', async ({ page }) => {
  await page.goto('./');
  await seedThroughEngines(page);
  await page.goto('./#/revision');
  const overdue = page.getByTestId('list-overdue');
  await expect(overdue).toContainText('Percentage');
  const n = await page.getByTestId('rev-overdue').textContent();
  await overdue.locator('li', { hasText: 'Percentage' }).getByRole('button', { name: 'Confirm revision' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('rev-overdue')).toHaveText(String(Number(n) - 1));
});

test('error state when data files are unavailable, then recovery', async ({ page }) => {
  await page.route('**/data/syllabus.json', (r) => r.fulfill({ status: 404, body: 'missing' }));
  await page.goto('./');
  await expect(page.getByTestId('app-error')).toContainText('syllabus.json');
  await page.unroute('**/data/syllabus.json');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('welcome')).toBeVisible();
});

test('loading state is shown while data loads', async ({ page }) => {
  await page.route('**/data/syllabus.json', async (r) => { await new Promise((res) => setTimeout(res, 800)); await r.continue(); });
  await page.goto('./');
  await expect(page.getByTestId('app-loading')).toBeVisible();
  await expect(page.getByTestId('welcome')).toBeVisible();
});

test('theme toggle switches dark mode and is remembered', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: /^SSC CGL/ }).isVisible().catch(() => false);
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('export downloads a complete JSON backup', async ({ page }) => {
  await page.goto('./');
  await seedThroughEngines(page);
  await page.goto('./#/settings?section=data');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  const data = JSON.parse(text);
  expect(data.format).toBe('syllabus-tracker-export');
  expect(Object.keys(data.collections.progress.exams).sort()).toEqual(['sbi-po', 'ssc-cgl']);
  expect(data.collections.planner.settings.targets).toHaveLength(2);
});

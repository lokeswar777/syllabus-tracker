import type { Page } from '@playwright/test';

/**
 * Seeds a realistic preparation history THROUGH THE REAL ENGINES running in the page
 * (window.__store → ProgressEngine / StudyPlanner). No values are written directly to storage.
 */
export async function seedThroughEngines(page: Page) {
  await page.waitForFunction(() => (window as unknown as { __store?: { status: string } }).__store?.status === 'ready');
  await page.evaluate(async () => {
    type S = { engine: any; planner: any; selectExam(id: string): Promise<unknown>; flush(): Promise<void>; recordHistory(): Promise<void>; today(): string };
    const store = (window as unknown as { __store: S }).__store;
    const e = store.engine;
    const today = store.today();
    const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
    await store.planner.setTargets([{ examId: 'ssc-cgl', importance: 60, examDate: null }, { examId: 'sbi-po', importance: 40, examDate: null }]);
    await e.switchExam('sbi-po');
    e.setStatus('quant.simplification', 'practicing');
    e.recordPractice('quant.simplification', { attempted: 30, correct: 27, timeSeconds: 30 * 55, stageId: 'prelims', date: day(16) });
    for (const [d, c] of [[14, 8], [12, 8], [10, 8], [4, 4], [3, 5], [2, 4]] as const) {
      e.setStatus('reasoning.seating-arrangement', 'practicing');
      e.recordPractice('reasoning.seating-arrangement', { attempted: 10, correct: c, timeSeconds: 700, stageId: 'prelims', date: day(d) });
    }
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
    e.addRevision('quant.percentage', { date: day(6), note: 'Successive change formulas' });
    await store.planner.generateDailyPlan(today);
    await store.flush();
    await store.recordHistory();
  });
}

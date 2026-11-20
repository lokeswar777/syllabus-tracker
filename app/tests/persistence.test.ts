// AppStore on IndexedDB (fake-indexeddb): persistence, import modes, restore points.
import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { AppStore } from '../src/lib/store';
import { IndexedDBStorage } from '../src/lib/idb';
import { defaults, fixedClock, nodeLoader } from './helpers';

let n = 0;
async function open(name = `app-${Date.now()}-${++n}`) {
  const storage = await IndexedDBStorage.open({ name, clock: fixedClock });
  const store = new AppStore({ loader: nodeLoader(), storage, defaults, clock: fixedClock, historyDelayMs: 5, storageKind: 'indexeddb' });
  await store.init();
  return { store, storage, name };
}
const reopen = async (name: string) => (await open(name)).store;

describe('persistence on IndexedDB', () => {
  test('everything the user edits survives a reload', async () => {
    const { store: s, name } = await open();
    await s.selectExam('ssc-cgl');
    s.engine.setStatus('quant.percentage', 'practicing');
    s.engine.updateTopic('quant.percentage', { notes: 'successive change', masteryOverride: 72 });
    s.engine.recordPractice('quant.percentage', { attempted: 30, correct: 24, timeSeconds: 900 });
    s.engine.addRevision('quant.percentage', { date: '2026-11-20', note: 'formulas' });
    s.engine.setWeightOverride({ kind: 'topic', stageId: 'tier1', sectionId: 'quant', topicId: 'quant.percentage' }, 20);
    s.engine.updateConcept('quant.ratio-proportion', { status: 'concept-completed' });
    s.engine.setSyncMode('mt.ga.current-affairs', 'independent');
    await s.planner.setTargets([{ examId: 'ssc-cgl', importance: 70, examDate: '2027-06-15' }]);
    await s.planner.setDailyHours(3);
    await s.planner.generateDailyPlan('2026-11-20');
    await s.setProgressConfig({ ...structuredClone(s.engine.config), mastery: { ...structuredClone(s.engine.config.mastery), weights: { concept: 0.3, accuracy: 0.4, consistency: 0.15, revision: 0.15, speed: 0 } } });
    await s.flush();
    const before = s.report()!;
    const b = await reopen(name);
    const r = b.report()!;
    const t = r.topics['quant.percentage'];
    expect([t.status, t.notes, t.mastery, t.masteryOverridden, t.attempted, t.revisionCount]).toEqual(['practicing', 'successive change', 72, true, 30, 1]); // only the confirmed revision counts
    expect(r.summary.syllabusCompletion).toBe(before.summary.syllabusCompletion);
    expect(b.engine.getWeightOverrides('ssc-cgl')).toEqual(s.engine.getWeightOverrides('ssc-cgl'));
    expect(b.engine.getConcept('quant.ratio-proportion')!.status).toBe('concept-completed');
    expect(b.engine.syncModeFor('ssc-cgl', 'ga.current-affairs')).toBe('independent');
    expect(b.planner.settings).toEqual({ targets: [{ examId: 'ssc-cgl', importance: 70, examDate: '2027-06-15' }], dailyHours: 3, configOverrides: {} });
    expect(b.planner.getDailyPlan('2026-11-20')!.tasks.length).toBeGreaterThan(0);
    expect(b.engine.config.mastery.weights.concept).toBe(0.3);
    expect(b.customConfig).toBe(true);
  });

  test('switching exams and returning keeps each exam’s progress exactly', async () => {
    const { store: s } = await open();
    await s.selectExam('ssc-cgl');
    s.engine.setStatus('quant.average', 'completed');
    const cgl = JSON.stringify(s.report()!.summary);
    await s.selectExam('ibps-po');
    s.engine.setStatus('reasoning.puzzles', 'learning');
    await s.selectExam('ssc-cgl');
    expect(JSON.stringify(s.report()!.summary)).toBe(cgl);
  });

  test('full restore replaces data; merge keeps current data; both leave a restore point', async () => {
    const { store: a } = await open();
    await a.selectExam('sbi-po');
    a.engine.setStatus('reasoning.puzzles', 'learning');
    a.engine.recordPractice('reasoning.puzzles', { attempted: 10, correct: 6 });
    await a.planner.setTargets([{ examId: 'sbi-po', importance: 100 }]);
    const backup = JSON.parse(JSON.stringify(await a.exportData()));
    expect(backup.formatVersion).toBe(2);
    expect(backup.checksum).toMatch(/^sha256:/);

    const { store: b } = await open();
    await b.selectExam('ssc-cgl');
    b.engine.setStatus('quant.average', 'completed');
    b.engine.recordPractice('quant.average', { attempted: 5, correct: 5 });
    await b.flush();

    const merged = await b.importData(backup, 'merge');
    expect(merged.snapshot?.reason).toBe('before-import');
    expect(b.engine.getExamRecords('ssc-cgl')!.topics['quant.average'].status).toBe('completed'); // kept
    expect(b.engine.getExamRecords('sbi-po')!.topics['reasoning.puzzles'].status).toBe('learning'); // added
    expect(b.engine.getExamSessions('ssc-cgl')).toHaveLength(1);
    expect(b.engine.getExamSessions('sbi-po')).toHaveLength(1);
    expect(merged.report!.added['practice sessions']).toBe(1);
    await b.importData(backup, 'merge'); // merging again creates no duplicates
    expect(b.engine.getExamSessions('sbi-po')).toHaveLength(1);

    await b.importData(backup, 'replace');
    expect(b.engine.getExamRecords('ssc-cgl')).toBeNull(); // replaced
    expect(b.activeExamId).toBe('sbi-po');
    const points = await b.listSnapshots();
    expect(points.filter((p) => p.reason === 'before-import').length).toBe(3);

    // undo the full restore with the latest restore point
    await b.restoreSnapshot(points.find((p) => p.reason === 'before-import')!.id);
    expect(b.engine.getExamRecords('ssc-cgl')!.topics['quant.average'].status).toBe('completed');
  });

  test('invalid backups are refused and nothing changes', async () => {
    const { store: s } = await open();
    await s.selectExam('ssc-cgl');
    s.engine.setStatus('quant.average', 'learning');
    const good = JSON.parse(JSON.stringify(await s.exportData()));
    good.collections.practice = { schemaVersion: 2, kind: 'practice', exams: { 'ssc-cgl': { sessions: [{ id: 'x', nodeId: 'quant.average', date: '2026-11-01', attempted: 3, correct: 1 }, { id: 'x', nodeId: 'quant.average', date: '2026-11-01', attempted: 3, correct: 1 }] } } };
    good.checksum = undefined;
    await expect(s.importData(good, 'replace')).rejects.toThrow(/Duplicate practice session id/);
    expect(s.engine.getExamRecords('ssc-cgl')!.topics['quant.average'].status).toBe('learning');
    expect((await s.listSnapshots()).filter((p) => p.reason === 'before-import')).toHaveLength(0);
  });

  test('a daily restore point is created automatically once there is data; reset keeps one too', async () => {
    const { store: s, name } = await open();
    expect((await s.listSnapshots())).toHaveLength(0);
    await s.selectExam('ssc-cgl');
    s.engine.setStatus('quant.average', 'learning');
    await s.flush();
    const b = await reopen(name);
    await new Promise((r) => setTimeout(r, 50));
    expect((await b.listSnapshots()).map((p) => p.reason)).toContain('daily');
    await b.resetAll();
    expect(b.activeExamId).toBeNull();
    expect((await b.listSnapshots()).map((p) => p.reason)).toContain('before-reset');
  });

  test('save failures are visible and recoverable without losing the change', async () => {
    const { store: s, storage, name } = await open();
    await s.selectExam('ssc-cgl');
    await s.flush();
    const real = storage.idb.transaction.bind(storage.idb);
    (storage.idb as unknown as { transaction: unknown }).transaction = () => { throw new DOMException('disk full', 'QuotaExceededError'); };
    s.engine.setStatus('quant.average', 'completed');
    await expect(s.flush()).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(s.saveState).toBe('error');
    (storage.idb as unknown as { transaction: unknown }).transaction = real;
    await s.retrySave();
    expect(s.saveState).toBe('saved');
    const b = await reopen(name);
    expect(b.engine.getExamRecords('ssc-cgl')!.topics['quant.average'].status).toBe('completed');
  });

  test('integrity check on real data reports no problems', async () => {
    const { store: s } = await open();
    await s.selectExam('ssc-cgl');
    s.engine.setStatus('quant.average', 'learning');
    s.engine.recordPractice('quant.average', { attempted: 4, correct: 2 });
    const r = await s.checkIntegrity();
    expect(r.errors).toEqual([]);
    expect(r.orphans).toEqual([]);
  });
});

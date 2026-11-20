// AppStore: single source of truth over the real engines and data.
import { describe, expect, test } from 'vitest';
import { makeStore, memoryStorage, nodeLoader, defaults } from './helpers';
import { ALL_KEYS, AppStore } from '../src/lib/store';

describe('AppStore', () => {
  test('loads all 9 exams and starts without an active exam', async () => {
    const s = await makeStore();
    expect(s.status).toBe('ready');
    expect(s.exams.map((e) => e.examId)).toEqual(['ssc-cgl', 'ssc-chsl', 'ssc-cpo', 'sbi-po', 'sbi-clerk', 'ibps-po', 'ibps-clerk', 'ibps-rrb-po', 'ibps-rrb-clerk']);
    expect(s.activeExamId).toBeNull();
  });

  test('loader failure gives an error state, retry recovers', async () => {
    let fail = true;
    const base = nodeLoader();
    const loader = { ...base, listExams: () => (fail ? Promise.reject(new Error('Could not load syllabus.json (HTTP 404)')) : base.listExams()), loadExam: base.loadExam, loadMapping: base.loadMapping };
    const s = new AppStore({ loader, storage: memoryStorage(), defaults });
    await s.init();
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/syllabus\.json/);
    fail = false;
    await s.init();
    expect(s.status).toBe('ready');
  });

  test('exam switching loads each exam independently; progress never mixes', async () => {
    const s = await makeStore();
    await s.selectExam('ssc-cgl');
    s.engine.setStatus('quant.percentage', 'practicing');
    const cgl = s.report()!.summary.syllabusCompletion;
    await s.selectExam('sbi-po');
    const sbi = s.report()!;
    expect(sbi.examId).toBe('sbi-po');
    expect(sbi.topics['quant.percentage'].ownCompletion).toBe(0); // CGL's exam-level status is not copied
    expect(sbi.topics['quant.percentage'].completion).toBe(sbi.topics['quant.percentage'].sharedUplift); // only the shared concept counts
    await s.selectExam('ssc-cgl');
    expect(s.report()!.summary.syllabusCompletion).toBe(cgl);
  });

  test('stage switching changes scope; practice stays tagged by stage', async () => {
    const s = await makeStore();
    await s.selectExam('sbi-po');
    s.engine.recordPractice('quant.percentage', { attempted: 20, correct: 10, stageId: 'prelims' });
    await s.setStage('mains');
    expect(s.report()!.scope).toEqual({ type: 'stage', stageId: 'mains' });
    expect(s.engine.getExamRecords('sbi-po')!.stageId).toBe('mains');
    expect(s.engine.getExamSessions('sbi-po')[0].stageId).toBe('prelims');
    await s.setStage(null);
    expect(s.report()!.scope.type).toBe('exam');
  });

  test('changes are saved automatically and survive a reload', async () => {
    const storage = memoryStorage();
    const a = await makeStore({ storage });
    await a.selectExam('ssc-cgl');
    a.engine.setStatus('quant.average', 'completed');
    a.engine.updateTopic('quant.average', { notes: 'alligation shortcut' });
    await a.planner.setTargets([{ examId: 'ssc-cgl', importance: 100 }]);
    await a.flush();
    const b = await makeStore({ storage });
    expect(b.activeExamId).toBe('ssc-cgl');
    const t = b.report()!.topics['quant.average'];
    expect([t.status, t.notes]).toEqual(['completed', 'alligation shortcut']);
    expect(b.planner.settings.targets).toEqual([{ examId: 'ssc-cgl', importance: 100, examDate: null }]);
  });

  test('scoring config edits recalculate, persist, and invalid ones are rejected', async () => {
    const storage = memoryStorage();
    const s = await makeStore({ storage });
    await s.selectExam('ssc-cgl');
    s.engine.setStatus('quant.percentage', 'practicing');
    expect(s.report()!.topics['quant.percentage'].completion).toBe(65);
    const next = structuredClone(s.engine.config);
    next.statuses.find((x) => x.id === 'practicing')!.score = 70;
    await s.setProgressConfig(next);
    expect(s.report()!.topics['quant.percentage'].completion).toBe(70);
    const bad = structuredClone(next); bad.statuses[2].score = 5;
    await expect(s.setProgressConfig(bad)).rejects.toThrow(/Invalid progress config/);
    const reloaded = await makeStore({ storage });
    expect(reloaded.customConfig).toBe(true);
    expect(reloaded.report()!.topics['quant.percentage'].completion).toBe(70);
    await reloaded.setProgressConfig(null);
    expect(reloaded.report()!.topics['quant.percentage'].completion).toBe(65);
  });

  test('withExam applies an update to another exam and restores the active one', async () => {
    const s = await makeStore();
    await s.selectExam('ssc-cgl');
    await s.withExam('sbi-po', () => s.engine.addRevision('quant.percentage', { date: '2026-11-19' }));
    expect(s.activeExamId).toBe('ssc-cgl');
    expect(s.engine.getExamRecords('sbi-po')!.topics['quant.percentage'].revisions).toHaveLength(1);
    expect(s.engine.getExamRecords('ssc-cgl')!.topics['quant.percentage']).toBeUndefined();
  });

  test('history records one whole-exam point per day, only once there is progress', async () => {
    const s = await makeStore();
    await s.selectExam('ssc-cgl');
    await s.recordHistory();
    expect(s.history.exams['ssc-cgl']).toBeUndefined();
    s.engine.setStatus('quant.percentage', 'completed');
    await s.recordHistory();
    const p = s.history.exams['ssc-cgl']['2026-11-20'];
    expect(p.completion).toBe(s.engine.getReport({ stageId: null }).summary.syllabusCompletion);
    expect(p.completed).toBe(1);
  });

  test('export → reset → import restores every collection exactly', async () => {
    const s = await makeStore();
    await s.selectExam('ibps-po');
    s.engine.setStatus('reasoning.puzzles', 'learning');
    s.engine.recordPractice('reasoning.puzzles', { attempted: 12, correct: 7 });
    await s.planner.setTargets([{ examId: 'ibps-po', importance: 80, examDate: '2027-08-01' }]);
    await s.planner.generateDailyPlan('2026-11-20');
    await s.recordHistory();
    const exported = await s.exportData();
    expect(Object.keys(exported.collections).sort()).toEqual([...ALL_KEYS].sort());
    for (const k of ['progress', 'practice', 'sharedLearning', 'planner', 'history']) expect(exported.collections[k]).not.toBeNull(); // untouched collections may be absent
    await s.resetAll();
    expect(s.activeExamId).toBeNull();
    expect(s.planner.settings.targets).toEqual([]);
    await s.importData(JSON.parse(JSON.stringify(exported)));
    expect(s.activeExamId).toBe('ibps-po');
    expect(s.report()!.topics['reasoning.puzzles'].attempted).toBe(12);
    expect(s.planner.getDailyPlan('2026-11-20')!.tasks.length).toBeGreaterThan(0);
    const again = await s.exportData();
    expect(again.collections).toEqual(exported.collections);
  });

  test('import rejects foreign or malformed files without touching data', async () => {
    const s = await makeStore();
    await s.selectExam('ssc-cgl');
    await expect(s.importData({ hello: 1 })).rejects.toThrow(/not a Syllabus Tracker backup/);
    await expect(s.importData({ format: 'syllabus-tracker-export', collections: { progress: { kind: 'nope' } } })).rejects.toThrow(/unexpected format/);
    await expect(s.importData({ format: 'syllabus-tracker-export', collections: { evil: {} } })).rejects.toThrow(/Unknown collection/);
    expect(s.activeExamId).toBe('ssc-cgl');
  });

  test('run() turns engine errors into a toast instead of throwing', async () => {
    const s = await makeStore();
    await s.selectExam('ssc-cgl');
    const out = await s.run(() => s.engine.setStatus('quant.percentage', 'no-such-status'));
    expect(out).toBeUndefined();
    expect(s.toasts.at(-1)).toMatchObject({ kind: 'error' });
  });
});

import { describe, expect, test } from 'vitest';
import { buildBackup, mergeCollections, validateBackup, BACKUP_FORMAT } from '../src/lib/backup';
import { buildCsv, cell, toCsv } from '../src/lib/csv';
import { makeStore } from './helpers';

const ctx = { knownExams: ['ssc-cgl', 'sbi-po'] };
const progress = (topics: Record<string, unknown> = {}) => ({ schemaVersion: 2, kind: 'progress', settings: { activeExamId: 'ssc-cgl' }, exams: { 'ssc-cgl': { examId: 'ssc-cgl', topics, subtopics: {} } } });
const practice = (sessions: unknown[]) => ({ schemaVersion: 2, kind: 'practice', exams: { 'ssc-cgl': { sessions } } });
const S = (id: string, o: Record<string, unknown> = {}) => ({ id, nodeId: 'quant.percentage', date: '2026-11-10', attempted: 10, correct: 7, ...o });

describe('backup validation', () => {
  test('a well-formed backup passes and its checksum is verified', async () => {
    const b = await buildBackup({ collections: { progress: progress(), practice: practice([S('a')]) }, exportedAt: '2026-11-20T09:00:00Z' });
    const v = await validateBackup(JSON.parse(JSON.stringify(b)), ctx);
    expect(v.errors).toEqual([]);
    expect([v.ok, v.formatVersion, v.checksum]).toEqual([true, 2, 'valid']);
    expect(v.summary!.exams['ssc-cgl'].sessions).toBe(1);
  });

  test('rejects wrong files, newer formats and newer schemas', async () => {
    expect((await validateBackup([], ctx)).errors[0]).toMatch(/not a JSON object/);
    expect((await validateBackup({ format: 'other' }, ctx)).errors[0]).toMatch(/not a Syllabus Tracker backup/);
    expect((await validateBackup({ format: BACKUP_FORMAT, formatVersion: 9, collections: { progress: progress() } }, ctx)).errors[0]).toMatch(/newer version/);
    const newer = { ...progress(), schemaVersion: 7 };
    expect((await validateBackup({ format: BACKUP_FORMAT, formatVersion: 2, collections: { progress: newer } }, ctx)).errors.join()).toMatch(/schema 7, newer/);
  });

  test('missing required fields, duplicate ids, unknown exams and tampering are reported', async () => {
    const data = {
      format: BACKUP_FORMAT, formatVersion: 2, exportedAt: '2026-11-20T09:00:00Z',
      collections: {
        practice: { schemaVersion: 2, kind: 'practice', exams: { 'ssc-cgl': { sessions: [S('a'), S('a'), S('b', { correct: 11 })] }, 'ssc-xyz': { sessions: [] } } },
        planner: { schemaVersion: 1, kind: 'planner', settings: { targets: [{ examId: 'sbi-po', importance: 50 }, { examId: 'sbi-po', importance: 20 }] }, dismissed: {}, plans: { '2026-11-20': { tasks: [{ taskId: 't1' }, { taskId: 't1' }] } } },
      },
    };
    const v = await validateBackup(data, ctx);
    const all = v.errors.join('\n');
    expect(v.ok).toBe(false);
    expect(all).toMatch(/Required collection 'progress' is missing/);
    expect(all).toMatch(/Duplicate practice session id 'a'/);
    expect(all).toMatch(/1 session\(s\) are missing required fields/);
    expect(all).toMatch(/unknown exam 'ssc-xyz'/);
    expect(all).toMatch(/'sbi-po' is listed twice/);
    expect(all).toMatch(/duplicate task id 't1'/);
    const b = await buildBackup({ collections: { progress: progress() }, exportedAt: '2026-11-20T09:00:00Z' });
    (b.collections.progress as { settings: { activeExamId: string } }).settings.activeExamId = 'sbi-po';
    expect((await validateBackup(b, ctx)).errors.join()).toMatch(/Checksum mismatch/);
  });

  test('records for topics outside the syllabus are a warning, not an error', async () => {
    const b = await buildBackup({ collections: { progress: progress({ 'quant.ghost': { status: 'learning' } }) }, exportedAt: '2026-11-20T09:00:00Z' });
    const v = await validateBackup(b, { ...ctx, nodeInExam: (_e, id) => id !== 'quant.ghost' });
    expect(v.ok).toBe(true);
    expect(v.warnings.join()).toMatch(/1 record\(s\) refer to topics that are not in the current syllabus/);
  });
});

describe('safe merge', () => {
  test('keeps everything, combines history without duplicates, newer record wins', () => {
    const current = {
      progress: progress({ 'quant.percentage': { status: 'learning', lastUpdated: '2026-11-10T00:00:00Z', revisions: [{ date: '2026-11-09' }] }, 'quant.average': { status: 'completed', lastUpdated: '2026-11-15T00:00:00Z' } }),
      practice: practice([S('a'), S('b')]),
      weightOverrides: { schemaVersion: 2, kind: 'weight-overrides', exams: { 'ssc-cgl': { k1: 5 } } },
      planner: { schemaVersion: 1, kind: 'planner', settings: { targets: [{ examId: 'ssc-cgl', importance: 100 }] }, dismissed: {}, plans: { '2026-11-20': { tasks: [{ taskId: 't1', topicId: 'x.y', action: 'learn-concept', status: 'pending', minutes: 30 }] } } },
    };
    const incoming = {
      progress: progress({ 'quant.percentage': { status: 'completed', lastUpdated: '2026-11-12T00:00:00Z', revisions: [{ date: '2026-11-09' }, { date: '2026-11-11' }] }, 'quant.average': { status: 'learning', lastUpdated: '2026-11-01T00:00:00Z' }, 'quant.ratio-proportion': { status: 'learning' } }),
      practice: practice([S('b'), S('c')]),
      weightOverrides: { schemaVersion: 2, kind: 'weight-overrides', exams: { 'ssc-cgl': { k1: 9, k2: 3 } } },
      planner: { schemaVersion: 1, kind: 'planner', settings: { targets: [{ examId: 'sbi-po', importance: 100 }] }, dismissed: { 'a.b': {} }, plans: { '2026-11-20': { tasks: [{ taskId: 't1', status: 'completed', minutes: 30 }, { taskId: 't2', topicId: 'q.r', action: 'practice-questions', minutes: 20 }] } } },
    };
    const { collections: m, report } = mergeCollections(current, incoming, '2026-11-20T09:00:00Z');
    const t = m.progress.exams['ssc-cgl'].topics;
    expect(t['quant.percentage'].status).toBe('completed'); // newer in backup
    expect(t['quant.percentage'].revisions.map((r: { date: string }) => r.date)).toEqual(['2026-11-09', '2026-11-11']);
    expect(t['quant.average'].status).toBe('completed'); // current is newer
    expect(t['quant.ratio-proportion'].status).toBe('learning'); // added
    expect(m.practice.exams['ssc-cgl'].sessions.map((s: { id: string }) => s.id)).toEqual(['a', 'b', 'c']);
    expect(m.weightOverrides.exams['ssc-cgl']).toEqual({ k1: 5, k2: 3 }); // current value kept, new key added
    expect(m.planner.settings.targets[0].examId).toBe('ssc-cgl');
    const tasks = m.planner.plans['2026-11-20'].tasks;
    expect(tasks.map((x: { taskId: string; status: string }) => `${x.taskId}:${x.status}`)).toEqual(['t1:completed', 't2:undefined']);
    expect(report.added).toMatchObject({ 'practice sessions': 1, revisions: 1, 'topic records': 1, 'custom weights': 1, tasks: 1 });
    expect(report.keptCurrent['custom weights']).toBe(1);
    // merging the same backup twice adds nothing new
    const twice = mergeCollections(m, incoming, '2026-11-20T10:00:00Z');
    expect(twice.collections.practice.exams['ssc-cgl'].sessions).toHaveLength(3);
    expect(twice.report.added['practice sessions'] ?? 0).toBe(0);
  });
});

describe('CSV', () => {
  test('escaping and formula-injection protection', () => {
    expect(cell('a,b')).toBe('"a,b"');
    expect(cell('say "hi"')).toBe('"say ""hi"""');
    expect(cell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(cell(null)).toBe('');
    expect(toCsv([['x', 1], ['y', 2.5]])).toBe('x,1\r\ny,2.5\r\n');
  });

  test('exports contain the engine’s values', async () => {
    const s = await makeStore();
    await s.selectExam('ssc-cgl');
    s.engine.setStatus('quant.percentage', 'completed');
    s.engine.updateTopic('quant.percentage', { notes: 'ratio method, "fast"' });
    s.engine.recordPractice('quant.percentage', { attempted: 20, correct: 15, timeSeconds: 600, revision: true, date: '2026-11-19' });
    s.engine.addRevision('quant.percentage', { date: '2026-11-20', note: 'formula sheet' });
    const r = s.report()!;
    const overall = (await s.exportCsv('overall', ['ssc-cgl'])).split('\r\n');
    expect(overall[1].split(',').slice(0, 4)).toEqual(['ssc-cgl', 'SSC CGL', 'All posts (default)', String(Math.round(r.summary.syllabusCompletion * 100) / 100)]);
    const topics = await s.exportCsv('topics', ['ssc-cgl']);
    expect(topics).toContain('quant.percentage,Percentage');
    expect(topics).toContain('"ratio method, ""fast"""');
    const rev = (await s.exportCsv('revisions', ['ssc-cgl'])).split('\r\n').filter(Boolean);
    expect(rev.slice(1).map((l) => l.split(',')[4])).toEqual(['revision session', 'confirmed']);
    const sections = (await s.exportCsv('sections', ['ssc-cgl'])).split('\r\n').filter(Boolean);
    expect(sections.length - 1).toBe(r.stages.reduce((a, st) => a + st.sections.length, 0));
    const activity = await s.exportCsv('activity', ['ssc-cgl']);
    expect(activity).toContain('revision practice');
    const mastery = await s.exportCsv('mastery', ['ssc-cgl']);
    expect(mastery.split('\r\n').filter(Boolean).length - 1).toBe(Object.values(r.topics).filter((t) => t.inScope).length);
    expect(buildCsv('overall', { reports: {}, records: {}, sessions: {}, plans: {}, examName: (x) => x }).split('\r\n')[0]).toMatch(/^Exam ID,Exam/);
  });
});

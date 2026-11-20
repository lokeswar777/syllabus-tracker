import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProgressEngine, WebStorageAdapter, MemoryStorage } from '../../src/progress/index.js';
import { FileStorage } from '../../src/progress/node.js';
import { SIMPLE, OTHER, fixtureLoader, config, NOW, idGen } from './fixtures.mjs';

const make = async (storage) => {
  const e = await new ProgressEngine({ loader: fixtureLoader(SIMPLE, OTHER), storage, config, clock: () => NOW, idGenerator: idGen }).init();
  await e.flush();
  return e;
};

async function populate(e) {
  await e.switchExam('other');
  e.setStatus('quant.data-interpretation', 'practicing');
  await e.switchExam('simple');
  e.setStatus('quant.percentage', 'mastered');
  e.updateSubtopic('english.cloze-test.standard', { status: 'completed', notes: 'keep' });
  e.recordPractice('quant.average.x', { attempted: 25, correct: 20, timeSeconds: 900, revision: true });
  e.addRevision('quant.percentage', { date: '2026-11-18', note: 'formula sheet' });
  e.setWeightOverride({ kind: 'section', stageId: 's1', sectionId: 'secA' }, 45);
  e.setStage('s1');
  await e.flush();
  return e.getReport();
}

describe('10. Reloading never erases saved progress', () => {
  test('file storage: a fresh engine on the same directory restores the identical report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stp-'));
    try {
      const before = await populate(await make(new FileStorage(dir)));
      assert.deepEqual((await readdir(dir)).sort(), ['practice.json', 'progress.json', 'sharedLearning.json', 'weightOverrides.json']);
      const reloaded = await make(new FileStorage(dir));
      assert.equal(reloaded.activeExamId, 'simple', 'last active exam reopened');
      assert.deepEqual(reloaded.getReport(), before);
      await reloaded.switchExam('other');
      assert.equal(reloaded.getReport().topics['quant.data-interpretation'].status, 'practicing');
      await reloaded.flush();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test('browser storage (localStorage-compatible) round-trips the same way', async () => {
    const mem = new Map();
    const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
    const before = await populate(await make(new WebStorageAdapter(ls)));
    const after = await make(new WebStorageAdapter(ls));
    assert.deepEqual(after.getReport(), before);
  });

  test('a corrupted collection is quarantined; the other collections survive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stp-'));
    try {
      await populate(await make(new FileStorage(dir)));
      await writeFile(join(dir, 'practice.json'), '{ this is not json');
      const e = await make(new FileStorage(dir));
      const r = e.getReport();
      assert.equal(r.topics['quant.percentage'].completion, 100, 'progress kept');
      assert.equal(r.topics['quant.average'].attempted, 0, 'practice reset only');
      assert.ok((await readdir(dir)).some((f) => f.startsWith('practice.json.corrupt-')), 'unreadable file kept for recovery');
      await e.flush();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test('malformed records inside a collection are dropped individually', async () => {
    const storage = new MemoryStorage({
      progress: { schemaVersion: 1, settings: { activeExamId: 'simple' }, exams: { simple: { topics: { 'quant.percentage': { status: 'mastered' }, 'quant.average': 'garbage' } }, broken: 42 } },
      practice: { schemaVersion: 1, exams: { simple: { sessions: [{ id: 'ok', nodeId: 'quant.average', attempted: 10, correct: 9 }, { id: 'bad', nodeId: 'quant.average', attempted: 5, correct: 9 }] } } },
    });
    const e = await make(storage);
    const r = e.getReport();
    assert.equal(r.topics['quant.percentage'].completion, 100);
    assert.equal(r.topics['quant.average'].attempted, 10);
    assert.ok(e.loadIssues.some((i) => i.includes('bad')) && e.loadIssues.some((i) => i.includes('broken')));
  });
});

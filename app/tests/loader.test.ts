import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFetchLoader } from '../src/lib/loader';

const pub = join(__dirname, '..', 'public', 'data');
const fakeFetch = (fail: () => boolean) => (async (url: string) => {
  const path = String(url).replace(/^\/data\//, '');
  if (fail() && path === 'syllabus.json') return new Response('missing', { status: 404 });
  try { return new Response(readFileSync(join(pub, path), 'utf8'), { status: 200 }); } catch { return new Response('', { status: 404 }); }
}) as unknown as typeof fetch;

describe('fetch loader (browser)', () => {
  test('serves the same exams as the build output', async () => {
    const l = createFetchLoader('/data/', fakeFetch(() => false));
    const exams = await l.listExams();
    expect(exams).toHaveLength(9);
    const { syllabusExam, weightageExam } = await l.loadExam('ssc-cgl');
    expect((syllabusExam as { id: string }).id).toBe('ssc-cgl');
    expect(weightageExam).not.toBeNull();
    const m = (await l.loadMapping!()) as { masterTopics: { masters: unknown[] } };
    expect(m.masterTopics.masters.length).toBeGreaterThan(100);
  });
  test('a failed load is reported clearly and retried on the next call', async () => {
    let fail = true;
    const l = createFetchLoader('/data/', fakeFetch(() => fail));
    await expect(l.listExams()).rejects.toThrow(/syllabus\.json \(HTTP 404\)/);
    fail = false;
    expect(await l.listExams()).toHaveLength(9);
  });
  test('unknown exams are rejected', async () => {
    const l = createFetchLoader('/data/', fakeFetch(() => false));
    await expect(l.loadExam('ssc-xyz')).rejects.toThrow(/not found/);
  });
});

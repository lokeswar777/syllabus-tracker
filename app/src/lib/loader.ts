import type { Loader } from './engines';
import type { ExamInfo } from './types';

/**
 * Browser loader over the build output (copied unchanged into public/data by scripts/sync-data.mjs).
 * Same interface as createNodeLoader() in src/progress/node.js.
 */
export function createFetchLoader(base = `${import.meta.env.BASE_URL}data/`, fetchImpl: typeof fetch = (...a) => fetch(...a)): Loader & { loadDefaults(): Promise<{ progress: unknown; planner: unknown }> } {
  const get = async (path: string) => {
    let res: Response;
    try {
      res = await fetchImpl(base + path);
    } catch (e) {
      throw new Error(`Could not load ${path}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status}). Run \`npm run sync-data\` in app/.`);
    try {
      return await res.json();
    } catch {
      throw new Error(`${path} is not valid JSON`);
    }
  };
  type SylExam = { id: string; shortName: string; name: string; category: string };
  let syllabus: Promise<{ exams: SylExam[] }> | null = null;
  const weightage = new Map<string, Promise<unknown>>();
  // a failed load is not cached, so "Try again" really re-fetches
  const ensure = (): Promise<{ exams: SylExam[] }> => (syllabus ??= get('syllabus.json').catch((e) => { syllabus = null; throw e; }));
  return {
    async listExams(): Promise<ExamInfo[]> {
      const s = await ensure();
      return s.exams.map((e) => ({ examId: e.id, shortName: e.shortName, name: e.name, category: e.category }));
    },
    async loadExam(examId: string) {
      const s = await ensure();
      const syllabusExam = s.exams.find((e) => e.id === examId);
      if (!syllabusExam) throw new Error(`exam '${examId}' not found in syllabus`);
      if (!weightage.has(examId)) weightage.set(examId, get(`weightage/${examId}.json`).catch(() => null));
      return { syllabusExam, weightageExam: await weightage.get(examId) };
    },
    async loadMapping() {
      const [masterTopics, crossExamMapping, config] = await Promise.all([ // not cached: the engine loads it once per init
        get('mapping-master-topics.json'), get('mapping-cross-exam-mapping.json'), get('mapping-config.json'),
      ]);
      return { masterTopics, crossExamMapping, config };
    },
    async loadDefaults() {
      const [progress, planner] = await Promise.all([get('progress-config.json'), get('planner-config.json')]);
      return { progress, planner };
    },
  };
}

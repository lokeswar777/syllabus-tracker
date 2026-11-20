// Synthetic exams in the same shape as dist/syllabus.json + dist/weightage/<exam>.json,
// small enough that every expected value can be computed by hand.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../../src/progress/node.js';

export const NOW = new Date('2026-11-20T10:00:00Z');
export const config = JSON.parse(await readFile(join(PROJECT_ROOT, 'data', 'progress', 'config.json'), 'utf8'));
export const DIST_READY = existsSync(join(PROJECT_ROOT, 'dist', 'syllabus.json')) && existsSync(join(PROJECT_ROOT, 'dist', 'weightage', 'ssc-cgl.json'));

/**
 * spec: { id, stages: [{ id, w, gate, sections: [{ id, w, gate, choiceGroup, topics: [{ id, w, subs: [[slug, w], …] }] }] }] }
 * Returns { syllabusExam, weightageExam } like the real build output.
 */
export function makeExam(spec) {
  const syllabusExam = {
    id: spec.id, name: spec.id, shortName: spec.id.toUpperCase(), category: spec.category ?? 'test',
    stages: spec.stages.map((st) => ({
      id: st.id, name: st.id, key: `${spec.id}/${st.id}`,
      sections: st.sections.map((sec) => ({
        id: sec.id, name: sec.id, key: `${spec.id}/${st.id}/${sec.id}`, choiceGroup: sec.choiceGroup, marks: sec.w,
        topics: sec.topics.map((t) => ({ topicId: t.id, name: t.id, subject: t.id.split('.')[0], subtopics: t.subs.map(([slug]) => ({ id: `${t.id}.${slug}`, slug, name: slug })) })),
      })),
    })),
  };
  const wt = (v) => ({ default: v, custom: null, effective: v });
  const weightageExam = {
    examId: spec.id, shortName: spec.id.toUpperCase(),
    tracks: [{
      trackId: 'default', name: 'Default', default: true,
      stages: spec.stages.map((st) => ({
        stageId: st.id, gate: !!st.gate, weight: wt(st.w),
        sections: st.sections.map((sec) => ({
          sectionId: sec.id, gate: !!sec.gate, choiceGroup: sec.choiceGroup ?? null, weight: wt(sec.w),
          topics: sec.topics.map((t) => ({ topicId: t.id, weight: wt(t.w), subtopics: t.subs.map(([slug, w]) => ({ id: `${t.id}.${slug}`, slug, default: w, custom: null, effective: w })) })),
        })),
      })),
      topicSummary: spec.priorities ? Object.entries(spec.priorities).map(([topicId, priority]) => ({ topicId, priority })) : [],
    }],
  };
  return { syllabusExam, weightageExam };
}

/** One stage. Topic t1 = 20% of section A, section A = 30% of the stage, so t1 contributes 6% of the exam. */
export const SIMPLE = makeExam({
  id: 'simple',
  priorities: { 'quant.percentage': 'Very High', 'quant.average': 'High', 'english.cloze-test': 'Very High' },
  stages: [{
    id: 's1', w: 100, sections: [
      { id: 'secA', w: 30, topics: [
        { id: 'quant.percentage', w: 20, subs: [['a', 50], ['b', 50]] },
        { id: 'quant.average', w: 80, subs: [['x', 100]] },
      ] },
      { id: 'secB', w: 70, topics: [{ id: 'english.cloze-test', w: 100, subs: [['standard', 60], ['replacement', 40]] }] },
      { id: 'secG', w: 0, gate: true, topics: [{ id: 'skill.dest', w: 100, subs: [['dest', 100]] }] },
    ],
  }],
});

/** Two stages; reasoning.puzzles appears in both (prelims 0.4×0.5 = 20%, mains 0.6×0.6 = 36%). */
export const MULTI = makeExam({
  id: 'multi',
  stages: [
    { id: 'prelims', w: 40, sections: [{ id: 'q', w: 100, topics: [
      { id: 'quant.percentage', w: 50, subs: [['a', 50], ['b', 50]] },
      { id: 'reasoning.puzzles', w: 50, subs: [['floor', 50], ['box', 50]] },
    ] }] },
    { id: 'mains', w: 60, sections: [{ id: 'r', w: 100, topics: [
      { id: 'reasoning.puzzles', w: 60, subs: [['floor', 50], ['box', 50]] },
      { id: 'ga.current-affairs', w: 40, subs: [['national', 100]] },
    ] }] },
  ],
});

/** Second exam sharing quant.percentage (same subtopic IDs) – used for shared-learning tests. */
export const OTHER = makeExam({
  id: 'other',
  stages: [{ id: 's1', w: 100, sections: [{ id: 'q', w: 100, topics: [
    { id: 'quant.percentage', w: 50, subs: [['a', 50], ['b', 50]] },
    { id: 'quant.data-interpretation', w: 50, subs: [['tables', 100]] },
  ] }] }],
});

/** Exam with an English/Hindi choice group. */
export const CHOICE = makeExam({
  id: 'choice',
  stages: [{ id: 'mains', w: 100, sections: [
    { id: 'reasoning', w: 50, topics: [{ id: 'reasoning.puzzles', w: 100, subs: [['floor', 100]] }] },
    { id: 'english', w: 50, choiceGroup: 'language', topics: [{ id: 'english.cloze-test', w: 100, subs: [['standard', 100]] }] },
    { id: 'hindi', w: 50, choiceGroup: 'language', topics: [{ id: 'hindi.comprehension', w: 100, subs: [['apathit', 100]] }] },
  ] }],
});

export function fixtureLoader(...exams) {
  const map = new Map(exams.map((e) => [e.syllabusExam.id, e]));
  return {
    async listExams() { return [...map.keys()].map((examId) => ({ examId })); },
    async loadExam(id) {
      if (!map.has(id)) throw new Error(`no fixture exam '${id}'`);
      return structuredClone(map.get(id));
    },
  };
}

/** Deterministic PRNG (mulberry32) for fuzz tests. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let seq = 0;
export const idGen = () => `s${++seq}`;

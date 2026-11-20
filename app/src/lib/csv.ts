/**
 * CSV exports (Phase 7). Every value comes from the engines' reports and the stored records; nothing is estimated.
 * Output: RFC 4180 quoting, CRLF line ends, UTF-8 with BOM (opens correctly in Excel); text cells that start with
 * = + - @ are prefixed with ' so spreadsheets do not execute them as formulas.
 */
import type { DailyPlan, ExamRecords, PracticeSession, Report } from './types';

type Cell = string | number | boolean | null | undefined;
const round = (x: number | null | undefined, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '' : Math.round(x * 10 ** d) / 10 ** d);
export function cell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: Cell[][]) => `${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
export const BOM = '﻿';

export type CsvKind = 'overall' | 'sections' | 'topics' | 'mastery' | 'revisions' | 'activity';
export const CSV_KINDS: { kind: CsvKind; label: string; description: string }[] = [
  { kind: 'overall', label: 'Overall exam progress', description: 'One row per exam: completion, mastery, topic counts, practice totals' },
  { kind: 'sections', label: 'Section-wise progress', description: 'One row per section: weights, completion, mastery' },
  { kind: 'topics', label: 'Topic-wise completion', description: 'One row per topic per section: status, completion, weights, notes' },
  { kind: 'mastery', label: 'Mastery and accuracy', description: 'One row per topic: mastery components, accuracy, speed and exam targets' },
  { kind: 'revisions', label: 'Revision history', description: 'Every confirmed revision and revision session' },
  { kind: 'activity', label: 'Study activity', description: 'Practice sessions, revisions and completed planner tasks, by date' },
];

export interface CsvInput {
  reports: Record<string, Report>;
  records: Record<string, ExamRecords | null>;
  sessions: Record<string, readonly PracticeSession[]>;
  plans: Record<string, DailyPlan>;
  examName: (id: string) => string;
}

export function buildCsv(kind: CsvKind, d: CsvInput): string {
  const exams = Object.keys(d.reports);
  const rows: Cell[][] = [];
  const name = (examId: string, nodeId: string) => {
    const r = d.reports[examId];
    const t = r?.topics[nodeId.split('.').slice(0, 2).join('.')];
    const s = r?.subtopics[nodeId];
    return s ? `${t?.name ?? ''} › ${s.name}` : t?.name ?? nodeId;
  };
  switch (kind) {
    case 'overall':
      rows.push(['Exam ID', 'Exam', 'Track', 'Syllabus completion %', 'Own completion %', 'Shared concept uplift %', 'Exam mastery %', 'Topics', 'Completed', 'In progress', 'Pending', 'Mastered', 'Questions', 'Correct', 'Incorrect', 'Accuracy %', 'Avg seconds/question', 'Revisions', 'Last practised']);
      for (const e of exams) {
        const s = d.reports[e].summary;
        rows.push([e, d.examName(e), d.reports[e].trackName, round(s.syllabusCompletion), round(s.ownSyllabusCompletion), round(s.sharedLearningUplift), round(s.examMastery), s.topicCounts.total, s.topicCounts.completed, s.topicCounts.inProgress, s.topicCounts.pending, s.topicCounts.mastered,
          s.practice.attempted, s.practice.correct, s.practice.incorrect, round(s.practice.accuracy), round(s.practice.avgTimeSeconds, 1), s.practice.revisionCount, s.practice.lastPracticed]);
      }
      break;
    case 'sections':
      rows.push(['Exam', 'Stage', 'Section', 'Qualifying', 'Weight in stage %', 'Weight in exam %', 'Topics', 'Completion %', 'Mastery %']);
      for (const e of exams) for (const st of d.reports[e].stages) for (const sec of st.sections)
        rows.push([d.examName(e), st.name, sec.name, sec.gate || st.gate, round(sec.weightInStage), round(sec.weightInExam), sec.topics.length, round(sec.completion), round(sec.mastery)]);
      break;
    case 'topics':
      rows.push(['Exam', 'Stage', 'Section', 'Topic ID', 'Topic', 'Weight in section %', 'Weight in exam %', 'Weightage class', 'Status', 'Completion %', 'Own completion %', 'Mastery %', 'Category', 'Start date', 'Completion date', 'Notes']);
      for (const e of exams) for (const st of d.reports[e].stages) for (const sec of st.sections) for (const t of sec.topics) {
        const T = d.reports[e].topics[t.topicId];
        rows.push([d.examName(e), st.name, sec.name, t.topicId, T.name, round(t.weightInSection), round(t.weightInExam, 3), T.priority, T.status ?? 'not-started', round(T.completion), round(T.ownCompletion), round(T.mastery), T.category, T.startDate, T.completionDate, T.notes]);
      }
      break;
    case 'mastery':
      rows.push(['Exam', 'Topic ID', 'Topic', 'Mastery %', 'Mastery level', 'Manual override', 'Concept', 'Accuracy component', 'Consistency', 'Revision', 'Speed', 'Questions', 'Correct', 'Accuracy %', 'Avg seconds/question', 'Practice sets', 'Revisions', 'Target questions', 'Target accuracy %', 'Target seconds', 'Targets met']);
      for (const e of exams) for (const T of Object.values(d.reports[e].topics)) {
        if (!T.inScope) continue;
        const m = T.masteryComponents ?? {}, q = T.requirement;
        rows.push([d.examName(e), T.topicId, T.name, round(T.mastery), T.masteryLevel, T.masteryOverridden, round(m.concept), round(m.accuracy), round(m.consistency), round(m.revision), round(m.speed),
          T.attempted, T.correct, round(T.accuracy), round(T.avgTimeSeconds, 1), T.practiceSets, T.revisionCount, q?.questionTarget, q?.accuracyTarget, q?.speedTargetSec, T.targetsMet ? T.targetsMet.all : null]);
      }
      break;
    case 'revisions':
      rows.push(['Date', 'Exam', 'Topic ID', 'Topic', 'Type', 'Questions', 'Correct', 'Accuracy %', 'Note']);
      for (const e of exams) {
        const rec = d.records[e];
        for (const bucket of [rec?.topics ?? {}, rec?.subtopics ?? {}]) for (const [id, r] of Object.entries(bucket)) for (const rv of r.revisions ?? [])
          rows.push([rv.date, d.examName(e), id, name(e, id), 'confirmed', null, null, null, rv.note ?? '']);
        for (const s of d.sessions[e] ?? []) if (s.revision)
          rows.push([s.date, d.examName(e), s.nodeId, name(e, s.nodeId), 'revision session', s.attempted, s.correct, s.attempted ? round((s.correct / s.attempted) * 100) : null, s.note]);
      }
      rows.splice(1, rows.length - 1, ...rows.slice(1).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
      break;
    case 'activity': {
      rows.push(['Date', 'Exam', 'Activity', 'Topic ID', 'Topic', 'Stage', 'Questions', 'Correct', 'Accuracy %', 'Minutes', 'Details']);
      const body: Cell[][] = [];
      for (const e of exams) {
        for (const s of d.sessions[e] ?? [])
          body.push([s.date, d.examName(e), s.revision ? 'revision practice' : 'practice', s.nodeId, name(e, s.nodeId), s.stageId, s.attempted, s.correct, s.attempted ? round((s.correct / s.attempted) * 100) : null, s.timeSeconds != null ? round(s.timeSeconds / 60, 1) : null, s.note]);
        const rec = d.records[e];
        for (const bucket of [rec?.topics ?? {}, rec?.subtopics ?? {}]) for (const [id, r] of Object.entries(bucket)) for (const rv of r.revisions ?? [])
          body.push([rv.date, d.examName(e), 'revision', id, name(e, id), null, null, null, null, null, rv.note ?? '']);
      }
      for (const p of Object.values(d.plans)) for (const t of p.tasks) {
        if (t.status !== 'completed' || !exams.some((e) => t.examIds.includes(e))) continue;
        body.push([t.completedAt?.slice(0, 10) ?? p.date, t.examIds.map(d.examName).join(' + '), `planned task: ${t.action}`, t.topicId, t.name, null, null, null, null, t.minutes, t.note ?? '']);
      }
      rows.push(...body.sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
      break;
    }
  }
  return toCsv(rows);
}

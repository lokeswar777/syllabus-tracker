import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApp } from '../lib/hooks';
import { isDate } from '../lib/format';
import type { Report } from '../lib/types';
import { Button, Checkbox, Field, Input, Select } from './ui';

/**
 * Logs a practice session through engine.recordPractice (the only way practice data is written).
 * The session is stored for the ACTIVE exam only and tagged with its stage.
 */
export function PracticeForm({ report, topicId, onDone, compact }: { report: Report; topicId?: string; onDone?: () => void; compact?: boolean }) {
  const { store } = useApp();
  const topics = Object.values(report.topics).filter((t) => t.inScope).sort((a, b) => a.name.localeCompare(b.name));
  const [node, setNode] = useState(topicId ?? topics[0]?.topicId ?? '');
  const topic = report.topics[node.split('.').slice(0, 2).join('.')];
  const stages = [...new Set((topic?.occurrences ?? []).map((o) => o.stageId))];
  const [stageId, setStageId] = useState<string>(report.scope.stageId ?? '');
  const [attempted, setAttempted] = useState('');
  const [correct, setCorrect] = useState('');
  const [minutes, setMinutes] = useState('');
  const [date, setDate] = useState(store.today());
  const [revision, setRevision] = useState(false);
  const a = Number(attempted), c = Number(correct), m = minutes === '' ? null : Number(minutes);
  const error = !node ? 'Choose a topic' : !(Number.isInteger(a) && a > 0) ? 'Questions attempted must be a whole number above 0'
    : !(Number.isInteger(c) && c >= 0 && c <= a) ? 'Correct answers must be between 0 and the questions attempted'
      : m !== null && !(m > 0 && m < 1440) ? 'Minutes must be a positive number' : !isDate(date) ? 'Choose a valid date' : null;
  const touched = attempted !== '' || correct !== '';
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (error || submitting) return; // no double submissions
    setSubmitting(true);
    const st = stages.length > 1 ? (stageId && stages.includes(stageId) ? stageId : null) : undefined;
    const ok = await store.run(() => store.engine.recordPractice(node, { attempted: a, correct: c, timeSeconds: m === null ? null : Math.round(m * 60), date, revision, ...(st !== undefined ? { stageId: st } : {}) }),
      `Logged ${a} questions (${Math.round((c / a) * 100)}% correct) for ${topic?.name ?? node}`);
    setSubmitting(false);
    if (ok) { setAttempted(''); setCorrect(''); setMinutes(''); setRevision(false); onDone?.(); }
  };

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label="Log practice">
      <div className={compact ? 'grid grid-cols-2 gap-3 sm:grid-cols-4' : 'grid gap-3 sm:grid-cols-2'}>
        {!topicId && (
          <Field label="Topic" className="col-span-2 sm:col-span-2">
            <Select value={node} onChange={(e) => setNode(e.target.value)} aria-label="Topic">
              {topics.map((t) => <option key={t.topicId} value={t.topicId}>{t.name}</option>)}
            </Select>
          </Field>
        )}
        {topicId && topic && topic.subtopicIds.length > 0 && (
          <Field label="Topic or subtopic" className="col-span-2">
            <Select value={node} onChange={(e) => setNode(e.target.value)}>
              <option value={topicId}>Whole topic: {topic.name}</option>
              {topic.subtopicIds.map((id) => <option key={id} value={id}>{report.subtopics[id]?.name ?? id}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Questions attempted"><Input inputMode="numeric" value={attempted} onChange={(e) => setAttempted(e.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 25" aria-label="Questions attempted" /></Field>
        <Field label="Correct"><Input inputMode="numeric" value={correct} onChange={(e) => setCorrect(e.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 20" aria-label="Correct answers" /></Field>
        <Field label="Time taken (min)" hint="optional, for speed"><Input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 18" aria-label="Minutes" /></Field>
        <Field label="Date"><Input type="date" value={date} max={store.today()} onChange={(e) => setDate(e.target.value)} aria-label="Practice date" /></Field>
        {stages.length > 1 && (
          <Field label="Stage" hint="tagging keeps prelims and mains practice apart">
            <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">Not stage-specific</option>
              {stages.map((s) => <option key={s} value={s}>{report.stages.find((x) => x.stageId === s)?.name ?? s}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox checked={revision} onChange={setRevision} label="This was a revision session (counts as a completed revision)" />
        <Button type="submit" variant="primary" icon={Plus} disabled={!!error} loading={submitting}>Log practice</Button>
      </div>
      {touched && error && <p className="text-xs text-critical" role="alert">{error}</p>}
    </form>
  );
}

/**
 * Builds a calculation model for one exam + track by joining:
 *   - the Phase 1 syllabus structure (dist/syllabus.json → exams[i])        : structural source of truth
 *   - the Phase 2 resolved weightage (dist/weightage/<exam>.json)             : relative weights per level
 *   - user weight overrides (weight-overrides store)                          : optional custom weights
 *
 * Every sibling group is normalised to sum 1, so custom weights that do not total 100 cannot push
 * results outside 0–100. Missing weights fall back to the mean of their siblings (with a warning),
 * so a syllabus topic missing from the weightage never breaks the calculation.
 */

const W_KEY = {
  stage: (trackId, stageId) => `stage:${trackId}:${stageId}`,
  section: (stageId, sectionId) => `section:${stageId}/${sectionId}`,
  topic: (stageId, sectionId, topicId) => `topic:${stageId}/${sectionId}/${topicId}`,
  subtopic: (stageId, sectionId, topicId, slug) => `subtopic:${stageId}/${sectionId}/${topicId}/${slug}`,
};
export const weightKey = W_KEY;

/** Normalise raw weights to fractions summing to 1. All-zero/invalid → equal split (flagged). */
function normalize(raws, onFallback) {
  const vals = raws.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum > 0) return vals.map((v) => v / sum);
  if (vals.length) onFallback?.();
  return vals.map(() => (vals.length ? 1 / vals.length : 0));
}
/** Fill missing (undefined) weights with the mean of the present siblings. */
function fillMissing(raws, label, warnings) {
  const present = raws.filter((v) => v !== undefined);
  const mean = present.length ? present.reduce((a, b) => a + b, 0) / present.length : 1;
  return raws.map((v, i) => {
    if (v !== undefined) return v;
    warnings.push(`${label(i)}: no weight in weightage data; using sibling mean ${mean.toFixed(2)}`);
    return mean;
  });
}

/**
 * @param {object} p
 * @param {object} p.syllabusExam   exam object from dist/syllabus.json
 * @param {object} p.weightageExam  dist/weightage/<exam>.json
 * @param {string} [p.trackId]      track to use (default track when omitted/unknown)
 * @param {object} [p.choices]      { [choiceGroup]: sectionId } chosen alternatives
 * @param {object} [p.weightOverrides] { [weightKey]: rawWeight } user custom weights (relative)
 */
export function buildExamModel({ syllabusExam, weightageExam, trackId, choices = {}, weightOverrides = {} }) {
  if (!syllabusExam) throw new Error('buildExamModel: syllabusExam is required');
  const warnings = [];
  const tracks = weightageExam?.tracks ?? [];
  let track = tracks.find((t) => t.trackId === trackId) ?? tracks.find((t) => t.default) ?? tracks[0];
  if (trackId && track?.trackId !== trackId) warnings.push(`track '${trackId}' not found; using '${track?.trackId ?? 'none'}'`);
  if (!track) warnings.push('no weightage data for this exam: using equal weights at every level');

  const wStages = new Map((track?.stages ?? []).map((s) => [s.stageId, s]));
  // Stages in this track: those listed by the weightage track; without weightage, all syllabus stages.
  const sylStages = syllabusExam.stages.filter((s) => (track ? wStages.has(s.id) : true));
  for (const id of wStages.keys()) if (!syllabusExam.stages.some((s) => s.id === id)) warnings.push(`weightage stage '${id}' is not in the syllabus; ignored`);

  const priority = {};
  const history = {}; // Phase 2 historical question trend + estimate confidence (used by the Phase 5 priority engine)
  for (const t of track?.topicSummary ?? []) {
    priority[t.topicId] = t.priority;
    history[t.topicId] = { trend: t.trend ?? null, confidence: t.confidence ?? null };
  }

  const stageRaw = fillMissing(
    sylStages.map((s) => weightOverrides[W_KEY.stage(track?.trackId, s.id)] ?? wStages.get(s.id)?.weight?.effective),
    (i) => `stage '${sylStages[i].id}'`, warnings,
  );
  const stageW = normalize(stageRaw, () => warnings.push('all stage weights are 0: using equal split'));

  const topics = {}; // topicId → { name, subject, priority, occurrences: [], subtopicIds: [] }
  const subtopics = {}; // subtopicId → { topicId, slug, name }

  const stages = sylStages.map((st, si) => {
    const wSt = wStages.get(st.id);
    const wSecs = new Map((wSt?.sections ?? []).map((s) => [s.sectionId, s]));
    // choice groups: active alternative = chosen one, else the first in the group
    const groupFirst = {};
    for (const sec of st.sections) if (sec.choiceGroup && !groupFirst[sec.choiceGroup]) groupFirst[sec.choiceGroup] = sec.id;
    const chosenIn = (g) => {
      const c = choices[g];
      return c && st.sections.some((x) => x.id === c && x.choiceGroup === g) ? c : groupFirst[g];
    };
    const isActive = (sec) => !sec.choiceGroup || chosenIn(sec.choiceGroup) === sec.id;
    const secRaw = fillMissing(
      st.sections.map((sec) => weightOverrides[W_KEY.section(st.id, sec.id)] ?? wSecs.get(sec.id)?.weight?.effective),
      (i) => `section '${st.id}/${st.sections[i].id}'`, warnings,
    ).map((v, i) => (isActive(st.sections[i]) ? v : 0));
    const secW = normalize(secRaw, () => warnings.push(`stage '${st.id}': all section weights are 0; equal split used`));

    const sections = st.sections.map((sec, ci) => {
      const wSec = wSecs.get(sec.id);
      const wTops = new Map((wSec?.topics ?? []).map((t) => [t.topicId, t]));
      const topRaw = fillMissing(
        sec.topics.map((t) => weightOverrides[W_KEY.topic(st.id, sec.id, t.topicId)] ?? wTops.get(t.topicId)?.weight?.effective),
        (i) => `topic '${st.id}/${sec.id}/${sec.topics[i].topicId}'`, warnings,
      );
      const topW = normalize(topRaw, () => warnings.push(`section '${st.id}/${sec.id}': all topic weights are 0; equal split used`));
      const key = `${st.id}/${sec.id}`;
      const gate = !!wSec?.gate || !!wSt?.gate;
      const tps = sec.topics.map((t, ti) => {
        const wTop = wTops.get(t.topicId);
        const wSubs = new Map((wTop?.subtopics ?? []).map((s) => [s.slug, s]));
        const subRaw = fillMissing(
          t.subtopics.map((s) => weightOverrides[W_KEY.subtopic(st.id, sec.id, t.topicId, s.slug)] ?? wSubs.get(s.slug)?.effective),
          (i) => `subtopic '${t.subtopics[i].id}' in ${key}`, warnings,
        );
        const subW = normalize(subRaw, () => warnings.push(`topic '${t.topicId}' in ${key}: all subtopic weights are 0; equal split used`));
        const node = {
          topicId: t.topicId,
          name: t.name,
          subject: t.subject,
          w: topW[ti],
          subtopics: t.subtopics.map((s, k) => ({ id: s.id, slug: s.slug, name: s.name, w: subW[k] })),
        };
        topics[t.topicId] ??= { topicId: t.topicId, name: t.name, subject: t.subject, priority: priority[t.topicId] ?? null, trend: history[t.topicId]?.trend ?? null, weightageConfidence: history[t.topicId]?.confidence ?? null, occurrences: [], subtopicIds: [] };
        const T = topics[t.topicId];
        T.occurrences.push({ stageId: st.id, sectionKey: key, node, examW: stageW[si] * secW[ci] * topW[ti], stageW: secW[ci] * topW[ti] });
        for (const s of t.subtopics) {
          if (!T.subtopicIds.includes(s.id)) T.subtopicIds.push(s.id);
          subtopics[s.id] ??= { id: s.id, topicId: t.topicId, slug: s.slug, name: s.name };
        }
        return node;
      });
      return { id: sec.id, key, name: sec.name, gate, choiceGroup: sec.choiceGroup ?? null, active: isActive(sec), w: secW[ci], marks: sec.marks ?? null, questions: sec.questions ?? null, topics: tps };
    });
    return { id: st.id, name: st.name, gate: !!wSt?.gate, w: stageW[si], sections };
  });

  // Weightage entries that no longer exist in the syllabus (stale weightage) – ignored, reported.
  for (const wSt of track?.stages ?? []) {
    const st = syllabusExam.stages.find((s) => s.id === wSt.stageId);
    if (!st) continue;
    for (const wSec of wSt.sections ?? []) {
      const sec = st.sections.find((s) => s.id === wSec.sectionId);
      if (!sec) { warnings.push(`weightage section '${wSt.stageId}/${wSec.sectionId}' not in syllabus; ignored`); continue; }
      for (const wt of wSec.topics ?? [])
        if (!sec.topics.some((t) => t.topicId === wt.topicId)) warnings.push(`weightage topic '${wt.topicId}' not in syllabus section '${st.id}/${sec.id}'; ignored`);
    }
  }

  return {
    examId: syllabusExam.id,
    shortName: syllabusExam.shortName,
    name: syllabusExam.name,
    category: syllabusExam.category,
    trackId: track?.trackId ?? null,
    trackName: track?.name ?? null,
    tracks: tracks.map((t) => ({ trackId: t.trackId, name: t.name, default: !!t.default })),
    choiceGroups: Object.fromEntries(
      stages.flatMap((s) => s.sections.filter((x) => x.choiceGroup).map((x) => x.choiceGroup))
        .map((g) => [g, stages.flatMap((s) => s.sections.filter((x) => x.choiceGroup === g).map((x) => ({ sectionId: x.id, name: x.name, active: x.active })))]),
    ),
    stages,
    topics,
    subtopics,
    warnings,
  };
}

#!/usr/bin/env node
/**
 * Seeds data/weightage/exams/<exam>.json from:
 *   - dist/syllabus.json            (structure + official marks)
 *   - scripts/weightage/estimates.mjs (expected-question ranges & subtopic profiles)
 *
 * Re-running is safe: `custom`, `customPriority` and `customNote` values already present in the
 * weightage files are preserved. Defaults are recomputed. `lastUpdated` changes only when a default changes.
 *
 *   node scripts/seed-weightage.mjs            write files
 *   node scripts/seed-weightage.mjs --dry-run  check estimates only
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WDIR, DATA, readJson, loadSyllabus, roundToTotal, isGateStage, stageMarks } from './weightage/lib.mjs';
import { SECTIONS, SUBTOPIC_PROFILES, SUBTOPIC_OVERRIDES, AUTHORED_ON } from './weightage/estimates.mjs';

const DRY = process.argv.includes('--dry-run');
const syllabus = loadSyllabus();
const registry = readJson(join(DATA, 'registry.json'));
const config = readJson(join(WDIR, 'config.json'));
const libraryTopics = syllabus.topics;
const errors = [];
const warnings = [];
const usedSpecs = new Set();

// Validate estimate keys against the library up front (catches typos in base tables).
for (const [key, spec] of Object.entries(SECTIONS))
  for (const t of Object.keys(spec.q ?? {})) if (!libraryTopics[t]) errors.push(`estimates ${key}: unknown topic '${t}'`);
for (const t of Object.keys(SUBTOPIC_PROFILES)) if (!libraryTopics[t]) errors.push(`profiles: unknown topic '${t}'`);

const familyOf = Object.fromEntries(registry.exams.map((e) => [e.id, e.category]));
const half = (x) => Math.round(x * 2) / 2;

function deriveTrend(min, max) {
  if (min <= 0) return 'fluctuating';
  return max - min <= 0.34 * max ? 'consistent' : 'fluctuating';
}

function weightObj(def, { basis, confidence, justification, evidence = [], isOfficial = false }, prev) {
  const unchanged = prev && prev.default === def;
  return {
    default: def,
    custom: prev?.custom ?? null,
    basis,
    isOfficial,
    confidence,
    justification,
    evidence,
    lastUpdated: unchanged && prev.lastUpdated ? prev.lastUpdated : AUTHORED_ON,
    ...(prev?.customNote ? { customNote: prev.customNote } : {}),
  };
}

function subtopicWeights(examId, sectionKey, topic) {
  const slugs = topic.subtopics.map((s) => s.slug);
  const ov = SUBTOPIC_OVERRIDES[sectionKey]?.[topic.topicId];
  const prof = SUBTOPIC_PROFILES[topic.topicId];
  let table, basis, note;
  if (ov) ({ weights: table, basis, note } = ov);
  else if (prof) {
    table = prof[familyOf[examId]] ?? prof.all;
    if (!table) { table = {}; warnings.push(`${sectionKey} ${topic.topicId}: no '${familyOf[examId]}' or 'all' profile; uniform used`); }
    basis = prof.basis ?? 'editorial-estimate';
    note = prof.note;
  } else {
    table = {};
    basis = slugs.length === 1 ? 'nominal' : 'editorial-estimate';
    if (slugs.length > 1) warnings.push(`${topic.topicId}: no subtopic profile, uniform split used`);
  }
  const raw = slugs.map((s) => {
    if (table[s] == null && Object.keys(table).length) warnings.push(`${sectionKey} ${topic.topicId}: profile lacks '${s}', weight 1 used`);
    return table[s] ?? 1;
  });
  return { values: roundToTotal(raw), basis, note };
}

function build(exam, prevFile) {
  const prevIndex = indexPrev(prevFile);
  const sylStages = exam.stages;
  // ── tracks ──
  const mandatory = sylStages.filter((s) => !s.applicableTo);
  const optional = sylStages.filter((s) => s.applicableTo);
  const trackDefs = [{ id: 'default', name: optional.length ? 'All posts (default)' : 'Default', stages: mandatory }];
  for (const o of optional) trackDefs.push({ id: o.id, name: `${o.applicableTo.join(' / ')} (adds ${o.name})`, stages: [...mandatory, o] });
  const merit = config.stageWeighting.meritRatios[exam.id];
  const tracks = trackDefs.map((t) => {
    const scored = t.stages.filter((s) => !isGateStage(s));
    const marks = scored.map(stageMarks);
    const total = marks.reduce((a, b) => a + b, 0);
    let raw = marks;
    if (merit) {
      // marks share of the merit stages, re-split by the official merit ratio
      const ratioIds = Object.keys(merit.ratio);
      const meritMarks = scored.reduce((a, s, i) => a + (ratioIds.includes(s.id) ? marks[i] : 0), 0);
      const ratioSum = ratioIds.reduce((a, id) => a + merit.ratio[id], 0);
      raw = scored.map((s, i) => (ratioIds.includes(s.id) ? (meritMarks * merit.ratio[s.id]) / ratioSum : marks[i]));
    }
    const w = roundToTotal(raw);
    const why = (s) => merit && merit.ratio[s.id] != null
      ? `Merit stages (${Object.keys(merit.ratio).join(' + ')}) hold their marks share of the track (${Object.keys(merit.ratio).reduce((a, id) => a + stageMarks(t.stages.find((x) => x.id === id)), 0)} of ${total} marks), split by the official ratio ${Object.values(merit.ratio).join(':')}. Source: ${merit.source}.`
      : `${stageMarks(s)} of ${total} marks across this track's scored stages.`;
    return {
      trackId: t.id,
      name: t.name,
      default: t.id === 'default',
      stageWeights: t.stages.map((s) => {
        const i = scored.indexOf(s);
        const gate = i < 0;
        const prev = prevIndex.get(`track:${t.id}:${s.id}`);
        return {
          stageId: s.id,
          gate,
          weight: weightObj(gate ? 0 : w[i], {
            basis: gate ? 'nominal' : 'official-marks', isOfficial: !gate, confidence: 'high',
            justification: gate ? 'Pass/fail stage: no merit marks (gate).' : why(s),
          }, prev),
        };
      }),
    };
  });

  // ── stages / sections / topics ──
  const stages = sylStages.map((stage) => {
    const gateStage = isGateStage(stage);
    const marksTotal = stageMarks(stage);
    // section weights
    const items = []; // one per slot (choice group counted once)
    const slotOf = new Map();
    for (const sec of stage.sections) {
      const hasMarks = typeof sec.marks === 'number' && sec.marks > 0;
      const key = sec.choiceGroup ?? sec.id;
      if (!slotOf.has(key)) { slotOf.set(key, items.length); items.push({ marks: hasMarks ? sec.marks : 0 }); }
    }
    const anyMarks = items.some((i) => i.marks > 0);
    const slotWeights = items.length ? roundToTotal(items.map((i) => (anyMarks ? i.marks : 1))) : [];

    const sections = stage.sections.map((sec) => {
      const sectionKey = `${exam.id}/${stage.id}/${sec.id}`;
      const slotW = slotWeights[slotOf.get(sec.choiceGroup ?? sec.id)];
      const hasMarks = typeof sec.marks === 'number' && sec.marks > 0;
      const gate = anyMarks && !hasMarks;
      const prevSec = prevIndex.get(`section:${stage.id}/${sec.id}`);
      const secWeight = weightObj(gate ? 0 : slotW, {
        basis: anyMarks ? (gate ? 'nominal' : 'official-marks') : 'nominal',
        isOfficial: anyMarks && !gate,
        confidence: 'high',
        justification: gate
          ? 'Qualifying/skill test with no marks: gate (weight 0).'
          : anyMarks
            ? `${sec.marks} of ${marksTotal} stage marks${sec.choiceGroup ? ` (choice group '${sec.choiceGroup}': candidate takes one alternative)` : ''}.`
            : 'No marks in this stage; equal nominal split.',
      }, prevSec);

      // topics
      const spec = SECTIONS[sectionKey];
      if (spec) usedSpecs.add(sectionKey);
      const topicsIn = sec.topics;
      let topicDefaults, ranges = null, meta;
      if (topicsIn.length === 1 && (!spec || spec.nominal)) {
        topicDefaults = [100];
        meta = { basis: 'nominal', confidence: 'high', justification: spec?.note ?? 'Only topic in this section.', evidence: [] };
      } else if (!spec || spec.nominal) {
        errors.push(`${sectionKey}: ${topicsIn.length} topics but no estimate table`);
        return null;
      } else {
        const per = spec.per;
        const Q = typeof sec.questions === 'number' ? sec.questions : null;
        ranges = topicsIn.map((t) => {
          const e = spec.q[t.topicId];
          if (e == null) { errors.push(`${sectionKey}: no estimate for topic '${t.topicId}'`); return { q: [0, 0] }; }
          return Array.isArray(e) ? { q: e } : e;
        });
        const mids = ranges.map((r) => (r.q[0] + r.q[1]) / 2);
        if (mids.every((m) => m === 0)) { errors.push(`${sectionKey}: all estimates are 0`); return null; }
        if (mids.some((m) => m === 0)) errors.push(`${sectionKey}: a topic has estimate [0,0]; every syllabus topic needs a non-zero weight`);
        topicDefaults = roundToTotal(mids);
        ranges = ranges.map((r) => ({ ...r, scaled: Q ? [half((r.q[0] * Q) / per), half((r.q[1] * Q) / per)] : null }));
        meta = { basis: spec.basis, confidence: spec.confidence, justification: spec.note, evidence: spec.evidence ?? [] };
      }

      const topics = topicsIn.map((t, i) => {
        const prevT = prevIndex.get(`topic:${stage.id}/${sec.id}/${t.topicId}`);
        const r = ranges?.[i];
        const sub = subtopicWeights(exam.id, sectionKey, t);
        const prevSubs = new Map((prevT?.subtopics ?? []).map((s) => [s.slug, s]));
        return {
          topicId: t.topicId,
          weight: weightObj(topicDefaults[i], meta, prevT?.weight),
          ...(r ? {
            expectedQuestions: r.scaled ? { min: r.scaled[0], max: r.scaled[1], perPaper: sec.questions } : { min: r.q[0], max: r.q[1], perPaper: spec.per, note: 'relative units' },
            trend: r.trend ?? deriveTrend(r.q[0], r.q[1]),
          } : { expectedQuestions: null, trend: 'not-applicable' }),
          ...(r?.note ? { note: r.note } : {}),
          customPriority: prevT?.customPriority ?? null,
          subtopicWeighting: {
            basis: sub.basis,
            justification: sub.note ?? (sub.basis === 'nominal' ? 'Single subtopic or pass/fail component.' : 'Relative importance profile (no source reports subtopic-level frequencies).'),
            lastUpdated: AUTHORED_ON,
          },
          subtopics: t.subtopics.map((s, j) => {
            const ps = prevSubs.get(s.slug);
            return { slug: s.slug, default: sub.values[j], custom: ps?.custom ?? null };
          }),
        };
      });
      return {
        sectionId: sec.id,
        gate,
        ...(sec.choiceGroup ? { choiceGroup: sec.choiceGroup } : {}),
        weight: secWeight,
        topics,
      };
    });
    return { stageId: stage.id, gate: gateStage, sections: sections.filter(Boolean) };
  });

  return {
    $schema: '../../schema/weightage.schema.json',
    examId: exam.id,
    syllabusCycle: exam.cycle,
    lastUpdated: AUTHORED_ON,
    tracks,
    stages,
  };
}

function indexPrev(file) {
  const m = new Map();
  if (!file) return m;
  for (const t of file.tracks ?? []) for (const s of t.stageWeights ?? []) m.set(`track:${t.trackId}:${s.stageId}`, s.weight);
  for (const st of file.stages ?? [])
    for (const sec of st.sections ?? []) {
      m.set(`section:${st.stageId}/${sec.sectionId}`, sec.weight);
      for (const t of sec.topics ?? []) m.set(`topic:${st.stageId}/${sec.sectionId}/${t.topicId}`, t);
    }
  return m;
}

const outputs = [];
for (const exam of syllabus.exams) {
  const path = join(WDIR, 'exams', `${exam.id}.json`);
  const prev = existsSync(path) ? readJson(path) : null;
  outputs.push([path, build(exam, prev)]);
}
for (const key of Object.keys(SECTIONS)) if (!usedSpecs.has(key)) errors.push(`estimates: section '${key}' does not exist in the syllabus`);

for (const w of [...new Set(warnings)]) console.warn(`WARN  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`ERROR ${e}`);
  console.error(`\n✖ ${errors.length} error(s)`);
  process.exit(1);
}
if (DRY) { console.log('✔ estimates complete (dry run)'); process.exit(0); }

mkdirSync(join(WDIR, 'exams'), { recursive: true });
const compact = (json) => json.replace(
  /\{\n\s+"slug": ("[^"]+"),\n\s+"default": ([\d.]+),\n\s+"custom": (null|[\d.]+)\n\s+\}/g,
  '{ "slug": $1, "default": $2, "custom": $3 }',
);
for (const [path, data] of outputs) writeFileSync(path, compact(JSON.stringify(data, null, 2)) + '\n');
console.log(`✔ seeded ${outputs.length} weightage files → data/weightage/exams/`);

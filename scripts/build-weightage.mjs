#!/usr/bin/env node
/**
 * Validates data/weightage/exams/*.json against the syllabus and the weightage rules, computes
 * effective (overall) weights and priorities, and writes:
 *   dist/weightage.json        – resolved, React-ready weightage tree + topic summaries + cross-exam map
 *   dist/WEIGHTAGE_REPORT.md   – human-readable report (summary, section tables, top-10s, gaps, validation)
 *
 *   node scripts/build-weightage.mjs           validate + write
 *   node scripts/build-weightage.mjs --check   validate only (exit 1 on any error)
 * Requires dist/syllabus.json (run `npm run build:data` first, or use `npm run build`).
 */
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { WDIR, DATA, DIST, readJson, loadSyllabus, effective, round2, round4, sumSections } from './weightage/lib.mjs';

const CHECK_ONLY = process.argv.includes('--check');
const config = readJson(join(WDIR, 'config.json'));
const evidence = readJson(join(WDIR, 'evidence.json'));
const registry = readJson(join(DATA, 'registry.json'));
const syllabus = loadSyllabus();
const TOL = config.validation.tolerance;
const BASES = Object.keys(config.basisLegend);
const CONF = Object.keys(config.confidenceLegend);
const PRIORITIES = Object.keys(config.priority.thresholds);
const EVIDENCE_IDS = new Set(evidence.sources.map((s) => s.id));
const NON_ACADEMIC = new Set(config.nonAcademicSubjects.subjects);

// ───────────────────────── validation bookkeeping ─────────────────────────
const checks = new Map(); // name → { pass, fail, failures: [] }
function check(name, ok, msg) {
  if (!checks.has(name)) checks.set(name, { pass: 0, fail: 0, failures: [] });
  const c = checks.get(name);
  if (ok) c.pass++; else { c.fail++; c.failures.push(msg); }
  return ok;
}
const near = (x, y) => Math.abs(x - y) <= TOL;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function checkWeightObj(w, where, { allowEvidence = true } = {}) {
  check('Weight values within 0–100', typeof w?.default === 'number' && w.default >= 0 && w.default <= 100, `${where}: default ${w?.default}`);
  check('Custom values null or within 0–100', w?.custom === null || (typeof w?.custom === 'number' && w.custom >= 0 && w.custom <= 100), `${where}: custom ${w?.custom}`);
  check('Basis from legend', BASES.includes(w?.basis), `${where}: basis '${w?.basis}'`);
  check('Confidence from legend', CONF.includes(w?.confidence), `${where}: confidence '${w?.confidence}'`);
  check('isOfficial consistent with basis', w?.isOfficial === (w?.basis === 'official-marks'), `${where}: isOfficial ${w?.isOfficial} with basis ${w?.basis}`);
  check('lastUpdated is an ISO date', isDate(w?.lastUpdated), `${where}: lastUpdated '${w?.lastUpdated}'`);
  check('Justification present', typeof w?.justification === 'string' && w.justification.length > 0, `${where}: missing justification`);
  if (allowEvidence) for (const e of w?.evidence ?? []) check('Evidence ids exist', EVIDENCE_IDS.has(e), `${where}: unknown evidence '${e}'`);
}

/** Compare two id lists: reports missing, orphan and duplicate ids. */
function matchIds(expected, actual, where, label) {
  const seen = new Set();
  for (const id of actual) {
    check(`No duplicate ${label} entries`, !seen.has(id), `${where}: duplicate ${label} '${id}'`);
    seen.add(id);
  }
  const exp = new Set(expected);
  for (const id of expected) check(`Every syllabus ${label} has a weightage entry`, seen.has(id), `${where}: missing ${label} '${id}'`);
  for (const id of seen) check(`No orphaned ${label} entries`, exp.has(id), `${where}: orphaned ${label} '${id}' (not in syllabus)`);
}

// ───────────────────────── load weightage files ─────────────────────────
const files = existsSync(join(WDIR, 'exams')) ? readdirSync(join(WDIR, 'exams')).filter((f) => f.endsWith('.json')) : [];
const weightByExam = new Map();
for (const f of files) {
  const w = readJson(join(WDIR, 'exams', f));
  check('Weightage file id matches filename', w.examId === basename(f, '.json'), `${f}: examId '${w.examId}'`);
  check('No orphaned exam files', registry.exams.some((e) => e.id === w.examId), `${f}: exam '${w.examId}' not in registry`);
  weightByExam.set(w.examId, w);
}
for (const e of registry.exams) check('Every registry exam has a weightage file', weightByExam.has(e.id), `missing data/weightage/exams/${e.id}.json`);

const sylExam = new Map(syllabus.exams.map((e) => [e.id, e]));
const topicLib = syllabus.topics;

// ───────────────────────── validate + resolve ─────────────────────────
const resolved = [];
for (const [examId, W] of weightByExam) {
  const S = sylExam.get(examId);
  if (!S) continue;
  const sylStages = new Map(S.stages.map((s) => [s.id, s]));

  // tracks
  check('Exactly one default track', W.tracks.filter((t) => t.default).length === 1, `${examId}: default tracks ≠ 1`);
  const mandatory = S.stages.filter((s) => !s.applicableTo).map((s) => s.id);
  for (const t of W.tracks) {
    const where = `${examId} track '${t.trackId}'`;
    const ids = t.stageWeights.map((s) => s.stageId);
    const seen = new Set();
    for (const id of ids) {
      check('No duplicate stage entries', !seen.has(id), `${where}: duplicate stage '${id}'`);
      seen.add(id);
      check('Track stages exist in syllabus', sylStages.has(id), `${where}: unknown stage '${id}'`);
    }
    for (const id of mandatory) check('Every track includes all mandatory stages', seen.has(id), `${where}: missing mandatory stage '${id}'`);
    for (const s of t.stageWeights) {
      checkWeightObj(s.weight, `${where} stage ${s.stageId}`);
      if (s.gate) check('Gate stages have weight 0', effective(s.weight) === 0, `${where}: gate stage ${s.stageId} has weight ${effective(s.weight)}`);
    }
    const total = t.stageWeights.reduce((a, s) => a + effective(s.weight), 0);
    check('Stage weights total 100% per track', near(total, 100), `${where}: stage weights total ${round2(total)}`);
  }

  // stages → sections → topics → subtopics
  matchIds(S.stages.map((s) => s.id), W.stages.map((s) => s.stageId), examId, 'stage');
  for (const ws of W.stages) {
    const ss = sylStages.get(ws.stageId);
    if (!ss) continue;
    const sWhere = `${examId}/${ws.stageId}`;
    matchIds(ss.sections.map((s) => s.id), ws.sections.map((s) => s.sectionId), sWhere, 'section');
    const sylSecs = new Map(ss.sections.map((s) => [s.id, s]));
    const enriched = ws.sections.map((sec) => ({ ...sec, choiceGroup: sylSecs.get(sec.sectionId)?.choiceGroup }));
    if (enriched.length) {
      const total = sumSections(enriched, (s) => effective(s.weight));
      check('Section weights total 100% per stage', near(total, 100), `${sWhere}: section weights total ${round2(total)}`);
      const groups = {};
      for (const s of enriched) if (s.choiceGroup) (groups[s.choiceGroup] ??= []).push(effective(s.weight));
      for (const [g, ws2] of Object.entries(groups)) check('Choice-group alternatives carry equal weight', ws2.every((x) => near(x, ws2[0])), `${sWhere}: choice group '${g}' weights ${ws2.join('/')}`);
    }
    for (const sec of ws.sections) {
      const sylSec = sylSecs.get(sec.sectionId);
      if (!sylSec) continue;
      const where = `${sWhere}/${sec.sectionId}`;
      checkWeightObj(sec.weight, `${where} (section)`);
      if (sec.gate) check('Gate sections have weight 0', effective(sec.weight) === 0, `${where}: gate section weight ${effective(sec.weight)}`);
      matchIds(sylSec.topics.map((t) => t.topicId), sec.topics.map((t) => t.topicId), where, 'topic');
      for (const t of sec.topics) check('Topic ids exist in the library', !!topicLib[t.topicId], `${where}: unknown topic id '${t.topicId}'`);
      const tTotal = sec.topics.reduce((a, t) => a + effective(t.weight), 0);
      check('Topic weights total 100% per section', near(tTotal, 100), `${where}: topic weights total ${round2(tTotal)}`);
      const sylTopics = new Map(sylSec.topics.map((t) => [t.topicId, t]));
      for (const t of sec.topics) {
        const tw = `${where} ${t.topicId}`;
        checkWeightObj(t.weight, tw);
        check('Custom priority values from legend', t.customPriority === null || PRIORITIES.includes(t.customPriority), `${tw}: customPriority '${t.customPriority}'`);
        check('Subtopic weighting metadata present', BASES.includes(t.subtopicWeighting?.basis) && isDate(t.subtopicWeighting?.lastUpdated), `${tw}: subtopicWeighting incomplete`);
        const st = sylTopics.get(t.topicId);
        if (!st) continue;
        matchIds(st.subtopics.map((s) => s.slug), t.subtopics.map((s) => s.slug), tw, 'subtopic');
        for (const s of t.subtopics) {
          check('Weight values within 0–100', typeof s.default === 'number' && s.default >= 0 && s.default <= 100, `${tw}.${s.slug}: default ${s.default}`);
          check('Custom values null or within 0–100', s.custom === null || (typeof s.custom === 'number' && s.custom >= 0 && s.custom <= 100), `${tw}.${s.slug}: custom ${s.custom}`);
        }
        const subTotal = t.subtopics.reduce((a, s) => a + (s.custom ?? s.default), 0);
        check('Subtopic weights total 100% per topic', near(subTotal, 100), `${tw}: subtopic weights total ${round2(subTotal)}`);
      }
    }
  }
  resolved.push(resolveExam(W, S));
}

// ───────────────────────── resolution & priority ─────────────────────────
function band(cumBefore) {
  const th = config.priority.thresholds;
  for (const p of PRIORITIES) if (cumBefore < th[p]) return p;
  return PRIORITIES[PRIORITIES.length - 1];
}
function assignPriorities(items, getW, set) {
  const scored = items.filter((i) => getW(i) > 0).sort((a, b) => getW(b) - getW(a));
  const total = scored.reduce((a, i) => a + getW(i), 0);
  let cum = 0;
  for (const i of scored) { set(i, band((cum / total) * 100)); cum += getW(i); }
}
function wOut(w) {
  return { default: w.default, custom: w.custom, effective: effective(w), basis: w.basis, isOfficial: w.isOfficial, confidence: w.confidence, justification: w.justification, evidence: w.evidence, lastUpdated: w.lastUpdated, ...(w.customNote ? { customNote: w.customNote } : {}) };
}

function resolveExam(W, S) {
  const sylStages = new Map(S.stages.map((s) => [s.id, s]));
  const wStages = new Map(W.stages.map((s) => [s.stageId, s]));
  const tracks = W.tracks.map((track) => {
    const stageW = new Map(track.stageWeights.map((s) => [s.stageId, s]));
    const agg = new Map(); // topicId → summary
    const stages = track.stageWeights.map((tsw) => {
      const ss = sylStages.get(tsw.stageId);
      const ws = wStages.get(tsw.stageId);
      const stageEff = effective(tsw.weight) / 100;
      const sylSecs = new Map(ss.sections.map((s) => [s.id, s]));
      const sections = ws.sections.map((sec) => {
        const sylSec = sylSecs.get(sec.sectionId);
        const secEff = stageEff * (effective(sec.weight) / 100);
        const gateContext = tsw.gate || sec.gate;
        const sylTopics = new Map(sylSec.topics.map((t) => [t.topicId, t]));
        const topics = sec.topics.map((t) => {
          const st = sylTopics.get(t.topicId);
          const overall = secEff * effective(t.weight); // % of exam
          const a = agg.get(t.topicId) ?? { topicId: t.topicId, name: topicLib[t.topicId].name, subject: topicLib[t.topicId].subject, overall: 0, occurrences: [], gateOnly: true, trends: [], confidences: [], bases: new Set(), customPriority: null };
          a.overall += overall;
          a.occurrences.push({ stageId: tsw.stageId, sectionId: sec.sectionId, weightInSection: effective(t.weight), overall: round4(overall) });
          if (!gateContext) a.gateOnly = false;
          a.trends.push(t.trend); a.confidences.push(t.weight.confidence); a.bases.add(t.weight.basis);
          a.customPriority ??= t.customPriority;
          agg.set(t.topicId, a);
          const subNames = new Map(st.subtopics.map((s) => [s.slug, s]));
          return {
            topicId: t.topicId, name: topicLib[t.topicId].name, subject: topicLib[t.topicId].subject,
            syllabusStatus: st.status, weight: wOut(t.weight), overall: round4(overall),
            expectedQuestions: t.expectedQuestions, trend: t.trend, customPriority: t.customPriority,
            subtopicWeighting: t.subtopicWeighting,
            subtopics: t.subtopics.map((s) => ({ id: `${t.topicId}.${s.slug}`, slug: s.slug, name: subNames.get(s.slug)?.name, syllabusStatus: subNames.get(s.slug)?.status, default: s.default, custom: s.custom, effective: s.custom ?? s.default, overall: round4(overall * ((s.custom ?? s.default) / 100)) })),
          };
        });
        assignPriorities(topics, (t) => t.weight.effective, (t, p) => (t.sectionPriority = p));
        for (const t of topics) t.sectionPriority ??= gateContext ? config.priority.gatePriority : 'Low';
        return {
          sectionId: sec.sectionId, name: sylSec.name, questions: sylSec.questions ?? null, marks: sylSec.marks ?? null,
          durationMinutes: sylSec.durationMinutes ?? null, gate: sec.gate, choiceGroup: sylSec.choiceGroup ?? null,
          weight: wOut(sec.weight), overall: round4(secEff * 100), topics,
        };
      });
      return { stageId: tsw.stageId, name: ss.name, gate: tsw.gate, weight: wOut(tsw.weight), overall: round4(stageEff * 100), sections };
    });
    // exam-level priority
    const summary = [...agg.values()];
    assignPriorities(summary.filter((a) => !a.gateOnly), (a) => a.overall, (a, p) => (a.computedPriority = p));
    const rank = { high: 0, medium: 1, low: 2, 'very-low': 3 };
    for (const a of summary) {
      if (a.gateOnly) a.computedPriority = config.priority.gatePriority;
      a.computedPriority ??= 'Low';
      a.priority = a.customPriority ?? a.computedPriority;
      a.overall = round4(a.overall);
      a.trend = a.trends.includes('fluctuating') || a.trends.includes('emerging') || a.trends.includes('declining')
        ? (a.trends.find((x) => ['emerging', 'declining'].includes(x)) ?? 'fluctuating') : (a.trends.includes('consistent') ? 'consistent' : a.trends[0]);
      a.confidence = a.confidences.sort((x, y) => rank[y] - rank[x])[0];
      a.basis = [...a.bases];
      a.isGate = a.gateOnly;
      a.scope = topicLib[a.topicId].coverage.scope;
      delete a.trends; delete a.confidences; delete a.bases; delete a.gateOnly;
    }
    summary.sort((x, y) => y.overall - x.overall);
    return { trackId: track.trackId, name: track.name, default: track.default, stages, topicSummary: summary };
  });
  return { examId: W.examId, shortName: S.shortName, name: S.name, category: S.category, syllabusCycle: W.syllabusCycle, lastUpdated: W.lastUpdated, tracks };
}

// ───────────────────────── cross-exam mapping ─────────────────────────
const examIds = registry.exams.map((e) => e.id);
const defaultTrack = (ex) => ex.tracks.find((t) => t.default);
const byExamTopic = new Map(); // topicId → { examId: {overall, priority} }
for (const ex of resolved)
  for (const a of defaultTrack(ex).topicSummary) {
    if (!byExamTopic.has(a.topicId)) byExamTopic.set(a.topicId, {});
    byExamTopic.get(a.topicId)[ex.examId] = { overall: a.overall, priority: a.priority, isGate: a.isGate };
  }
const groupOf = (t) => {
  const c = t.coverage;
  if (c.scope === 'universal' || c.scope === 'cross-category') return 'sscAndBanking';
  if (c.scope === 'category-common') return c.categories[0] === 'ssc' ? 'sscOnly' : 'bankingOnly';
  if (c.scope === 'exam-specific') return 'examSpecific';
  return 'unused';
};
const crossTopics = {};
const groups = { sscAndBanking: [], sscOnly: [], bankingOnly: [], examSpecific: [], unused: [] };
for (const [id, t] of Object.entries(topicLib)) {
  const g = groupOf(t);
  groups[g].push(id);
  const byExam = byExamTopic.get(id) ?? {};
  const vals = Object.values(byExam).map((v) => v.overall).filter((v) => v > 0);
  crossTopics[id] = {
    name: t.name, subject: t.subject, group: g, scope: t.coverage.scope, byExam,
    spread: vals.length > 1 ? { min: round4(Math.min(...vals)), max: round4(Math.max(...vals)), ratio: round2(Math.max(...vals) / Math.min(...vals)) } : null,
  };
}
const HIGH = ['Very High', 'High'];
const commonHigh = Object.entries(crossTopics)
  .map(([id, t]) => ({ topicId: id, name: t.name, highIn: examIds.filter((e) => HIGH.includes(t.byExam[e]?.priority) && !t.byExam[e]?.isGate), presentIn: Object.keys(t.byExam).length, byExam: t.byExam }))
  .filter((x) => x.highIn.length >= 5)
  .sort((a, b) => b.highIn.length - a.highIn.length || b.presentIn - a.presentIn);

// ───────────────────────── confidence coverage (data quality) ─────────────────────────
const dataQuality = resolved.map((ex) => {
  const t = defaultTrack(ex);
  const share = { high: 0, medium: 0, low: 0, 'very-low': 0 };
  for (const st of t.stages) {
    const seenGroups = new Set();
    for (const sec of st.sections) {
      if (sec.choiceGroup) { if (seenGroups.has(sec.choiceGroup)) continue; seenGroups.add(sec.choiceGroup); } // count one alternative
      for (const tp of sec.topics) share[tp.weight.confidence] += tp.overall;
    }
  }
  return { examId: ex.examId, share: Object.fromEntries(Object.entries(share).map(([k, v]) => [k, round2(v)])) };
});

// ───────────────────────── finish ─────────────────────────
const failures = [...checks.values()].reduce((a, c) => a + c.fail, 0);
const totalChecks = [...checks.values()].reduce((a, c) => a + c.pass + c.fail, 0);
const validation = {
  passed: failures === 0,
  totalChecks,
  failures,
  rules: [...checks.entries()].map(([name, c]) => ({ rule: name, passed: c.pass, failed: c.fail, failures: c.failures.slice(0, 20) })),
};
for (const r of validation.rules) for (const f of r.failures) console.error(`FAIL  [${r.rule}] ${f}`);
console.log(`${validation.passed ? '✔' : '✖'} weightage validation: ${totalChecks} checks, ${failures} failure(s) across ${validation.rules.length} rules`);
if (CHECK_ONLY) process.exit(validation.passed ? 0 : 1);
if (!validation.passed) { console.error('Not writing outputs because validation failed.'); process.exit(1); }

mkdirSync(DIST, { recursive: true });
const generatedAt = new Date().toISOString();
const out = {
  meta: {
    generatedAt, schemaVersion: config.schemaVersion, syllabusDataVersion: syllabus.meta.dataVersion,
    basisLegend: config.basisLegend, confidenceLegend: config.confidenceLegend, priority: config.priority,
    stageWeighting: config.stageWeighting, sectionWeighting: config.sectionWeighting, topicWeighting: config.topicWeighting, subtopicWeighting: config.subtopicWeighting,
    note: 'overall = % of the whole exam (track) = stage% × section% × topic% (× subtopic%). Stage and section weights are official-marks derived; topic and subtopic weights are estimates unless basis says otherwise.',
  },
  validation,
  evidence,
  exams: resolved,
  crossExam: { groups, topics: crossTopics, commonHighPriority: commonHigh },
  dataQuality,
};
writeFileSync(join(DIST, 'weightage.json'), JSON.stringify(out));
// Per-exam files for lazy loading in the app + a small index (everything except the exam trees).
mkdirSync(join(DIST, 'weightage'), { recursive: true });
for (const ex of resolved) writeFileSync(join(DIST, 'weightage', `${ex.examId}.json`), JSON.stringify(ex));
const { exams: _e, ...index } = out;
writeFileSync(join(DIST, 'weightage', 'index.json'), JSON.stringify({ ...index, examFiles: Object.fromEntries(resolved.map((e) => [e.examId, `${e.examId}.json`])) }));
writeFileSync(join(DIST, 'WEIGHTAGE_REPORT.md'), renderReport(out));
console.log('  → dist/weightage.json, dist/weightage/<exam>.json + index.json, dist/WEIGHTAGE_REPORT.md');
for (const ex of resolved) {
  const t = defaultTrack(ex);
  const count = (p) => t.topicSummary.filter((a) => a.priority === p).length;
  console.log(`  ${ex.shortName.padEnd(15)} VH ${String(count('Very High')).padStart(2)} · H ${String(count('High')).padStart(2)} · M ${String(count('Medium')).padStart(2)} · L ${String(count('Low')).padStart(2)}   top: ${t.topicSummary.filter((a) => !NON_ACADEMIC.has(a.subject)).slice(0, 3).map((a) => `${a.name} ${a.overall.toFixed(2)}%`).join(', ')}`);
}

// ───────────────────────── report ─────────────────────────
function renderReport(o) {
  const L = [];
  const pct = (x) => `${(+x).toFixed(2)}%`;
  const sn = Object.fromEntries(o.exams.map((e) => [e.examId, e.shortName]));
  const pAbbr = { 'Very High': 'VH', High: 'H', Medium: 'M', Low: 'L' };
  L.push('# Weightage Report', '', `_Generated ${o.meta.generatedAt} by scripts/build-weightage.mjs. Do not edit by hand. Source data: data/weightage/._`, '');
  L.push('> **Official vs estimated.** Stage and section weights are derived from **official marks** (`isOfficial: true`). Every topic and subtopic weight is an **estimate**: informed by secondary previous-year analyses (`pyq-estimate`), borrowed from a similar exam (`proxy-estimate`), or editorial judgement (`editorial-estimate`). No figure here is an official topic quota.', '');

  // 1. validation
  L.push('## 1. JSON validation results', '', `**${o.validation.passed ? 'PASSED' : 'FAILED'}**: ${o.validation.totalChecks} checks, ${o.validation.failures} failures.`, '', '| Rule | Passed | Failed |', '|---|---:|---:|');
  for (const r of o.validation.rules) L.push(`| ${r.rule} | ${r.passed} | ${r.failed} |`);

  // 2. exam-wise summary
  L.push('', '## 2. Exam-wise weightage summary (default track)', '', 'Confidence columns = share of the exam\'s total weight whose topic estimate has that confidence (high = official/nominal single-topic sections).', '', '| Exam | Stages (weight) | Topics | VH | H | M | L | high | medium | low | very-low |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const ex of o.exams) {
    const t = defaultTrack(ex);
    const c = (p) => t.topicSummary.filter((a) => a.priority === p).length;
    const dq = o.dataQuality.find((d) => d.examId === ex.examId).share;
    L.push(`| ${ex.shortName} | ${t.stages.map((s) => `${s.name.split(':')[0]} ${s.gate ? 'gate' : pct(s.weight.effective)}`).join('; ')} | ${t.topicSummary.length} | ${c('Very High')} | ${c('High')} | ${c('Medium')} | ${c('Low')} | ${pct(dq.high)} | ${pct(dq.medium)} | ${pct(dq.low)} | ${pct(dq['very-low'])} |`);
  }
  const multi = o.exams.filter((e) => e.tracks.length > 1);
  if (multi.length) {
    L.push('', 'Optional tracks (post-specific papers):', '');
    for (const ex of multi) for (const t of ex.tracks.filter((x) => !x.default)) L.push(`- **${ex.shortName}: ${t.name}**: ${t.stages.map((s) => `${s.stageId} ${s.gate ? 'gate' : pct(s.weight.effective)}`).join(', ')}`);
  }

  // 3. per exam: sections + top 10
  L.push('', '## 3. Exam detail: section-wise weightage and top 10 topics');
  for (const ex of o.exams) {
    const t = defaultTrack(ex);
    L.push('', `### ${ex.shortName}`, '', '| Stage | Section | Q | Marks | Weight in stage | Overall (% of exam) |', '|---|---|---:|---:|---:|---:|');
    for (const st of t.stages) {
      if (!st.sections.length) { L.push(`| ${st.name} | (no sections) | | | | ${st.gate ? 'gate' : pct(st.overall)} |`); continue; }
      for (const sec of st.sections) L.push(`| ${st.name} | ${sec.name}${sec.choiceGroup ? ' *(choice)*' : ''} | ${sec.questions ?? '–'} | ${sec.marks ?? '–'} | ${sec.gate || st.gate ? 'gate' : pct(sec.weight.effective)} | ${sec.gate || st.gate ? '0 (gate)' : pct(sec.overall)} |`);
    }
    L.push('', `**Top 10 academic topics: ${ex.shortName}**`, '', '| # | Topic | Overall | Priority | Trend | Confidence | Basis |', '|---:|---|---:|---|---|---|---|');
    t.topicSummary.filter((a) => !a.isGate && !NON_ACADEMIC.has(a.subject)).slice(0, 10).forEach((a, i) => L.push(`| ${i + 1} | ${a.name} | ${pct(a.overall)} | ${a.priority} | ${a.trend} | ${a.confidence} | ${a.basis.join(', ')} |`));
    const nonAcad = t.topicSummary.filter((a) => NON_ACADEMIC.has(a.subject));
    if (nonAcad.length) L.push('', `- **Non-academic components:** ${nonAcad.map((a) => `${a.name} ${a.isGate ? '(pass/fail gate, priority High)' : `${pct(a.overall)} (${a.priority})`}`).join('; ')}`);
    const acad = t.topicSummary.filter((a) => !NON_ACADEMIC.has(a.subject) && a.trend !== 'not-applicable' && HIGH.includes(a.priority));
    const consistentHigh = acad.filter((a) => a.trend === 'consistent').map((a) => a.name);
    const fluct = acad.filter((a) => a.trend !== 'consistent').map((a) => `${a.name} (${a.trend})`);
    L.push('', `- **Consistently high:** ${consistentHigh.join(', ') || '–'}`, `- **High but fluctuating/changing:** ${fluct.join(', ') || '–'}`);
  }

  // 4. common high priority
  L.push('', '## 4. Common high-priority topics across exams', '', 'Topics rated Very High or High (exam-level, default track) in at least 5 of the 9 exams.', '');
  L.push(`| Topic | High in | ${examIds.map((e) => sn[e]).join(' | ')} |`, `|---|---:|${examIds.map(() => ':-:').join('|')}|`);
  for (const c of o.crossExam.commonHighPriority) L.push(`| ${c.name} | ${c.highIn.length}/9 | ${examIds.map((e) => (c.byExam[e] ? `${pAbbr[c.byExam[e].priority] ?? c.byExam[e].priority} ${c.byExam[e].overall.toFixed(1)}` : '·')).join(' | ')} |`);

  // 5. cross-exam mapping
  const groupTitle = { sscAndBanking: 'Common to SSC and banking', sscOnly: 'Common only to SSC exams', bankingOnly: 'Common only to banking exams', examSpecific: 'Exam-specific' };
  L.push('', '## 5. Cross-exam topic mapping (default-track overall %)', '', 'Same topic, different weight: values are computed per exam, never copied across exams. "Spread" = highest ÷ lowest non-zero weight.');
  for (const g of ['sscAndBanking', 'sscOnly', 'bankingOnly', 'examSpecific']) {
    const ids = o.crossExam.groups[g];
    L.push('', `### ${groupTitle[g]} (${ids.length} topics)`, '', `| Topic | ${examIds.map((e) => sn[e]).join(' | ')} | Spread |`, `|---|${examIds.map(() => '---:').join('|')}|---:|`);
    const rows = ids.map((id) => o.crossExam.topics[id]).sort((a, b) => Object.values(b.byExam).reduce((s, v) => s + v.overall, 0) - Object.values(a.byExam).reduce((s, v) => s + v.overall, 0));
    for (const t of rows) L.push(`| ${t.name} | ${examIds.map((e) => (t.byExam[e] ? (t.byExam[e].isGate ? 'gate' : t.byExam[e].overall.toFixed(2)) : '·')).join(' | ')} | ${t.spread ? `${t.spread.ratio}×` : '–'} |`);
  }

  // 6. gaps
  L.push('', '## 6. Missing or uncertain historical data', '');
  for (const g of o.evidence.gaps) L.push(`- ${g}`);
  L.push('', '**Share of each exam\'s weight by evidence confidence** (topic level, default track):', '', '| Exam | high (official/nominal) | medium | low | very-low |', '|---|---:|---:|---:|---:|');
  for (const d of o.dataQuality) L.push(`| ${sn[d.examId]} | ${pct(d.share.high)} | ${pct(d.share.medium)} | ${pct(d.share.low)} | ${pct(d.share['very-low'])} |`);
  L.push('', '**Evidence sources** (secondary, candidate-recall based):', '');
  for (const s of o.evidence.sources) L.push(`- \`${s.id}\`: [${s.publisher}](${s.url}): ${s.covers}. _${s.reliability}_`);

  // 7. appendix
  L.push('', '## 7. Appendix: full topic weightage per section', '', 'Columns: weight within section · overall % of exam · section priority · expected questions per paper (estimate) · trend · basis/confidence.');
  for (const ex of o.exams) {
    L.push('', `<details><summary><b>${ex.shortName}</b></summary>`, '');
    for (const st of defaultTrack(ex).stages)
      for (const sec of st.sections) {
        L.push('', `**${st.name} → ${sec.name}** (section ${sec.gate || st.gate ? 'gate' : pct(sec.weight.effective)} of stage)`, '', '| Topic | In section | Overall | Sec. priority | Exp. Q | Trend | Basis / conf. |', '|---|---:|---:|---|---|---|---|');
        for (const tp of [...sec.topics].sort((a, b) => b.weight.effective - a.weight.effective))
          L.push(`| ${tp.name} | ${pct(tp.weight.effective)} | ${pct(tp.overall)} | ${tp.sectionPriority} | ${tp.expectedQuestions ? `${tp.expectedQuestions.min}–${tp.expectedQuestions.max}` : '–'} | ${tp.trend} | ${tp.weight.basis} / ${tp.weight.confidence} |`);
      }
    L.push('', '</details>');
  }
  return L.join('\n') + '\n';
}

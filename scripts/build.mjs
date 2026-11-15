#!/usr/bin/env node
/**
 * Validates the syllabus source data and builds React-ready outputs.
 *
 *   node scripts/build.mjs            → validate + write dist/
 *   node scripts/build.mjs --check    → validate only (CI); exits 1 on errors
 *
 * Inputs  (source of truth, hand-edited):
 *   data/registry.json, data/sources.json, data/library/topics.json, data/exams/*.json
 * Outputs (generated, never hand-edit):
 *   dist/syllabus.json  – fully resolved Exam → Stage → Section → Topic → Subtopic tree
 *                          + topic catalogue with computed coverage/scope
 *   dist/overlap.json   – overlap analysis (scopes, exam×exam matrix, SSC×Banking list)
 *   dist/OVERLAP.md     – human-readable overlap report
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');
const CHECK_ONLY = process.argv.includes('--check');

const STATUSES = ['official', 'official-umbrella', 'pyq-derived', 'unverified'];
const STATUS_RANK = Object.fromEntries(STATUSES.map((s, i) => [s, i])); // lower = stronger
const NATURES = ['qualifying', 'merit', 'mandatory-unscored'];

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(join(DATA, rel), 'utf8'));
  } catch (e) {
    err(`${rel}: cannot read/parse – ${e.message}`);
    return null;
  }
}
const strongest = (a, b) => (a == null ? b : STATUS_RANK[b] < STATUS_RANK[a] ? b : a);

// ───────────────────────── load ─────────────────────────
const registry = readJson('registry.json');
const sourcesDoc = readJson('sources.json');
const library = readJson('library/topics.json');
if (!registry || !sourcesDoc || !library) finish();

// ───────────────────────── library ─────────────────────────
const subjects = new Map();
for (const s of library.subjects) {
  if (subjects.has(s.id)) err(`library: duplicate subject id '${s.id}'`);
  subjects.set(s.id, s);
}
const topics = new Map();
for (const t of library.topics) {
  if (topics.has(t.id)) err(`library: duplicate topic id '${t.id}'`);
  if (!subjects.has(t.subject)) err(`library: topic '${t.id}' has unknown subject '${t.subject}'`);
  if (!t.id.startsWith(`${t.subject}.`)) warn(`library: topic id '${t.id}' does not start with its subject '${t.subject}.'`);
  if (!Array.isArray(t.subtopics) || t.subtopics.length === 0) err(`library: topic '${t.id}' has no subtopics`);
  const slugs = new Set();
  for (const st of t.subtopics ?? []) {
    if (!/^[a-z0-9-]+$/.test(st.id)) err(`library: subtopic slug '${st.id}' in '${t.id}' must be kebab-case`);
    if (slugs.has(st.id)) err(`library: duplicate subtopic '${st.id}' in '${t.id}'`);
    slugs.add(st.id);
  }
  topics.set(t.id, { ...t, slugs });
}
for (const t of topics.values())
  for (const r of t.related ?? []) if (!topics.has(r)) err(`library: '${t.id}' relates to unknown topic '${r}'`);

// ───────────────────────── sources & categories ─────────────────────────
const sources = new Map(sourcesDoc.sources.map((s) => [s.id, s]));
const categories = new Map(registry.categories.map((c) => [c.id, c]));

// ───────────────────────── exams ─────────────────────────
const exams = [];
const examIds = new Set();
for (const entry of registry.exams) {
  if (examIds.has(entry.id)) err(`registry: duplicate exam id '${entry.id}'`);
  examIds.add(entry.id);
  if (!categories.has(entry.category)) err(`registry: exam '${entry.id}' has unknown category '${entry.category}'`);
  const exam = readJson(entry.file);
  if (!exam) continue;
  if (exam.id !== entry.id) err(`${entry.file}: id '${exam.id}' ≠ registry id '${entry.id}'`);
  if (exam.category !== entry.category) err(`${entry.file}: category '${exam.category}' ≠ registry '${entry.category}'`);
  for (const s of exam.sources ?? []) if (!sources.has(s)) err(`${exam.id}: unknown source '${s}'`);
  exams.push(exam);
}

/** usage[topicId][examId] = { status, sections: [...] } ; subUsage[subId][examId] = status */
const usage = new Map();
const subUsage = new Map();

function resolveTopicRef(ref, where, examId) {
  const t = topics.get(ref.topic);
  if (!t) {
    err(`${where}: unknown topic '${ref.topic}'`);
    return null;
  }
  if (!STATUSES.includes(ref.status)) err(`${where} ${ref.topic}: invalid status '${ref.status}'`);
  if (ref.subtopicStatus && !STATUSES.includes(ref.subtopicStatus))
    err(`${where} ${ref.topic}: invalid subtopicStatus '${ref.subtopicStatus}'`);
  for (const key of ['only', 'exclude', 'verbatim'])
    for (const slug of ref[key] ?? []) if (!t.slugs.has(slug)) err(`${where} ${ref.topic}: ${key} has unknown subtopic '${slug}'`);
  for (const [slug, ov] of Object.entries(ref.override ?? {})) {
    if (!t.slugs.has(slug)) err(`${where} ${ref.topic}: override has unknown subtopic '${slug}'`);
    if (ov.status && !STATUSES.includes(ov.status)) err(`${where} ${ref.topic}: override '${slug}' invalid status '${ov.status}'`);
  }
  if (ref.only && ref.exclude) warn(`${where} ${ref.topic}: both 'only' and 'exclude' given; 'exclude' applied after 'only'`);

  let subs = t.subtopics;
  if (ref.only) subs = subs.filter((s) => ref.only.includes(s.id));
  if (ref.exclude) subs = subs.filter((s) => !ref.exclude.includes(s.id));
  const included = new Set(subs.map((s) => s.id));
  for (const slug of ref.verbatim ?? []) if (!included.has(slug)) warn(`${where} ${ref.topic}: verbatim '${slug}' is not included`);
  if (subs.length === 0) err(`${where} ${ref.topic}: no subtopics left after only/exclude`);

  const verbatim = new Set(ref.verbatim ?? []);
  // Default status for subtopics not named verbatim:
  //  - explicit subtopicStatus wins
  //  - an 'official' topic with a single included subtopic → that subtopic IS the topic → official
  //  - otherwise an 'official' topic's unnamed subtopics are 'official-umbrella'; other statuses inherit
  const fallback =
    ref.subtopicStatus ??
    (ref.status === 'official' ? (subs.length === 1 ? 'official' : 'official-umbrella') : ref.status);

  const resolvedSubs = subs.map((s) => {
    const ov = ref.override?.[s.id];
    const status = ov?.status ?? (verbatim.has(s.id) ? 'official' : fallback);
    const id = `${t.id}.${s.id}`;
    // usage bookkeeping
    if (!subUsage.has(id)) subUsage.set(id, new Map());
    const su = subUsage.get(id);
    su.set(examId, strongest(su.get(examId), status));
    return { id, slug: s.id, name: s.name, status, ...(ov?.note ? { note: ov.note } : {}) };
  });

  if (!usage.has(t.id)) usage.set(t.id, new Map());
  const u = usage.get(t.id);
  const prev = u.get(examId) ?? { status: null, sections: [] };
  prev.status = strongest(prev.status, ref.status);
  prev.sections.push(where);
  u.set(examId, prev);

  return {
    topicId: t.id,
    name: t.name,
    subject: t.subject,
    ...(t.group ? { group: t.group } : {}),
    status: ref.status,
    ...(ref.officialLabel ? { officialLabel: ref.officialLabel } : {}),
    ...(ref.note ? { note: ref.note } : {}),
    subtopics: resolvedSubs,
  };
}

function sumCheck(stage, where) {
  const p = stage.pattern;
  if (!p) return;
  const seenGroups = new Set();
  let q = 0, m = 0, qAny = false, mAny = false;
  for (const sec of stage.sections) {
    if (sec.choiceGroup) {
      if (seenGroups.has(sec.choiceGroup)) continue;
      seenGroups.add(sec.choiceGroup);
    }
    if (typeof sec.questions === 'number') { q += sec.questions; qAny = true; }
    if (typeof sec.marks === 'number') { m += sec.marks; mAny = true; }
  }
  if (qAny && typeof p.questions === 'number' && q !== p.questions) warn(`${where}: sections sum to ${q} questions, pattern says ${p.questions}`);
  if (mAny && typeof p.marks === 'number' && m !== p.marks) warn(`${where}: sections sum to ${m} marks, pattern says ${p.marks}`);
}

const resolvedExams = exams.map((exam) => {
  const stageIds = new Set();
  const stages = [...exam.stages].sort((a, b) => a.order - b.order).map((stage) => {
    const sWhere = `${exam.id}/${stage.id}`;
    if (stageIds.has(stage.id)) err(`${sWhere}: duplicate stage id`);
    stageIds.add(stage.id);
    if (!NATURES.includes(stage.nature)) err(`${sWhere}: invalid nature '${stage.nature}'`);
    if (stage.source && !sources.has(stage.source.id)) err(`${sWhere}: unknown source '${stage.source.id}'`);
    const secIds = new Set();
    const sections = stage.sections.map((sec) => {
      const where = `${sWhere}/${sec.id}`;
      if (secIds.has(sec.id)) err(`${where}: duplicate section id`);
      secIds.add(sec.id);
      if (sec.nature && !NATURES.includes(sec.nature)) err(`${where}: invalid nature '${sec.nature}'`);
      const seenTopics = new Set();
      const topicsOut = [];
      for (const ref of sec.topics ?? []) {
        if (seenTopics.has(ref.topic)) err(`${where}: topic '${ref.topic}' listed twice`);
        seenTopics.add(ref.topic);
        const r = resolveTopicRef(ref, where, exam.id);
        if (r) topicsOut.push(r);
      }
      const { topics: _drop, ...secMeta } = sec;
      return {
        key: where,
        ...secMeta,
        nature: sec.nature ?? stage.nature,
        topics: topicsOut,
        counts: {
          topics: topicsOut.length,
          subtopics: topicsOut.reduce((n, t) => n + t.subtopics.length, 0),
        },
      };
    });
    sumCheck({ ...stage, sections }, sWhere);
    const { sections: _s, ...stageMeta } = stage;
    return { key: sWhere, ...stageMeta, sections };
  });
  const allSubs = new Set();
  const allTopics = new Set();
  for (const st of stages)
    for (const sec of st.sections)
      for (const t of sec.topics) {
        allTopics.add(t.topicId);
        for (const s of t.subtopics) allSubs.add(s.id);
      }
  // count each subtopic once, at its strongest status across all stages of this exam
  const statusCount = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const id of allSubs) statusCount[subUsage.get(id).get(exam.id)]++;
  const { stages: _st, $schema: _sc, ...meta } = exam;
  return {
    ...meta,
    stages,
    counts: { stages: stages.length, uniqueTopics: allTopics.size, uniqueSubtopics: allSubs.size, subtopicsByStatus: statusCount },
  };
});

// ───────────────────────── coverage & overlap ─────────────────────────
const catOf = Object.fromEntries(registry.exams.map((e) => [e.id, e.category]));
const shortName = Object.fromEntries(resolvedExams.map((e) => [e.id, e.shortName ?? e.id]));
const ALL = registry.exams.map((e) => e.id);

function coverageOf(examStatusMap) {
  const ids = ALL.filter((id) => examStatusMap?.has(id));
  const byCategory = {};
  for (const id of ids) (byCategory[catOf[id]] ??= []).push(id);
  const cats = Object.keys(byCategory);
  let scope;
  if (ids.length === 0) scope = 'unused';
  else if (ids.length === ALL.length) scope = 'universal';
  else if (cats.length > 1) scope = 'cross-category';
  else if (ids.length > 1) scope = 'category-common';
  else scope = 'exam-specific';
  const allOfCategory = cats.filter((c) => byCategory[c].length === ALL.filter((id) => catOf[id] === c).length);
  const statusByExam = Object.fromEntries(ids.map((id) => {
    const v = examStatusMap.get(id);
    return [id, typeof v === 'string' ? v : v.status];
  }));
  return { scope, examCount: ids.length, exams: ids, categories: cats, byCategory, completeInCategories: allOfCategory, statusByExam };
}

const topicCatalogue = {};
for (const t of topics.values()) {
  const { slugs: _s, ...rest } = t;
  topicCatalogue[t.id] = {
    ...rest,
    subtopics: t.subtopics.map((s) => {
      const id = `${t.id}.${s.id}`;
      return { id, slug: s.id, name: s.name, coverage: coverageOf(subUsage.get(id)) };
    }),
    coverage: coverageOf(usage.get(t.id)),
  };
}

// exam × exam shared-subtopic matrix
const examSubSets = Object.fromEntries(ALL.map((id) => [id, new Set()]));
for (const [subId, m] of subUsage) for (const id of m.keys()) examSubSets[id].add(subId);
const matrix = ALL.map((a) => ALL.map((b) => {
  let n = 0;
  for (const s of examSubSets[a]) if (examSubSets[b].has(s)) n++;
  return n;
}));
const jaccard = ALL.map((a, i) => ALL.map((b, j) => {
  const union = examSubSets[a].size + examSubSets[b].size - matrix[i][j];
  return union ? Math.round((matrix[i][j] / union) * 1000) / 1000 : 0;
}));

const byScope = (scope) => Object.values(topicCatalogue).filter((t) => t.coverage.scope === scope).map((t) => t.id);
const crossCategory = Object.values(topicCatalogue)
  .filter((t) => t.coverage.categories.length > 1)
  .map((t) => {
    const sharedSubs = t.subtopics.filter((s) => s.coverage.categories.length > 1).map((s) => s.id);
    return {
      topicId: t.id,
      name: t.name,
      subject: t.subject,
      byCategory: t.coverage.byCategory,
      statusByExam: t.coverage.statusByExam,
      sharedSubtopics: sharedSubs,
      categoryOnlySubtopics: Object.fromEntries(
        t.coverage.categories.map((c) => [c, t.subtopics.filter((s) => s.coverage.categories.length === 1 && s.coverage.categories[0] === c).map((s) => s.id)])
      ),
    };
  });
const examSpecific = {};
for (const t of Object.values(topicCatalogue))
  if (t.coverage.scope === 'exam-specific') (examSpecific[t.coverage.exams[0]] ??= []).push(t.id);
const categoryCommon = {};
for (const t of Object.values(topicCatalogue))
  if (t.coverage.scope === 'category-common') (categoryCommon[t.coverage.categories[0]] ??= []).push(t.id);

const unused = byScope('unused');
for (const id of unused) warn(`library: topic '${id}' is not used by any exam`);

finish();

// ───────────────────────── output ─────────────────────────
function finish() {
  for (const w of warnings) console.warn(`WARN  ${w}`);
  for (const e of errors) console.error(`ERROR ${e}`);
  if (errors.length) {
    console.error(`\n✖ ${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }
  if (CHECK_ONLY) {
    console.log(`✔ valid – ${warnings.length} warning(s)`);
    process.exit(0);
  }
  writeOutputs();
}

function writeOutputs() {
  mkdirSync(DIST, { recursive: true });
  const generatedAt = new Date().toISOString();
  const meta = {
    generatedAt,
    schemaVersion: registry.schemaVersion,
    dataVersion: registry.dataVersion,
    statusLegend: registry.statusLegend,
    scopeLegend: {
      universal: 'Used by every exam in the registry.',
      'cross-category': 'Shared by exams of at least two categories (e.g. SSC and Banking).',
      'category-common': 'Shared by 2+ exams of a single category only.',
      'exam-specific': 'Used by exactly one exam.',
      unused: 'In the library but not referenced by any exam.',
    },
  };

  const syllabus = {
    meta,
    categories: registry.categories,
    subjects: library.subjects,
    sources: sourcesDoc.sources,
    topics: topicCatalogue,
    exams: resolvedExams,
  };
  writeFileSync(join(DIST, 'syllabus.json'), JSON.stringify(syllabus, null, 2));

  const overlap = {
    meta,
    exams: ALL,
    topicsByScope: {
      universal: byScope('universal'),
      crossCategory: byScope('cross-category'),
      categoryCommon,
      examSpecific,
      unused,
    },
    crossCategoryOverlap: crossCategory,
    sharedSubtopicMatrix: { exams: ALL, counts: matrix, jaccard },
  };
  writeFileSync(join(DIST, 'overlap.json'), JSON.stringify(overlap, null, 2));
  writeFileSync(join(DIST, 'OVERLAP.md'), renderMarkdown(overlap, generatedAt));

  const totalSubs = Object.values(topicCatalogue).reduce((n, t) => n + t.subtopics.length, 0);
  console.log(`✔ ${resolvedExams.length} exams · ${topics.size} topics · ${totalSubs} subtopics · ${warnings.length} warning(s)`);
  for (const e of resolvedExams)
    console.log(`  ${(e.shortName ?? e.id).padEnd(16)} ${String(e.counts.uniqueTopics).padStart(3)} topics  ${String(e.counts.uniqueSubtopics).padStart(4)} subtopics  ${JSON.stringify(e.counts.subtopicsByStatus)}`);
  console.log(`  scopes: universal ${overlap.topicsByScope.universal.length}, cross-category ${overlap.topicsByScope.crossCategory.length}, ` +
    `category-common ${Object.values(categoryCommon).flat().length}, exam-specific ${Object.values(examSpecific).flat().length}, unused ${unused.length}`);
  console.log(`  → dist/syllabus.json, dist/overlap.json, dist/OVERLAP.md`);
}

function renderMarkdown(o, generatedAt) {
  const name = (id) => topicCatalogue[id]?.name ?? id;
  const sn = (id) => shortName[id] ?? id;
  const lines = [];
  lines.push('# Syllabus Overlap Report', '', `_Generated ${generatedAt} by scripts/build.mjs. Do not edit by hand._`, '');
  lines.push('## Exam summary', '', '| Exam | Topics | Subtopics | Official | Umbrella | PYQ-derived | Unverified |', '|---|---:|---:|---:|---:|---:|---:|');
  for (const e of resolvedExams) {
    const s = e.counts.subtopicsByStatus;
    lines.push(`| ${sn(e.id)} | ${e.counts.uniqueTopics} | ${e.counts.uniqueSubtopics} | ${s.official} | ${s['official-umbrella']} | ${s['pyq-derived']} | ${s.unverified} |`);
  }
  lines.push('', '## Shared subtopics (exam × exam)', '', 'Cell = number of subtopics both exams include (diagonal = exam total). Jaccard similarity in brackets.', '');
  lines.push(`| | ${ALL.map(sn).join(' | ')} |`, `|---|${ALL.map(() => '---:').join('|')}|`);
  ALL.forEach((a, i) => lines.push(`| **${sn(a)}** | ${ALL.map((_, j) => (i === j ? `**${o.sharedSubtopicMatrix.counts[i][j]}**` : `${o.sharedSubtopicMatrix.counts[i][j]} (${Math.round(o.sharedSubtopicMatrix.jaccard[i][j] * 100)}%)`)).join(' | ')} |`));
  lines.push('', `## Universal topics (all ${ALL.length} exams)`, '');
  for (const id of o.topicsByScope.universal) lines.push(`- ${name(id)} \`${id}\``);
  lines.push('', '## SSC ↔ Banking overlap (cross-category)', '', 'Status shows how each exam treats the topic: **O** official · **U** official-umbrella · **P** PYQ-derived · **?** unverified.', '');
  lines.push(`| Topic | ${ALL.map(sn).join(' | ')} | Shared subtopics |`, `|---|${ALL.map(() => ':-:').join('|')}|---:|`);
  const code = { official: 'O', 'official-umbrella': 'U', 'pyq-derived': 'P', unverified: '?' };
  for (const c of o.crossCategoryOverlap) {
    const total = topicCatalogue[c.topicId].subtopics.length;
    lines.push(`| ${c.name} | ${ALL.map((id) => code[c.statusByExam[id]] ?? '·').join(' | ')} | ${c.sharedSubtopics.length}/${total} |`);
  }
  lines.push('', '## Category-common topics', '');
  for (const [cat, ids] of Object.entries(o.topicsByScope.categoryCommon)) {
    lines.push(`### ${categories.get(cat)?.name ?? cat} only`, '');
    for (const id of ids) lines.push(`- ${name(id)}: ${topicCatalogue[id].coverage.exams.map(sn).join(', ')}`);
    lines.push('');
  }
  lines.push('## Exam-specific topics', '');
  for (const id of ALL) {
    const list = o.topicsByScope.examSpecific[id];
    if (!list) continue;
    lines.push(`### ${sn(id)}`, '', ...list.map((t) => `- ${name(t)} \`${t}\``), '');
  }
  if (o.topicsByScope.unused.length) lines.push('## Unused library topics', '', ...o.topicsByScope.unused.map((t) => `- ${name(t)} \`${t}\``), '');
  return lines.join('\n');
}

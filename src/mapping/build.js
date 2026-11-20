/**
 * Builds the master topic database and cross-exam mapping (pure; no I/O).
 *
 * Identity comes from stable IDs only: a master topic is one canonical Phase-1 library topic
 * (`mt.<libraryTopicId>`). Names are never used for matching. A master exists when ≥ minExamsForMaster
 * exams include the topic. Related-but-different concepts are linked (relatedMasterTopics), never merged.
 *
 * Mapping quality: the subtopic sets each exam includes are compared pairwise (Jaccard). The minimum
 * overlap sets the similarity level, which drives the default verification status and sync mode.
 * Manual overrides (overrides.json) are validated and applied last, so regeneration never loses them.
 */

const SYNC_MODES = ['full', 'partial', 'independent'];
const VERIFICATION = ['verified', 'needs-review', 'rejected'];

export const masterIdOf = (topicId, prefix = 'mt.') => `${prefix}${topicId}`;
export const topicIdOfMaster = (masterId, prefix = 'mt.') => (masterId.startsWith(prefix) ? masterId.slice(prefix.length) : null);

const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 1;
};
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * @param {object} p
 * @param {object[]} p.exams          syllabus exams (dist/syllabus.json → exams)
 * @param {object} [p.libraryTopics]  dist/syllabus.json → topics (names, subject, related); optional
 * @param {object[]} [p.subjects]     dist/syllabus.json → subjects; optional
 * @param {object} p.config           data/mapping/config.json
 * @param {object} [p.overrides]      data/mapping/overrides.json
 * @param {string} [p.dataVersion]
 */
export function buildMapping({ exams, libraryTopics = {}, subjects = [], config, overrides = {}, dataVersion = null }) {
  const errors = [];
  const warnings = [];
  const prefix = config.masterIdPrefix ?? 'mt.';
  const subjectName = Object.fromEntries(subjects.map((s) => [s.id, s.name]));
  const examById = new Map(exams.map((e) => [e.id, e]));

  // ── 1. collect every topic occurrence by stable library topic ID ──
  const occ = new Map();
  for (const exam of exams)
    for (const st of exam.stages)
      for (const sec of st.sections)
        for (const t of sec.topics) {
          if (!occ.has(t.topicId)) occ.set(t.topicId, []);
          occ.get(t.topicId).push({ exam, stage: st, section: sec, topic: t });
        }

  // ── 2. validate overrides (no silent mistakes) ──
  const ov = overrides.masters ?? {};
  const excluded = new Set();
  for (const [mid, o] of Object.entries(ov)) {
    const tid = topicIdOfMaster(mid, prefix);
    if (!tid || !occ.has(tid)) { errors.push(`overrides.masters: '${mid}' does not match any library topic used by an exam`); continue; }
    if (o.syncMode && !SYNC_MODES.includes(o.syncMode)) errors.push(`overrides.masters.${mid}.syncMode '${o.syncMode}' must be one of ${SYNC_MODES.join(', ')}`);
    if (o.verification?.status && !VERIFICATION.includes(o.verification.status)) errors.push(`overrides.masters.${mid}.verification.status '${o.verification.status}' invalid`);
    for (const key of Object.keys(o.requirements ?? {})) {
      const err = checkRequirementKey(key, tid, occ.get(tid), examById);
      if (err) errors.push(`overrides.masters.${mid}.requirements: ${err}`);
    }
  }
  for (const x of overrides.excludeMappings ?? []) {
    const tid = topicIdOfMaster(x.masterTopicId ?? '', prefix);
    if (!tid || !occ.get(tid)?.some((o) => o.exam.id === x.examId)) errors.push(`excludeMappings: '${x.masterTopicId}' is not used by exam '${x.examId}'`);
    else excluded.add(`${tid}|${x.examId}`);
    if (!x.reason) warnings.push(`excludeMappings ${x.masterTopicId}/${x.examId}: no reason given`);
  }

  // ── 3. requirements per occurrence ──
  const reqFor = (o) => buildRequirement(o, config, ov[masterIdOf(o.topic.topicId, prefix)]?.requirements);

  // ── 4. masters, mapping entries, by-exam index ──
  const masters = [];
  const mappings = {};
  const byExam = {};
  const unmapped = [];
  const excludedList = [];
  const review = [];
  for (const exam of exams) byExam[exam.id] = {};

  for (const [topicId, list] of [...occ.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const mid = masterIdOf(topicId, prefix);
    const lib = libraryTopics[topicId] ?? {};
    const name = lib.name ?? list[0].topic.name;
    const subject = lib.subject ?? list[0].topic.subject;
    const included = list.filter((o) => !excluded.has(`${topicId}|${o.exam.id}`));
    for (const o of list) if (excluded.has(`${topicId}|${o.exam.id}`)) excludedList.push({ masterTopicId: mid, examId: o.exam.id, stageId: o.stage.id, sectionId: o.section.id, topicId, reason: (overrides.excludeMappings.find((x) => x.masterTopicId === mid && x.examId === o.exam.id) ?? {}).reason ?? '' });
    const examIds = [...new Set(included.map((o) => o.exam.id))];
    const isMaster = examIds.length >= (config.minExamsForMaster ?? 2);

    // exam-level requirement + index entry (for every exam topic, mapped or not)
    for (const exam of exams) {
      const mine = list.filter((o) => o.exam.id === exam.id);
      if (!mine.length) continue;
      const stageReqs = mine.map((o) => reqFor(o));
      const mapped = isMaster && !excluded.has(`${topicId}|${exam.id}`);
      // requirements are stored once here (exam level = strictest; plus each stage occurrence)
      byExam[exam.id][topicId] = {
        masterTopicId: mapped ? mid : null,
        mappingIds: mine.map(mappingIdOf),
        requirement: strictest(stageReqs, config),
        stageRequirements: Object.fromEntries(mine.map((o, i) => [`${o.stage.id}/${o.section.id}`, stageReqs[i]])),
      };
      if (!mapped) unmapped.push({ examId: exam.id, topicId, reason: excluded.has(`${topicId}|${exam.id}`) ? 'excluded-by-override' : 'single-exam-topic' });
    }
    if (!isMaster) {
      if (ov[mid]) warnings.push(`overrides for '${mid}' ignored: the topic is used by fewer than ${config.minExamsForMaster ?? 2} exams`);
      continue;
    }

    // similarity from the subtopic sets each exam includes
    const subsByExam = {};
    for (const o of included) subsByExam[o.exam.id] = [...new Set([...(subsByExam[o.exam.id] ?? []), ...o.topic.subtopics.map((s) => s.id)])];
    const sets = Object.values(subsByExam);
    let minJ = 1, sumJ = 0, pairs = 0;
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) { const v = jaccard(sets[i], sets[j]); minJ = Math.min(minJ, v); sumJ += v; pairs++; }
    const T = config.similarity.thresholds;
    const level = minJ >= T.identical ? 'identical' : minJ >= T.high ? 'high' : minJ >= T.partial ? 'partial' : 'low';
    const shared = sets.reduce((acc, s) => acc.filter((x) => s.includes(x)), sets[0]);
    const union = [...new Set(sets.flat())].sort();

    const auto = config.verificationByLevel[level];
    const o = ov[mid] ?? {};
    const verification = o.verification?.status
      ? { status: o.verification.status, method: 'manual', note: o.verification.note ?? '' }
      : { status: auto, method: 'auto', note: auto === 'verified' ? `Same stable library ID; subtopic overlap ${level} (min Jaccard ${round3(minJ)}).` : `Same library ID, but the subtopics each exam includes differ (min Jaccard ${round3(minJ)}). Review before relying on full sync.` };
    let defaultSyncMode = o.syncMode ?? config.defaultSyncModeByLevel[level];
    if (verification.status === 'rejected') defaultSyncMode = 'independent';
    const categories = [...new Set(included.map((x) => x.exam.category))].sort();
    if (verification.status !== 'verified') review.push({ masterTopicId: mid, name, status: verification.status, similarity: level, note: verification.note });

    masters.push({
      masterTopicId: mid,
      libraryTopicId: topicId,
      name,
      subject,
      subjectName: subjectName[subject] ?? subject,
      group: lib.group ?? null,
      exams: examIds,
      categories,
      coverage: categories.length > 1 ? 'ssc-and-banking' : categories[0] === 'ssc' ? 'ssc-only' : categories[0] === 'banking' ? 'banking-only' : `${categories[0]}-only`,
      similarity: { level, minJaccard: round3(minJ), avgJaccard: round3(pairs ? sumJ / pairs : 1) },
      verification,
      defaultSyncMode,
      sharedSubtopicIds: shared.sort(),
      subtopicIds: union,
      relatedMasterTopics: [],
      ...(o.note ? { note: o.note } : {}),
    });
    mappings[mid] = included.map((x) => ({
      mappingId: mappingIdOf(x),
      examId: x.exam.id,
      category: x.exam.category,
      stageId: x.stage.id,
      sectionId: x.section.id,
      topicId,
      subtopicSlugs: x.topic.subtopics.map((s) => s.slug),
      similarityToCore: round3(shared.length / Math.max(1, x.topic.subtopics.length)),
    }));
  }

  // ── 5. related concepts (library `related` + manual links), never synced ──
  const masterSet = new Set(masters.map((m) => m.masterTopicId));
  const links = new Map();
  const addLink = (a, b, relation, note, source) => {
    if (a === b || !masterSet.has(a) || !masterSet.has(b)) return false;
    const key = [a, b].sort().join('|');
    if (!links.has(key)) links.set(key, { a, b, relation, note, source });
    return true;
  };
  for (const m of masters) for (const r of libraryTopics[m.libraryTopicId]?.related ?? []) addLink(m.masterTopicId, masterIdOf(r, prefix), 'related-concept', 'From the Phase-1 library `related` list.', 'library');
  for (const l of overrides.relatedLinks?.add ?? []) if (!addLink(l.from, l.to, l.relation ?? 'related-concept', l.note ?? '', 'manual')) errors.push(`relatedLinks.add: '${l.from}' → '${l.to}' must link two different existing master topics`);
  for (const l of overrides.relatedLinks?.remove ?? []) if (!links.delete([l.from, l.to].sort().join('|'))) warnings.push(`relatedLinks.remove: no link '${l.from}' ↔ '${l.to}'`);
  const byId = new Map(masters.map((m) => [m.masterTopicId, m]));
  for (const { a, b, relation, note, source } of links.values()) {
    byId.get(a).relatedMasterTopics.push({ masterTopicId: b, relation, sync: 'never', verification: 'needs-review', source, note });
    byId.get(b).relatedMasterTopics.push({ masterTopicId: a, relation, sync: 'never', verification: 'needs-review', source, note });
  }
  for (const m of masters) m.relatedMasterTopics.sort((x, y) => x.masterTopicId.localeCompare(y.masterTopicId));

  // ── 6. integrity checks ──
  if (masterSet.size !== masters.length) errors.push('duplicate master topic IDs');
  const seenMapping = new Set();
  for (const list of Object.values(mappings)) for (const m of list) {
    if (seenMapping.has(m.mappingId)) errors.push(`duplicate mapping '${m.mappingId}'`);
    seenMapping.add(m.mappingId);
  }

  const meta = {
    generatedFrom: { syllabusDataVersion: dataVersion, mappingConfigVersion: config.schemaVersion, overridesVersion: overrides.schemaVersion ?? null },
    counts: {
      masters: masters.length,
      mappings: seenMapping.size,
      bySimilarity: countBy(masters, (m) => m.similarity.level),
      byVerification: countBy(masters, (m) => m.verification.status),
      byDefaultSyncMode: countBy(masters, (m) => m.defaultSyncMode),
      byCoverage: countBy(masters, (m) => m.coverage),
      unmappedExamTopics: unmapped.length,
      excluded: excludedList.length,
    },
  };
  return {
    masterTopics: { meta, masters },
    crossExamMapping: { meta, mappings, byExam, unmapped, excluded: excludedList, review },
    errors,
    warnings,
  };
}

const mappingIdOf = (o) => `${o.exam.id}/${o.stage.id}/${o.section.id}/${o.topic.topicId}`;
const countBy = (arr, f) => arr.reduce((acc, x) => { const k = f(x); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});

export function stageClassOf(stageId, config) {
  for (const [cls, ids] of Object.entries(config.stageClasses)) if (ids.includes(stageId)) return cls;
  return 'other';
}

function buildRequirement(o, config, ovReqs = {}) {
  const stageClass = stageClassOf(o.stage.id, config);
  const examLevel = config.examLevels?.[o.exam.id] ?? null;
  const ctx = { category: o.exam.category, stageClass, examLevel };
  const profile = config.requirementProfiles.find((p) => Object.entries(p.match).every(([k, v]) => ctx[k] === v));
  const nonMcq = (config.nonMcqSubjects ?? []).includes(o.topic.subject);
  // official pace: section duration ÷ questions, else stage duration ÷ stage questions
  let speed = null, speedBasis = null;
  if (!nonMcq) {
    if (o.section.durationMinutes > 0 && o.section.questions > 0) { speed = (o.section.durationMinutes * 60) / o.section.questions; speedBasis = 'official-section-pace'; }
    else if (o.stage.pattern?.durationMinutes > 0 && o.stage.pattern?.questions > 0) { speed = (o.stage.pattern.durationMinutes * 60) / o.stage.pattern.questions; speedBasis = 'official-stage-pace'; }
  }
  const nm = nonMcq ? config.nonMcqDepth?.[o.topic.subject] : null;
  let req = {
    stageClass,
    depth: nm?.depth ?? profile.depth,
    depthDescription: nm?.depthDescription ?? profile.depthDescription,
    difficulty: nonMcq ? null : profile.difficulty,
    questionTarget: nonMcq ? null : profile.questionTarget,
    accuracyTarget: nonMcq ? null : profile.accuracyTarget,
    speedTargetSec: speed === null ? null : Math.round(speed * 10) / 10,
    speedBasis,
    source: 'profile',
  };
  // overrides from least to most specific
  const keys = ['*', `@${o.exam.category}`, `@${o.exam.category}:${stageClass}`, o.exam.id, `${o.exam.id}/${o.stage.id}`];
  for (const k of keys) {
    const x = ovReqs?.[k];
    if (x) req = { ...req, ...x, source: 'manual-override' };
  }
  return req;
}

/** Exam-level requirement when a topic appears in several stages: the strictest one applies. */
function strictest(reqs, config) {
  const rank = config.stageClassRank ?? {};
  const diff = config.difficultyOrder ?? ['easy', 'medium', 'hard'];
  const top = [...reqs].sort((a, b) => (rank[b.stageClass] ?? 0) - (rank[a.stageClass] ?? 0))[0];
  const maxOf = (k) => { const v = reqs.map((r) => r[k]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
  const minOf = (k) => { const v = reqs.map((r) => r[k]).filter((x) => x != null); return v.length ? Math.min(...v) : null; };
  const d = reqs.map((r) => r.difficulty).filter(Boolean).sort((a, b) => diff.indexOf(b) - diff.indexOf(a))[0] ?? null;
  return {
    stageClass: top.stageClass, depth: top.depth, depthDescription: top.depthDescription, difficulty: d,
    questionTarget: maxOf('questionTarget'), accuracyTarget: maxOf('accuracyTarget'), speedTargetSec: minOf('speedTargetSec'),
    speedBasis: reqs.find((r) => r.speedTargetSec === minOf('speedTargetSec'))?.speedBasis ?? null,
    source: reqs.some((r) => r.source === 'manual-override') ? 'manual-override' : 'profile',
    rule: reqs.length > 1 ? 'strictest-of-stages' : 'single-stage',
  };
}

function checkRequirementKey(key, topicId, occs, examById) {
  if (key === '*') return null;
  if (key.startsWith('@')) {
    const [cat, cls] = key.slice(1).split(':');
    if (!occs.some((o) => o.exam.category === cat)) return `'${key}': no exam of category '${cat}' uses ${topicId}`;
    if (cls && !['prelims', 'mains', 'qualifying', 'interview', 'other'].includes(cls)) return `'${key}': unknown stage class '${cls}'`;
    return null;
  }
  const [examId, stageId] = key.split('/');
  if (!examById.has(examId)) return `'${key}': unknown exam '${examId}'`;
  if (!occs.some((o) => o.exam.id === examId && (!stageId || o.stage.id === stageId))) return `'${key}': ${topicId} is not in ${stageId ? `stage '${stageId}' of ` : ''}'${examId}'`;
  return null;
}

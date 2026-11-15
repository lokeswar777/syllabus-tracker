/**
 * Authoring tables for the weightage seed (scripts/seed-weightage.mjs).
 *
 * TOPIC ESTIMATES: expected questions [min, max] per paper for every topic of every section.
 *   - Ranges, not points: they encode fluctuation honestly (min 0 = "may not appear").
 *   - `per` = the question count the ranges refer to (rescaled to the section's real size).
 *   - Base tables are supersets; the seed keeps only topics present in the syllabus section
 *     and FAILS if any syllabus topic has no estimate.
 *   - Optional third element / object form: { q:[min,max], trend:'emerging'|'declining'|'new-pattern', note }.
 *
 * SUBTOPIC PROFILES: relative importance within a topic ({ all } or { ssc, banking } variants).
 *
 * Nothing here is official. Evidence ids refer to data/weightage/evidence.json.
 */
export const AUTHORED_ON = '2026-11-15';

// ─────────────────────────────── SSC base tables ───────────────────────────────
const SSC_REASONING = {
  'reasoning.analogy': [2, 4], 'reasoning.classification': [2, 4], 'reasoning.series': [2, 4],
  'reasoning.coding-decoding': [1, 3], 'reasoning.mathematical-operations': [1, 2], 'reasoning.word-building': [0, 2],
  'reasoning.venn-diagrams': [1, 2], 'reasoning.syllogism': [1, 2], 'reasoning.critical-reasoning': [0, 1],
  'reasoning.emotional-social-intelligence': [0, 1], 'reasoning.arithmetic-reasoning': [1, 2], 'reasoning.clerical-aptitude': [0, 1],
  'reasoning.paper-folding-cutting': [1, 2], 'reasoning.figure-completion': [0, 1], 'reasoning.embedded-figures': [1, 1],
  'reasoning.cubes-dice': [0, 2], 'reasoning.mirror-water-images': [1, 2], 'reasoning.counting-figures': [0, 1],
  'reasoning.blood-relations': [0, 2], 'reasoning.direction-distance': [0, 1], 'reasoning.order-ranking': [0, 1],
  'reasoning.seating-arrangement': [0, 1], 'reasoning.calendar-clock': [0, 1],
};
const SSC_QUANT = {
  'quant.number-system': [1, 2], 'quant.hcf-lcm': [0, 1], 'quant.simplification': [1, 2], 'quant.surds-indices': [0, 1],
  'quant.percentage': [1, 2], 'quant.ratio-proportion': [1, 1.5], 'quant.average': [1, 1.5], 'quant.simple-interest': [0, 1],
  'quant.compound-interest': [0.5, 1], 'quant.profit-loss': [1, 2], 'quant.discount': [0.5, 1], 'quant.partnership': [0, 1],
  'quant.mixture-alligation': [0, 1], 'quant.time-distance': [1, 1.5], 'quant.trains': [0, 1], 'quant.boats-streams': [0, 1],
  'quant.time-work': [1, 1.5], 'quant.pipes-cisterns': [0, 1], 'quant.ages': [0, 0.5], 'quant.algebra-identities': [2, 3],
  'quant.linear-equations': [0, 1], 'quant.coordinate-geometry': [0, 1], 'quant.geometry-lines-angles': [0, 0.5],
  'quant.geometry-triangles': [1, 2], 'quant.geometry-circles': [1, 2], 'quant.geometry-quadrilaterals-polygons': [0, 1],
  'quant.mensuration-2d': [1, 1.5], 'quant.mensuration-3d': [1, 2], 'quant.trigonometry': [2, 3], 'quant.heights-distances': [0, 1],
  'quant.data-interpretation': [2, 4], 'quant.statistics': [1, 1.5], 'quant.probability': [0.5, 1],
};
const SSC_ENGLISH = {
  'english.grammar-rules': [0.5, 1], 'english.reading-comprehension': [4, 5], 'english.cloze-test': [4, 5],
  'english.error-detection': [2, 4], 'english.sentence-improvement': [1, 2], 'english.fill-blanks': [1, 3],
  'english.synonyms-antonyms': [1, 2], 'english.spelling': [1, 2], 'english.idioms-phrases': [1, 2],
  'english.one-word-substitution': [1, 2], 'english.voice': [0, 1], 'english.narration': [0, 1], 'english.para-jumbles': [0, 2],
  'english.sentence-completion': [0, 1],
};
const SSC_GA = {
  'ga.current-affairs': [4, 5], 'ga.history-ancient': [1, 1.5], 'ga.history-medieval': [0.5, 1], 'ga.history-modern': [1, 1.5],
  'ga.art-culture': [0.5, 1.5], 'ga.geography-physical': [0.5, 1.5], 'ga.geography-india': [1, 1.5], 'ga.india-neighbours': [0, 0.5],
  'ga.polity': [3, 4], 'ga.economy-basics': [0.5, 1], 'ga.economy-planning': [0, 0.5], 'ga.economy-fiscal': [0.5, 1],
  'ga.economy-inflation': [0.25, 0.5], 'ga.economy-social': [0, 0.5], 'ga.economy-reforms': [0, 0.5], 'ga.economy-external': [0, 0.5],
  'ga.economy-agriculture': [0, 0.5], 'ga.govt-schemes': [0.5, 1], 'fin.rbi': [0.25, 0.5], 'fin.banking-structure': [0, 0.5],
  'ga.science-physics': [1, 1.5], 'ga.science-chemistry': [1, 1.5], 'ga.science-biology': [1.5, 2], 'ga.science-technology': [0.5, 1],
  'ga.environment': [0.5, 1], 'ga.static-gk': [1, 1.5], 'ga.sports': [0.5, 1.5], 'ga.international-organisations': [0, 0.5],
};
const SSC_CKT = {
  'computer.fundamentals': [1.5, 2], 'computer.memory': [1, 1.5], 'computer.hardware-ports': [0.5, 1], 'computer.software-os': [2.5, 3.5],
  'computer.ms-office': [6, 8], 'computer.internet-email': [2.5, 3.5], 'computer.networking': [1.5, 2.5], 'computer.security': [1, 2],
};

// ─────────────────────────────── Banking base tables ───────────────────────────────
const BANK_ARITH = { // arithmetic word problems inside a prelims quant section (~10–14 Q of 35)
  'quant.percentage': [0.5, 1.5], 'quant.ratio-proportion': [0.5, 1], 'quant.average': [0.5, 1], 'quant.ages': [0.5, 1],
  'quant.partnership': [0.5, 1], 'quant.profit-loss': [1, 1.5], 'quant.discount': [0, 1], 'quant.simple-interest': [0.5, 1],
  'quant.compound-interest': [0.5, 1], 'quant.time-work': [0.5, 1], 'quant.pipes-cisterns': [0, 1], 'quant.time-distance': [0.5, 1],
  'quant.trains': [0.5, 1], 'quant.boats-streams': [0.5, 1], 'quant.mixture-alligation': [0.5, 1], 'quant.mensuration-2d': [0, 1],
  'quant.mensuration-3d': [0, 1], 'quant.probability': [0.5, 1], 'quant.permutation-combination': [0, 1],
};
const BANK_ARITH_MAINS = { // arithmetic inside a DA&I section (~6–10 Q of 30–40)
  'quant.percentage': [0.5, 1.5], 'quant.ratio-proportion': [0.5, 1], 'quant.average': [0.5, 1], 'quant.profit-loss': [0.5, 1.5],
  'quant.simple-interest': [0.25, 0.75], 'quant.compound-interest': [0.25, 0.75], 'quant.time-work': [0.5, 1],
  'quant.time-distance': [0.5, 1], 'quant.boats-streams': [0.25, 0.75], 'quant.mixture-alligation': [0.25, 1],
  'quant.partnership': [0.25, 0.75], 'quant.mensuration-2d': [0.25, 0.75], 'quant.mensuration-3d': [0.25, 0.75],
  'quant.probability': [0.5, 2], 'quant.permutation-combination': [0, 1], 'quant.ages': [0.25, 0.75], 'quant.discount': [0.25, 0.75],
  'quant.trains': [0.25, 1], 'quant.pipes-cisterns': [0.25, 0.75],
};
const BANK_ENGLISH_PRE = {
  'english.reading-comprehension': [8, 10], 'english.cloze-test': [0, 6], 'english.error-detection': [3, 5], 'english.fill-blanks': [0, 5],
  'english.para-jumbles': [3, 6], 'english.sentence-improvement': [0, 5], 'english.word-usage': [2, 6], 'english.sentence-completion': [0, 1],
  'english.grammar-rules': [0.5, 1], 'english.synonyms-antonyms': [0, 1], 'english.spelling': [0, 1], 'english.idioms-phrases': [0, 0.5],
};
const BANK_REASONING_PRE = {
  'reasoning.puzzles': [10, 15], 'reasoning.seating-arrangement': [5, 10], 'reasoning.syllogism': [3, 4], 'reasoning.inequality': [0, 4],
  'reasoning.coding-decoding': [0, 5], 'reasoning.blood-relations': [0, 3], 'reasoning.direction-distance': [0, 3],
  'reasoning.order-ranking': [0, 3], 'reasoning.alphanumeric-series': [0, 5], 'reasoning.word-building': [1, 2],
  'reasoning.classification': [0, 1],
};
const BANK_GA_MAINS = { // per 60 questions: CA ≈33, banking ≈13, economy ≈7, static ≈6 (IBPS PO Mains 2024–25 split rescaled)
  'ga.current-affairs': [16, 22], 'fin.banking-current-affairs': [4, 7], 'ga.govt-schemes': [2, 4], 'ga.sports': [1, 3],
  'ga.science-technology': [1, 2], 'ga.international-organisations': [1, 2], 'fin.budget-economic-survey': [1, 3],
  'fin.banking-structure': [1, 2], 'fin.rbi': [3, 5], 'fin.banking-terms': [2, 4], 'fin.digital-payments': [1, 3],
  'fin.financial-markets': [1, 2], 'fin.financial-inclusion': [1, 2], 'fin.regulators-institutions': [1, 2],
  'fin.insurance-pension': [0.5, 1.5], 'fin.rural-agri-finance': [0, 1],
  'ga.economy-basics': [1, 2], 'ga.economy-planning': [0, 0.5], 'ga.economy-fiscal': [1, 2], 'ga.economy-inflation': [0.5, 1.5],
  'ga.economy-social': [0, 1], 'ga.economy-reforms': [0, 0.5], 'ga.economy-external': [0.5, 1.5], 'ga.economy-agriculture': [0, 1],
  'ga.static-gk': [2, 4], 'ga.geography-india': [1, 2], 'ga.art-culture': [0.5, 1.5],
};
const BANK_COMPUTER_40 = { // RRB Computer Knowledge (no PYQ breakdown found → editorial)
  'computer.fundamentals': [4, 6], 'computer.memory': [3, 5], 'computer.hardware-ports': [1, 3], 'computer.software-os': [4, 6],
  'computer.ms-office': [6, 9], 'computer.internet-email': [3, 5], 'computer.networking': [4, 6], 'computer.security': [3, 5],
  'computer.number-systems-logic': [1, 3], 'computer.programming-dbms': [2, 4], 'computer.emerging-tech': [2, 4],
};
const scale = (table, f) => Object.fromEntries(Object.entries(table).map(([k, [a, b]]) => [k, [a * f, b * f]]));
const COMPUTER_SMALL = scale(BANK_COMPUTER_40, 5 / 40); // ~5 computer Q inside a combined reasoning section
const BANK_ENGLISH_MAINS = {
  'english.reading-comprehension': [11, 18], 'english.cloze-test': [5, 6], 'english.error-detection': [2, 5], 'english.fill-blanks': [0, 4],
  'english.para-jumbles': [2, 5], 'english.sentence-improvement': [0, 3], 'english.word-usage': [2, 5], 'english.sentence-completion': [1, 3],
  'english.grammar-rules': [0.5, 1], 'english.synonyms-antonyms': [0, 1], 'english.spelling': [0, 0.5], 'english.idioms-phrases': [0, 1],
};

// ─────────────────────────────── Section specifications ───────────────────────────────
// key = <examId>/<stageId>/<sectionId>
export const SECTIONS = {
  // ═════════ SSC CGL ═════════
  'ssc-cgl/tier1/reasoning': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-practicemock-cgl'],
    note: 'PracticeMock Tier-1 expected ranges (analogy+classification 3–4, series 3–4, coding 2–3, non-verbal 3–4) split across the syllabus topics.',
    q: { ...SSC_REASONING },
  },
  'ssc-cgl/tier1/ga': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-practicemock-cgl'],
    note: 'PracticeMock Tier-1 GA split (current affairs 4–5, history 3–4, polity 3–4, geography+env 3, economy 3, science 4–5, static 2–3).',
    q: { ...SSC_GA },
  },
  'ssc-cgl/tier1/quant': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-practicemock-cgl'],
    note: 'Advanced maths (algebra, geometry, trigonometry, mensuration) ≈ 40–45% of Tier-1 quant; DI 2–4 (PracticeMock expects 4–5).',
    q: { ...SSC_QUANT, 'quant.data-interpretation': [2, 4] },
  },
  'ssc-cgl/tier1/english': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-practicemock-cgl'],
    note: 'PracticeMock Tier-1 English: RC 5, cloze 5, error 4–5, improvement 2–3, fillers 2–3, syn/ant 2, idioms 2, OWS 1–2.',
    q: { ...SSC_ENGLISH },
  },
  'ssc-cgl/tier2-paper1/maths': {
    per: 30, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-practicemock-cgl'],
    note: 'PracticeMock Tier-2 trend: geometry 5, trig+HD 4, DI 4, algebra 3, mensuration 3, arithmetic groups 2–3 each, statistics+probability 2.',
    q: {
      'quant.geometry-lines-angles': [0.5, 1], 'quant.geometry-triangles': [1.5, 2], 'quant.geometry-circles': [1.5, 2],
      'quant.geometry-quadrilaterals-polygons': [0.5, 1], 'quant.mensuration-2d': [1, 1.5], 'quant.mensuration-3d': [1.5, 2],
      'quant.trigonometry': [2.5, 3], 'quant.heights-distances': [1, 1], 'quant.algebra-identities': [2, 3], 'quant.linear-equations': [0, 0.5],
      'quant.coordinate-geometry': [0.5, 1], 'quant.data-interpretation': [3, 4], 'quant.percentage': [0.5, 1], 'quant.ratio-proportion': [0.5, 1],
      'quant.average': [0.5, 1], 'quant.mixture-alligation': [0.25, 0.75], 'quant.time-distance': [0.5, 1], 'quant.trains': [0, 0.5],
      'quant.boats-streams': [0, 0.5], 'quant.time-work': [0.5, 1], 'quant.pipes-cisterns': [0, 0.5], 'quant.profit-loss': [0.5, 1],
      'quant.discount': [0.25, 0.5], 'quant.simple-interest': [0.25, 0.5], 'quant.compound-interest': [0.25, 0.5], 'quant.partnership': [0, 0.5],
      'quant.number-system': [0.5, 1], 'quant.hcf-lcm': [0, 0.5], 'quant.simplification': [0.5, 1], 'quant.surds-indices': [0.25, 0.5],
      'quant.statistics': [1, 1.5], 'quant.probability': [0.5, 1],
    },
  },
  'ssc-cgl/tier2-paper1/reasoning': {
    per: 30, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-practicemock-cgl'],
    note: 'PracticeMock Tier-2 trend: analogy+classification 5, non-verbal 5, series 4, coding 4, Venn/inference 3, seating/puzzle 3, operations 2.',
    q: {
      'reasoning.analogy': [2, 3], 'reasoning.classification': [2, 3], 'reasoning.series': [3, 5], 'reasoning.coding-decoding': [3, 5],
      'reasoning.mirror-water-images': [1, 1.5], 'reasoning.paper-folding-cutting': [1, 1.5], 'reasoning.figure-completion': [0.5, 1],
      'reasoning.embedded-figures': [0.5, 1], 'reasoning.counting-figures': [0.5, 1], 'reasoning.cubes-dice': [1, 1.5],
      'reasoning.venn-diagrams': [1, 1.5], 'reasoning.critical-reasoning': [0.5, 1], 'reasoning.syllogism': [0.5, 1],
      'reasoning.blood-relations': [0.5, 1], 'reasoning.direction-distance': [0.5, 1], 'reasoning.order-ranking': [0, 0.5],
      'reasoning.seating-arrangement': [1, 2], 'reasoning.arithmetic-reasoning': [1, 1.5], 'reasoning.mathematical-operations': [1.5, 2.5],
      'reasoning.emotional-social-intelligence': [0, 1], 'reasoning.word-building': [0.5, 1], 'reasoning.calendar-clock': [0, 0.5],
    },
  },
  'ssc-cgl/tier2-paper1/english': {
    per: 45, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-practicemock-cgl'],
    note: 'PracticeMock Tier-2 trend: RC 10 (three passages per syllabus), cloze 5, error 5, improvement 4, para jumbles 4, syn/ant 4, idioms 3, voice 3, narration 3, OWS 2.',
    q: {
      'english.reading-comprehension': [9, 10], 'english.cloze-test': [5, 5], 'english.error-detection': [4, 5], 'english.sentence-improvement': [3, 4],
      'english.para-jumbles': [3, 4], 'english.synonyms-antonyms': [3, 4], 'english.idioms-phrases': [2, 3], 'english.one-word-substitution': [2, 3],
      'english.voice': [2, 3], 'english.narration': [2, 3], 'english.fill-blanks': [1, 2], 'english.spelling': [1, 2], 'english.grammar-rules': [1, 2],
    },
  },
  'ssc-cgl/tier2-paper1/ga': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-practicemock-cgl'],
    note: 'PracticeMock Tier-2 trend: science 6, history 4, current affairs 4, polity 4, geography 3, economy 2, static+culture 2.',
    q: {
      ...SSC_GA, 'ga.science-physics': [1.5, 2], 'ga.science-chemistry': [1.5, 2], 'ga.science-biology': [2, 2.5],
      'ga.history-ancient': [1, 1.5], 'ga.history-medieval': [1, 1.5], 'ga.history-modern': [1.5, 2], 'ga.current-affairs': [3.5, 4.5],
      'ga.polity': [3.5, 4.5], 'ga.geography-physical': [1, 1.5], 'ga.geography-india': [1.5, 2], 'ga.economy-fiscal': [0.25, 0.5],
      'ga.static-gk': [0.5, 1], 'ga.art-culture': [0.5, 1], 'ga.sports': [0.25, 0.75],
    },
  },
  'ssc-cgl/tier2-paper1/computer': {
    per: 20, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-practicemock-cgl'],
    note: 'PracticeMock trend: MS Office 7, OS 3, internet/email 3, fundamentals+hardware 3, networking 2, security 1 (+database 1, outside syllabus).',
    q: { ...SSC_CKT },
  },
  'ssc-cgl/tier2-paper2/statistics': {
    per: 100, basis: 'editorial-estimate', confidence: 'very-low', evidence: ['ev-practicemock-cgl'],
    note: 'No full topic counts read. Split reflects syllabus breadth; PracticeMock lists probability ≈10, correlation & regression ≈10, sampling ≈8.',
    q: {
      'stats.data-presentation': [6, 9], 'stats.central-tendency': [8, 10], 'stats.dispersion': [7, 9], 'stats.moments': [5, 7],
      'stats.correlation-regression': [9, 11], 'stats.probability-theory': [9, 11], 'stats.random-variables': [10, 13], 'stats.sampling': [7, 9],
      'stats.inference': [10, 13], 'stats.anova': [3, 5], 'stats.time-series': [5, 7], 'stats.index-numbers': [6, 8],
    },
  },
  'ssc-cgl/tier2-paper3/finance-accounts': {
    per: 40, basis: 'editorial-estimate', confidence: 'very-low', evidence: [],
    note: 'Paper-III reintroduced in 2026 with an 80/120 marks split; no reliable topic counts. Weighted by syllabus breadth (accounting process & final accounts largest).',
    q: {
      'accounts.fundamentals': [5, 7], 'accounts.process': [12, 15], 'accounts.final-accounts': [8, 10], 'accounts.depreciation-inventory': [4, 6],
      'accounts.npo': [3, 5], 'accounts.bills-of-exchange': [2, 3],
    },
  },
  'ssc-cgl/tier2-paper3/economics-governance': {
    per: 60, basis: 'editorial-estimate', confidence: 'very-low', evidence: [],
    note: 'No reliable topic counts. Micro-economics and Indian-economy blocks weighted by syllabus breadth.',
    q: {
      'econ.cag': [3, 5], 'econ.finance-commission': [2, 4], 'econ.micro-basics': [3, 5], 'econ.demand-supply': [7, 9], 'econ.production-cost': [4, 6],
      'econ.market-forms': [5, 7], 'ga.economy-basics': [5, 7], 'ga.economy-social': [4, 6], 'ga.economy-infrastructure': [3, 5],
      'ga.economy-reforms': [3, 5], 'fin.rbi': [4, 6], 'fin.banking-structure': [3, 5], 'ga.economy-fiscal': [5, 7], 'ga.economy-external': [2, 4],
      'ga.e-governance': [3, 5],
    },
  },

  // ═════════ SSC CHSL ═════════
  'ssc-chsl/tier1/english': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-sathee-chsl'],
    note: 'SATHEE grouped ranges: error+improvement+voice/narration 5–8, cloze+RC 5–10, syn/ant+idiom+OWS 5–8, fillers+spelling 3–5.',
    q: {
      ...SSC_ENGLISH, 'english.error-detection': [2, 3], 'english.sentence-improvement': [1, 2], 'english.voice': [1, 1.5], 'english.narration': [0.5, 1],
      'english.reading-comprehension': [2, 5], 'english.cloze-test': [3, 5], 'english.synonyms-antonyms': [2, 3], 'english.idioms-phrases': [1, 2],
      'english.one-word-substitution': [1, 2], 'english.fill-blanks': [1.5, 2.5], 'english.spelling': [1, 2], 'english.para-jumbles': [0.5, 1.5],
    },
  },
  'ssc-chsl/tier1/reasoning': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-sathee-chsl'],
    note: 'SATHEE: analogy+classification+series 6–10, coding+Venn+syllogism 3–5, non-verbal 4–6, misc 3–5.',
    q: {
      ...SSC_REASONING, 'reasoning.analogy': [2, 4], 'reasoning.classification': [2, 4], 'reasoning.series': [3, 4], 'reasoning.coding-decoding': [1, 2],
      'reasoning.venn-diagrams': [1, 1], 'reasoning.syllogism': [0, 1], 'reasoning.blood-relations': [0, 1], 'reasoning.word-building': [0.5, 1.5],
    },
  },
  'ssc-chsl/tier1/quant': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-sathee-chsl'],
    note: 'SATHEE: arithmetic 10–14, algebra+geometry+mensuration 5–8, trig+DI+number system 4–6, so CHSL is more arithmetic-heavy than CGL.',
    q: {
      ...SSC_QUANT, 'quant.number-system': [1, 2], 'quant.simplification': [1.5, 3], 'quant.percentage': [1, 2], 'quant.ratio-proportion': [1, 1.5],
      'quant.average': [1, 1.5], 'quant.profit-loss': [1, 2], 'quant.discount': [0.5, 1.5], 'quant.simple-interest': [0.5, 1],
      'quant.compound-interest': [0.5, 1], 'quant.algebra-identities': [1.5, 2.5], 'quant.geometry-triangles': [1, 1.5],
      'quant.geometry-circles': [0.5, 1.5], 'quant.trigonometry': [1.5, 2.5], 'quant.data-interpretation': [1, 2],
    },
  },
  'ssc-chsl/tier1/ga': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-sathee-chsl'],
    note: 'SATHEE: history+geography+polity 6–10, economy+science 5–8, current affairs+static 6–10. CHSL leans more on static GK than CGL.',
    q: {
      ...SSC_GA, 'ga.current-affairs': [2.5, 4], 'ga.static-gk': [1.5, 2.5], 'ga.sports': [1, 2], 'ga.art-culture': [1, 2], 'ga.polity': [2, 3],
      'ga.science-biology': [1.5, 2], 'ga.economy-basics': [0.5, 1],
    },
  },
  'ssc-chsl/tier2/maths': {
    per: 30, basis: 'proxy-estimate', confidence: 'very-low', evidence: ['ev-practicemock-cgl', 'ev-sathee-chsl'],
    note: 'Same syllabus as CGL Tier-2 Maths; CGL Tier-2 trend tilted toward arithmetic per CHSL Tier-1 data. No CHSL Tier-2 topic counts found.',
    q: {
      ...SSC_QUANT, 'quant.percentage': [1, 1.5], 'quant.ratio-proportion': [1, 1.5], 'quant.average': [1, 1.5], 'quant.profit-loss': [1, 1.5],
      'quant.time-work': [0.75, 1.25], 'quant.time-distance': [0.75, 1.25], 'quant.geometry-triangles': [1, 1.5], 'quant.geometry-circles': [1, 1.5],
      'quant.mensuration-2d': [1, 1.5], 'quant.mensuration-3d': [1, 1.5], 'quant.trigonometry': [2, 2.5], 'quant.heights-distances': [0.5, 1],
      'quant.data-interpretation': [2, 3], 'quant.statistics': [1, 1.5], 'quant.probability': [0.5, 1], 'quant.simplification': [1, 1.5],
      'quant.number-system': [1, 1.5],
    },
  },
  'ssc-chsl/tier2/reasoning': {
    per: 30, basis: 'proxy-estimate', confidence: 'very-low', evidence: ['ev-practicemock-cgl', 'ev-sathee-chsl'],
    note: 'Same topic list as CGL Tier-2 reasoning; CGL Tier-2 trend with more analogy/classification/series (CHSL Tier-1 SATHEE grouping).',
    q: {
      'reasoning.analogy': [2.5, 3.5], 'reasoning.classification': [2.5, 3.5], 'reasoning.series': [3, 4], 'reasoning.coding-decoding': [2, 3],
      'reasoning.mirror-water-images': [1, 1.5], 'reasoning.paper-folding-cutting': [1, 1.5], 'reasoning.figure-completion': [0.5, 1],
      'reasoning.embedded-figures': [0.5, 1], 'reasoning.counting-figures': [0.5, 1], 'reasoning.cubes-dice': [0.5, 1.5],
      'reasoning.venn-diagrams': [1, 1.5], 'reasoning.critical-reasoning': [0.5, 1], 'reasoning.syllogism': [0.5, 1],
      'reasoning.blood-relations': [0.5, 1], 'reasoning.direction-distance': [0.5, 1], 'reasoning.order-ranking': [0, 0.5],
      'reasoning.seating-arrangement': [0.5, 1], 'reasoning.arithmetic-reasoning': [1, 1.5], 'reasoning.mathematical-operations': [1.5, 2],
      'reasoning.emotional-social-intelligence': [0, 1], 'reasoning.word-building': [0.5, 1], 'reasoning.calendar-clock': [0, 0.5],
    },
  },
  'ssc-chsl/tier2/english': {
    per: 40, basis: 'proxy-estimate', confidence: 'very-low', evidence: ['ev-practicemock-cgl'],
    note: 'CGL Tier-2 English trend rescaled to 40 Q; CHSL comprehension uses two passages (vs three in CGL).',
    q: {
      'english.reading-comprehension': [8, 10], 'english.cloze-test': [5, 6], 'english.error-detection': [3, 5], 'english.sentence-improvement': [3, 4],
      'english.para-jumbles': [3, 4], 'english.synonyms-antonyms': [3, 4], 'english.idioms-phrases': [2, 3], 'english.one-word-substitution': [2, 3],
      'english.voice': [2, 3], 'english.narration': [2, 3], 'english.fill-blanks': [1, 2], 'english.spelling': [1, 2], 'english.grammar-rules': [1, 2],
    },
  },
  'ssc-chsl/tier2/ga': {
    per: 20, basis: 'proxy-estimate', confidence: 'very-low', evidence: ['ev-sathee-chsl'],
    note: 'CHSL Tier-1 GA distribution (SATHEE grouping) rescaled to 20 Q.',
    q: {
      ...SSC_GA, 'ga.current-affairs': [2.5, 4], 'ga.static-gk': [1.5, 2.5], 'ga.sports': [1, 2], 'ga.art-culture': [1, 2], 'ga.polity': [2, 3],
      'ga.science-biology': [1.5, 2],
    },
  },
  'ssc-chsl/tier2/computer': {
    per: 15, basis: 'proxy-estimate', confidence: 'very-low', evidence: ['ev-practicemock-cgl'],
    note: 'Identical syllabus to CGL CKT; CGL trend rescaled with slightly more basics for the 12th-level exam.',
    q: {
      'computer.fundamentals': [1.5, 2.5], 'computer.memory': [1, 2], 'computer.hardware-ports': [0.5, 1], 'computer.software-os': [2, 3],
      'computer.ms-office': [4, 5], 'computer.internet-email': [2, 3], 'computer.networking': [1, 2], 'computer.security': [1, 2],
    },
  },

  // ═════════ SSC CPO ═════════
  'ssc-cpo/paper1/reasoning': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-pw-cpo'],
    note: 'PW ranges for the old 50-Q section halved (analogy 6–8, classification 6–7, Venn 4–5, word test 3–5, non-verbal 5–7…). 2026 100-Q pattern untested.',
    q: {
      ...SSC_REASONING, 'reasoning.analogy': [3, 4], 'reasoning.classification': [3, 3.5], 'reasoning.series': [1.5, 2.5], 'reasoning.coding-decoding': [1.5, 2.5],
      'reasoning.word-building': [1.5, 2.5], 'reasoning.venn-diagrams': [2, 2.5], 'reasoning.arithmetic-reasoning': [1, 1.5],
      'reasoning.order-ranking': [0.5, 1], 'reasoning.direction-distance': [0.5, 1.5], 'reasoning.seating-arrangement': [0.5, 1.5],
      'reasoning.mirror-water-images': [1, 1.5], 'reasoning.paper-folding-cutting': [0.5, 1], 'reasoning.embedded-figures': [0.5, 1],
      'reasoning.figure-completion': [0.5, 1], 'reasoning.counting-figures': [0.5, 1], 'reasoning.cubes-dice': [0.5, 1],
      'reasoning.critical-reasoning': [0.5, 1],
    },
  },
  'ssc-cpo/paper1/ga': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-pw-cpo'],
    note: 'PW old-pattern ranges halved: national & international affairs + current events ≈6–7, science & tech 5–6.5, history 3–3.5, geography 2.5–3, economy 2–2.5, polity 1.5–2.5 (explicitly in 2026 syllabus).',
    q: {
      ...SSC_GA, 'ga.history-ancient': [1, 1.25], 'ga.history-medieval': [0.75, 1], 'ga.history-modern': [1.25, 1.5],
      'ga.geography-physical': [1, 1.25], 'ga.geography-india': [1.25, 1.5], 'ga.india-neighbours': [0.25, 0.5], 'ga.polity': [1.5, 2.5],
      'ga.science-physics': [1.25, 1.75], 'ga.science-chemistry': [1.25, 1.5], 'ga.science-biology': [1.5, 2], 'ga.science-technology': [1, 1.25],
      'ga.static-gk': [0.5, 1], 'ga.current-affairs': [5, 6.5], 'ga.international-organisations': [0.5, 1], 'ga.sports': [0.5, 1],
    },
  },
  'ssc-cpo/paper1/quant': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-pw-cpo'],
    note: 'PW old-pattern ranges halved: simplification 2–2.5, algebra 2–3, P&L 2–2.5, geometry 2–3, DI 2–2.5, trig 1.5–2.5, mensuration 1.5–2.5, ratio 1.5–2.',
    q: {
      ...SSC_QUANT, 'quant.simplification': [2, 2.5], 'quant.profit-loss': [2, 2.5], 'quant.ratio-proportion': [1.5, 2], 'quant.algebra-identities': [2, 3],
      'quant.mensuration-2d': [0.75, 1.25], 'quant.mensuration-3d': [0.75, 1.25], 'quant.trigonometry': [1.5, 2.5], 'quant.geometry-triangles': [1, 1.5],
      'quant.geometry-circles': [0.75, 1.25], 'quant.geometry-quadrilaterals-polygons': [0.25, 0.5], 'quant.data-interpretation': [2, 2.5],
      'quant.number-system': [0.5, 1.5], 'quant.percentage': [0.5, 1], 'quant.average': [1, 1.5], 'quant.mixture-alligation': [0.5, 1],
      'quant.time-work': [0.5, 1], 'quant.time-distance': [0.5, 1.5], 'quant.simple-interest': [0.5, 1.5], 'quant.compound-interest': [0.25, 0.75],
    },
  },
  'ssc-cpo/paper1/english': {
    per: 25, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-pw-cpo'],
    note: 'PW old-pattern ranges halved: grammar 4–5, vocabulary 2.5–5, cloze 2.5–5, RC 2.5–5, error 2–2.5, idioms 1.5–2.5. Topics outside the CPO syllabus text kept small.',
    q: {
      'english.error-detection': [2, 2.5], 'english.fill-blanks': [1.5, 2.5], 'english.grammar-rules': [1, 2], 'english.synonyms-antonyms': [1.5, 3],
      'english.spelling': [0.5, 1.5], 'english.sentence-completion': [0.5, 1], 'english.idioms-phrases': [1.5, 2.5], 'english.reading-comprehension': [2.5, 5],
      'english.cloze-test': [2.5, 5], 'english.one-word-substitution': [0.5, 1], 'english.sentence-improvement': [0.5, 1.5], 'english.voice': [0, 1],
      'english.narration': [0, 1], 'english.para-jumbles': [0, 1],
    },
  },
  'ssc-cpo/pst-pet/pst': { nominal: true, note: 'Single qualifying test.' },
  'ssc-cpo/pst-pet/pet': {
    per: 2, basis: 'nominal', confidence: 'high', evidence: [],
    note: 'Male and female PET are alternatives by gender; split 50/50 for structure. Set the applicable one to 100 via `custom`.',
    q: { 'physical.pet-male': [1, 1], 'physical.pet-female': [1, 1] },
  },
  'ssc-cpo/paper2/reasoning': {
    per: 20, basis: 'proxy-estimate', confidence: 'very-low', evidence: ['ev-pw-cpo'],
    note: 'NEW 2026 section, no history. Assumed Paper-I distribution, shifted toward analytical/statement questions because Paper-II is officially harder.',
    q: {
      ...SSC_REASONING, 'reasoning.analogy': [2.5, 3.5], 'reasoning.classification': [2.5, 3], 'reasoning.series': [1.5, 2.5], 'reasoning.coding-decoding': [1.5, 2.5],
      'reasoning.word-building': [1, 2], 'reasoning.venn-diagrams': [1.5, 2.5], 'reasoning.syllogism': [1, 2], 'reasoning.critical-reasoning': [0.5, 1.5],
      'reasoning.seating-arrangement': [0.5, 1.5], 'reasoning.arithmetic-reasoning': [1, 1.5],
    },
  },
  'ssc-cpo/paper2/ga': {
    per: 20, basis: 'proxy-estimate', confidence: 'very-low', evidence: ['ev-pw-cpo'],
    note: 'NEW 2026 section, no history. Paper-I GA distribution assumed.',
    q: {
      ...SSC_GA, 'ga.polity': [1.5, 2.5], 'ga.current-affairs': [4, 5.5], 'ga.science-technology': [1, 1.5], 'ga.science-biology': [1.5, 2],
      'ga.history-modern': [1.25, 1.5], 'ga.international-organisations': [0.5, 1],
    },
  },
  'ssc-cpo/paper2/quant': {
    per: 20, basis: 'proxy-estimate', confidence: 'very-low', evidence: ['ev-pw-cpo'],
    note: 'NEW 2026 section, no history. Paper-I quant distribution assumed with slightly more advanced maths (higher difficulty).',
    q: {
      ...SSC_QUANT, 'quant.simplification': [1, 1.5], 'quant.profit-loss': [1.5, 2], 'quant.algebra-identities': [2, 3], 'quant.trigonometry': [1.5, 2.5],
      'quant.geometry-triangles': [1, 1.5], 'quant.geometry-circles': [1, 1.5], 'quant.data-interpretation': [1.5, 2.5], 'quant.mensuration-3d': [1, 1.5],
    },
  },
  'ssc-cpo/paper2/english': {
    per: 100, basis: 'proxy-estimate', confidence: 'very-low', evidence: [],
    note: 'Proxy: pre-2026 CPO Paper-II (200 Q, English only) typical mix, halved. Editorial reconstruction; no topic counts read for verification.',
    q: {
      'english.error-detection': [8, 12], 'english.fill-blanks': [8, 12], 'english.synonyms-antonyms': [8, 10], 'english.spelling': [3, 5],
      'english.idioms-phrases': [4, 6], 'english.sentence-completion': [2, 4], 'english.grammar-rules': [2, 4], 'english.reading-comprehension': [8, 12],
      'english.one-word-substitution': [4, 6], 'english.sentence-improvement': [8, 12], 'english.voice': [5, 8], 'english.narration': [5, 8],
      'english.para-jumbles': [4, 6], 'english.cloze-test': [8, 12],
    },
  },

  // ═════════ SBI PO ═════════
  'sbi-po/prelims/english': {
    per: 40, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-sbi-po'],
    note: '40-Q pattern (Aug-2025, Aug-2026): RC 8–15, cloze 5–7, para jumble + sentence rearrangement 8–11, word swap/column 4–8, phrase replacement 3–5, fillers 2–5, error 3–5.',
    q: {
      'english.reading-comprehension': [10, 15], 'english.cloze-test': [5, 7], 'english.para-jumbles': [8, 11], 'english.word-usage': [4, 8],
      'english.fill-blanks': [2, 5], 'english.error-detection': [3, 5], 'english.sentence-improvement': [3, 5], 'english.idioms-phrases': [0, 2],
      'english.sentence-completion': [0, 1], 'english.grammar-rules': [0.5, 1], 'english.synonyms-antonyms': [0, 1], 'english.spelling': [0, 0.5],
    },
  },
  'sbi-po/prelims/quant': {
    per: 30, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-sbi-po'],
    note: 'Aug-2025/2026: DI 13–16, arithmetic 11–14, number series 2–3, quadratic/approximation 2–5 (data sufficiency 0–3 also observed but not mapped).',
    q: {
      ...BANK_ARITH, 'quant.data-interpretation': [13, 16], 'quant.number-series': [2, 3], 'quant.quadratic-equations': [1, 3],
      'quant.simplification': [0, 2], 'quant.quantity-comparison': [0, 2],
    },
  },
  'sbi-po/prelims/reasoning': {
    per: 30, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-sbi-po'],
    note: 'Puzzles + seating 20–25 of 30 (4–5 sets; puzzles outnumber seating ≈ 3:2), syllogism/inequality 3–5, blood relation 2–3, pair/word 1–2.',
    q: {
      'reasoning.puzzles': [12, 16], 'reasoning.seating-arrangement': [5, 10], 'reasoning.syllogism': [0, 3], 'reasoning.inequality': [0, 3],
      'reasoning.coding-decoding': [0, 2], 'reasoning.blood-relations': [0, 3], 'reasoning.direction-distance': [0, 2], 'reasoning.order-ranking': [0, 3],
      'reasoning.alphanumeric-series': [0, 1], 'reasoning.word-building': [1, 2],
    },
  },
  'sbi-po/mains/reasoning-computer': {
    per: 40, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-mahendras-sbi-po'],
    note: 'Dec-2023/May-2025: puzzle & seating sets 19–25, critical reasoning 6–8, input-output 4–5, coded direction 0–4, DS 0–2. Computer aptitude is not reported separately, so it is kept at 0–5 Q in total.',
    q: {
      'reasoning.puzzles': [10, 16], 'reasoning.seating-arrangement': [5, 10], 'reasoning.critical-reasoning': [5, 8], 'reasoning.data-sufficiency': [2, 3],
      'reasoning.input-output': [0, 5], 'reasoning.syllogism': [0, 2], 'reasoning.inequality': [0, 2], 'reasoning.coding-decoding': [0, 2],
      'reasoning.blood-relations': [0, 2], 'reasoning.direction-distance': [1, 4], 'reasoning.order-ranking': [0, 1], 'reasoning.alphanumeric-series': [0, 1],
      ...scale(BANK_COMPUTER_40, 3 / 40), // ≈3 computer Q in total: not reported separately in any analysed paper
    },
  },
  'sbi-po/mains/data-analysis': {
    per: 30, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-mahendras-sbi-po'],
    note: 'Dec-2023: DI-heavy (≈18–20); May-2025: arithmetic 10–11, DI 10, series 2, quadratic 2, QC 1. Wide year-to-year swing.',
    q: {
      ...BANK_ARITH_MAINS, 'quant.data-interpretation': { q: [10, 18], trend: 'fluctuating' }, 'quant.data-sufficiency': [0, 3], 'quant.quantity-comparison': [1, 3],
      'quant.quadratic-equations': [0, 2], 'quant.number-series': [0, 3],
    },
  },
  'sbi-po/mains/general-awareness': {
    per: 60, basis: 'proxy-estimate', confidence: 'low', evidence: ['ev-mahendras-ibps-po'],
    note: 'SBI GA split not reported; IBPS PO Mains 2024–25 split (CA ≈55%, banking ≈21%, economy ≈12%, static ≈10%) rescaled to 60 Q.',
    q: { ...BANK_GA_MAINS },
  },
  'sbi-po/mains/english': {
    per: 40, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-mahendras-sbi-po'],
    note: 'May-2025: RC 16, column-based (incl. triple) 9, cloze 5, word/sentence rearrangement 6, context sentences 3, idiom 1.',
    q: {
      'english.reading-comprehension': [14, 18], 'english.cloze-test': [4, 6], 'english.error-detection': [0, 4], 'english.fill-blanks': [0, 4],
      'english.para-jumbles': [3, 6], 'english.sentence-improvement': [0, 3], 'english.word-usage': [5, 10], 'english.sentence-completion': [1, 3],
      'english.grammar-rules': [0.5, 1], 'english.synonyms-antonyms': [0, 1],
    },
  },
  'sbi-po/mains/descriptive': {
    per: 3, basis: 'editorial-estimate', confidence: 'low', evidence: [],
    note: 'Official: 3 questions / 30 marks. Equal marks per task assumed (not stated). Report and précis are alternatives sharing one slot.',
    q: { 'descriptive.email-writing': [1, 1], 'descriptive.situation-analysis': [1, 1], 'descriptive.report-writing': [0.5, 0.5], 'descriptive.precis-writing': [0.5, 0.5] },
  },
  'sbi-po/phase3/psychometric': { nominal: true, note: 'Unscored; findings go to the interview panel.' },
  'sbi-po/phase3/group-exercise': { nominal: true, note: 'Single topic.' },
  'sbi-po/phase3/interview': { nominal: true, note: 'Single topic.' },

  // ═════════ SBI Clerk ═════════
  'sbi-clerk/prelims/english': {
    per: 30, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-bankersadda-sbi-clerk-2026', 'ev-mahendras-ibps-clerk'],
    note: '27-Sep-2026 S1: RC 10, cloze 6, error 5, word swap 4, rearrangement 4, word usage 1; consistent with IBPS Clerk prelims 2024.',
    q: {
      'english.reading-comprehension': [9, 10], 'english.cloze-test': [5, 6], 'english.error-detection': [4, 5], 'english.para-jumbles': [3, 5],
      'english.word-usage': [4, 6], 'english.fill-blanks': [0, 2], 'english.sentence-improvement': [0, 2], 'english.sentence-completion': [0, 1],
      'english.grammar-rules': [0.5, 1], 'english.synonyms-antonyms': [0, 2], 'english.spelling': [0, 1], 'english.idioms-phrases': [0, 0.5],
    },
  },
  'sbi-clerk/prelims/quant': {
    per: 35, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-bankersadda-sbi-clerk-2026', 'ev-pw-sbi-clerk-2026'],
    note: '2026: simplification 9–10, table+bar DI 10, caselet 3–5, arithmetic 10–12; quadratic/series occasional.',
    q: {
      ...BANK_ARITH, 'quant.simplification': [9, 12], 'quant.data-interpretation': [10, 15], 'quant.number-series': [0, 3], 'quant.quadratic-equations': [0, 3],
      'quant.quantity-comparison': [0, 1], 'quant.mensuration-3d': [0, 0.5], 'quant.probability': [0, 0.5], 'quant.permutation-combination': [0, 0.5],
    },
  },
  'sbi-clerk/prelims/reasoning': {
    per: 35, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-bankersadda-sbi-clerk-2026', 'ev-pw-sbi-clerk-2026'],
    note: '2026: puzzles + seating 18–19, alphanumeric 5, Chinese coding 4, syllogism 3, blood relation 3, odd one 1.',
    q: {
      'reasoning.puzzles': [10, 13], 'reasoning.seating-arrangement': [5, 8], 'reasoning.syllogism': [3, 3], 'reasoning.inequality': [0, 3],
      'reasoning.coding-decoding': [3, 5], 'reasoning.blood-relations': [0, 3], 'reasoning.direction-distance': [0, 3], 'reasoning.order-ranking': [0, 2],
      'reasoning.alphanumeric-series': [3, 5], 'reasoning.word-building': [1, 2], 'reasoning.classification': [0, 1],
    },
  },
  'sbi-clerk/mains/general-financial-awareness': {
    per: 50, basis: 'proxy-estimate', confidence: 'low', evidence: ['ev-mahendras-ibps-clerk'],
    note: 'Proxy: IBPS Clerk Mains 2024–25 (same 50-Q GA): current affairs 30, banking 10, static 5, economy 5.',
    q: {
      'ga.current-affairs': [15, 20], 'fin.banking-current-affairs': [3, 5], 'ga.govt-schemes': [2, 4], 'ga.sports': [1, 2], 'ga.science-technology': [1, 2],
      'ga.international-organisations': [1, 2], 'fin.budget-economic-survey': [1, 2], 'fin.banking-structure': [1, 2], 'fin.rbi': [2, 3],
      'fin.banking-terms': [2, 3], 'fin.digital-payments': [1, 2], 'fin.financial-markets': [0.5, 1], 'fin.financial-inclusion': [1, 2],
      'fin.regulators-institutions': [0.5, 1.5], 'fin.insurance-pension': [0.5, 1], 'fin.rural-agri-finance': [0, 1], 'ga.economy-basics': [1, 2],
      'ga.economy-fiscal': [1, 2], 'ga.economy-inflation': [0.5, 1], 'ga.static-gk': [2, 3], 'ga.geography-india': [1, 2], 'ga.art-culture': [0.5, 1],
    },
  },
  'sbi-clerk/mains/english': {
    per: 40, basis: 'proxy-estimate', confidence: 'low', evidence: ['ev-mahendras-ibps-clerk'],
    note: 'Proxy: IBPS Clerk Mains 2024–25 (40 Q): RC 15, cloze 5, error 5, sentence correction 5, vocabulary 5, para jumble 5.',
    q: {
      'english.reading-comprehension': [13, 15], 'english.cloze-test': [5, 5], 'english.error-detection': [4, 5], 'english.sentence-improvement': [3, 5],
      'english.fill-blanks': [1, 3], 'english.para-jumbles': [4, 5], 'english.word-usage': [2, 4], 'english.sentence-completion': [0, 2],
      'english.grammar-rules': [0.5, 1], 'english.synonyms-antonyms': [1, 3], 'english.spelling': [0, 1],
    },
  },
  'sbi-clerk/mains/quant': {
    per: 50, basis: 'proxy-estimate', confidence: 'low', evidence: ['ev-mahendras-ibps-clerk'],
    note: 'Proxy: IBPS Clerk Mains 2024–25 (50 Q): DI 20, arithmetic 15, approximation 5, series 5, DS 5.',
    q: {
      ...scale(BANK_ARITH, 15 / 12), 'quant.data-interpretation': [18, 20], 'quant.simplification': [4, 5], 'quant.number-series': [4, 5],
      'quant.quadratic-equations': [0, 3], 'quant.quantity-comparison': [0, 3], 'quant.data-sufficiency': [0, 5],
    },
  },
  'sbi-clerk/mains/reasoning-computer': {
    per: 50, basis: 'proxy-estimate', confidence: 'low', evidence: ['ev-mahendras-ibps-clerk'],
    note: 'Proxy: IBPS Clerk Mains 2024–25 (50 Q R&CA): puzzles 20, seating 10, coding 5, input-output 5, logical 5, computer 5.',
    q: {
      'reasoning.puzzles': [18, 20], 'reasoning.seating-arrangement': [8, 10], 'reasoning.coding-decoding': [4, 5], 'reasoning.input-output': [3, 5],
      'reasoning.syllogism': [1, 3], 'reasoning.inequality': [1, 3], 'reasoning.blood-relations': [0, 2], 'reasoning.direction-distance': [0, 2],
      'reasoning.order-ranking': [0, 1], 'reasoning.alphanumeric-series': [0, 2], 'reasoning.data-sufficiency': [0, 2], 'reasoning.critical-reasoning': [0, 2],
      ...COMPUTER_SMALL,
    },
  },
  'sbi-clerk/llpt/llpt': { nominal: true, note: 'Single topic; subtopics follow official marks (15/15/20).' },

  // ═════════ IBPS PO ═════════
  'ibps-po/prelims/english': {
    per: 30, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-ibps-po', 'ev-bankersadda-ibps-po-2026'],
    note: 'Oct-2024→Aug-2026 (≈19 shifts): RC 8–10, error 3–5, para jumble 3–6, cloze 0–6, fillers 0–5, phrase replacement 0–5, word swap/usage 0–6.',
    q: { ...BANK_ENGLISH_PRE },
  },
  'ibps-po/prelims/quant': {
    per: 35, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-ibps-po', 'ev-bankersadda-ibps-po-2026'],
    note: 'DI 10–16, arithmetic 10–15, approximation 3–5, quadratic 0–5, number series 0–5, quantity comparison 0–5.',
    q: {
      ...BANK_ARITH, 'quant.data-interpretation': [10, 16], 'quant.simplification': [3, 5], 'quant.quadratic-equations': [0, 5],
      'quant.number-series': [0, 5], 'quant.quantity-comparison': [0, 5],
    },
  },
  'ibps-po/prelims/reasoning': {
    per: 35, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-ibps-po', 'ev-bankersadda-ibps-po-2026'],
    note: 'Puzzles + seating 15–25 (month/year/selection/box/floor puzzles dominate seating), syllogism 3–4, inequality 0–4, blood/direction 0–3 each, coding/alphanumeric 0–5.',
    q: { ...BANK_REASONING_PRE, 'reasoning.puzzles': [10, 15], 'reasoning.seating-arrangement': [5, 10] },
  },
  'ibps-po/mains/reasoning': {
    per: 40, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-ibps-po'],
    note: '2024–2026: puzzle/seating 10–20 (falling), critical reasoning 4–12 (rising: 12 in 2026), input-output 4–5, DS 2–3, coded direction 0–4.',
    q: {
      'reasoning.puzzles': { q: [8, 17], trend: 'declining' }, 'reasoning.seating-arrangement': [5, 10], 'reasoning.critical-reasoning': { q: [4, 12], trend: 'emerging' },
      'reasoning.data-sufficiency': [2, 3], 'reasoning.input-output': [4, 5], 'reasoning.syllogism': [0, 2], 'reasoning.inequality': [0, 2],
      'reasoning.coding-decoding': [0, 3], 'reasoning.blood-relations': [1, 2], 'reasoning.direction-distance': [0, 4], 'reasoning.order-ranking': [0, 1],
      'reasoning.alphanumeric-series': [0, 2],
    },
  },
  'ibps-po/mains/general-awareness': {
    per: 50, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-ibps-po'],
    note: '2024–25 (35 Q): CA 18–20, banking 7–8, economy 4, static 3–4; rescaled to 50 Q. RBI circulars are named in the 2026 section title.',
    q: { ...scale(BANK_GA_MAINS, 50 / 60), 'fin.rbi': [3, 5], 'fin.digital-payments': [1.5, 3] },
  },
  'ibps-po/mains/english': {
    per: 40, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-ibps-po'],
    note: '2024–2026: RC 11–18 (three passages, 18 Q in 2026), cloze 5–6, error 2–5, fillers 0–4, rearrangement 2–5, connectors/summary/column 3–10.',
    q: { ...BANK_ENGLISH_MAINS },
  },
  'ibps-po/mains/data-analysis': {
    per: 40, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-ibps-po'],
    note: '2024–2026: DI 18–24 (pie, bar, line, scatter, caselets, probability DI), DS 3, quadratic 2–3, series 2–3, QC 0–3, arithmetic 4–10.',
    q: {
      ...BANK_ARITH_MAINS, 'quant.data-interpretation': [18, 24], 'quant.data-sufficiency': [3, 3], 'quant.quantity-comparison': [0, 3],
      'quant.number-series': [2, 3], 'quant.quadratic-equations': [2, 3],
    },
  },
  'ibps-po/mains/descriptive': {
    per: 2, basis: 'editorial-estimate', confidence: 'low', evidence: ['ev-mahendras-ibps-po'],
    note: 'Official: 2 questions / 25 marks (essay + comprehension); mark split not stated, equal assumed.',
    q: { 'descriptive.essay': [1, 1], 'descriptive.comprehension-writing': [1, 1] },
  },
  'ibps-po/personality-test/personality': { nominal: true, note: 'Non-qualifying but mandatory.' },
  'ibps-po/interview/interview': { nominal: true, note: 'Single topic.' },

  // ═════════ IBPS Clerk ═════════
  'ibps-clerk/prelims/english': {
    per: 30, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-ibps-clerk'],
    note: 'Aug-2024 (12 shifts, identical): RC 10, cloze 5, error 5, para jumble 5, vocabulary 3, fillers 2. Oct-2026 S1: word swap 5 + word usage 3 replace vocabulary/fillers.',
    q: {
      'english.reading-comprehension': [9, 10], 'english.cloze-test': [5, 5], 'english.error-detection': [4, 5], 'english.para-jumbles': [3, 5],
      'english.word-usage': { q: [0, 8], trend: 'emerging' }, 'english.fill-blanks': { q: [0, 2], trend: 'declining' }, 'english.sentence-improvement': [0, 1],
      'english.sentence-completion': [0, 1], 'english.grammar-rules': [0.5, 1], 'english.synonyms-antonyms': { q: [0, 3], trend: 'declining' },
      'english.spelling': [0, 0.5], 'english.idioms-phrases': [0, 0.5],
    },
  },
  'ibps-clerk/prelims/quant': {
    per: 35, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-ibps-clerk'],
    note: 'Aug-2024 + Oct-2026: simplification 10–14, arithmetic 9–14, bar + table DI 10, caselet 0–6; no series/quadratic in these shifts.',
    q: {
      ...BANK_ARITH, 'quant.simplification': [10, 14], 'quant.data-interpretation': [10, 16], 'quant.number-series': [0, 1], 'quant.quadratic-equations': [0, 1],
      'quant.quantity-comparison': [0, 0.5], 'quant.mensuration-3d': [0, 0.5], 'quant.probability': [0, 0.5], 'quant.permutation-combination': [0, 0.5],
    },
  },
  'ibps-clerk/prelims/reasoning': {
    per: 35, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-ibps-clerk'],
    note: 'Puzzles + seating 15 (3 sets), coding 4–5, inequality 3–5, syllogism 0–3, blood 0–3, direction 2–3, alphanumeric 0–5, pair/meaningful/odd 1–3.',
    q: {
      'reasoning.puzzles': [8, 10], 'reasoning.seating-arrangement': [5, 7], 'reasoning.syllogism': [0, 3], 'reasoning.inequality': [3, 5],
      'reasoning.coding-decoding': [4, 5], 'reasoning.blood-relations': [0, 3], 'reasoning.direction-distance': [2, 3], 'reasoning.order-ranking': [0, 1],
      'reasoning.alphanumeric-series': [0, 5], 'reasoning.word-building': [1, 2], 'reasoning.classification': [0, 1],
    },
  },
  'ibps-clerk/mains/general-financial-awareness': {
    per: 40, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-mahendras-ibps-clerk'],
    note: '2024–25 (50 Q): CA 30, banking 10, static 5, economy 5, rescaled to the 2026 40-Q section (first held 27-Dec-2026).',
    q: {
      'ga.current-affairs': [12, 16], 'fin.banking-current-affairs': [2, 4], 'ga.govt-schemes': [1.5, 3], 'ga.sports': [1, 2], 'ga.science-technology': [0.5, 1.5],
      'ga.international-organisations': [0.5, 1.5], 'fin.budget-economic-survey': [0.5, 1.5], 'fin.banking-structure': [0.5, 1.5], 'fin.rbi': [1.5, 2.5],
      'fin.banking-terms': [1.5, 2.5], 'fin.digital-payments': [1, 2], 'fin.financial-markets': [0.5, 1], 'fin.financial-inclusion': [0.5, 1.5],
      'fin.regulators-institutions': [0.5, 1], 'fin.insurance-pension': [0.5, 1], 'fin.rural-agri-finance': [0, 1], 'ga.economy-basics': [1, 1.5],
      'ga.economy-fiscal': [0.5, 1.5], 'ga.economy-inflation': [0.5, 1], 'ga.static-gk': [1.5, 2.5], 'ga.geography-india': [0.5, 1.5], 'ga.art-culture': [0.5, 1],
    },
  },
  'ibps-clerk/mains/english': {
    per: 40, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-ibps-clerk'],
    note: '2024–25 (40 Q, identical both years): RC 15, cloze 5, error 5, sentence correction 5, vocabulary 5, para jumble 5.',
    q: {
      'english.reading-comprehension': [14, 15], 'english.cloze-test': [5, 5], 'english.error-detection': [4, 5], 'english.sentence-improvement': [4, 5],
      'english.fill-blanks': [1, 3], 'english.para-jumbles': [4, 5], 'english.word-usage': [1, 3], 'english.sentence-completion': [0, 2],
      'english.grammar-rules': [0.5, 1], 'english.synonyms-antonyms': [2, 3], 'english.spelling': [0, 1],
    },
  },
  'ibps-clerk/mains/reasoning': {
    per: 40, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-mahendras-ibps-clerk'],
    note: '2024–25 R&CA (50 Q) minus the 5 computer questions, rescaled to the 2026 40-Q Reasoning section: puzzles ≈16, seating ≈8, coding ≈4, input-output ≈4, logical ≈4.',
    q: {
      'reasoning.puzzles': [14, 17], 'reasoning.seating-arrangement': [7, 9], 'reasoning.coding-decoding': [3, 5], 'reasoning.input-output': [3, 5],
      'reasoning.syllogism': [1, 3], 'reasoning.inequality': [1, 3], 'reasoning.blood-relations': [0, 2], 'reasoning.direction-distance': [0, 2],
      'reasoning.order-ranking': [0, 1], 'reasoning.alphanumeric-series': [0, 2], 'reasoning.data-sufficiency': [0, 2], 'reasoning.critical-reasoning': [1, 3],
    },
  },
  'ibps-clerk/mains/quant': {
    per: 40, basis: 'pyq-estimate', confidence: 'low', evidence: ['ev-mahendras-ibps-clerk'],
    note: '2024–25 (50 Q): DI 20, arithmetic 15, approximation 5, series 5, DS 5, rescaled to 40 Q.',
    q: {
      ...BANK_ARITH, 'quant.data-interpretation': [14, 17], 'quant.simplification': [3, 5], 'quant.number-series': [3, 5], 'quant.quadratic-equations': [0, 3],
      'quant.quantity-comparison': [0, 3], 'quant.data-sufficiency': [0, 4],
    },
  },
  'ibps-clerk/llpt/llpt': { nominal: true, note: 'Single qualifying test.' },

  // ═════════ IBPS RRB PO ═════════
  'ibps-rrb-po/prelims/reasoning': {
    per: 40, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-rrb-po', 'ev-careerpower-rrb-po-2025'],
    note: 'Aug-2024 + Nov-2025 (≈20 shifts): 4 puzzle/seating sets (20), syllogism 4–5, inequality 0–5, blood 3, direction 3, coding/alphanumeric 4–5, order 0–3, pair/word 1–2.',
    q: {
      'reasoning.puzzles': [10, 15], 'reasoning.seating-arrangement': [5, 10], 'reasoning.syllogism': [4, 5], 'reasoning.inequality': [0, 5],
      'reasoning.coding-decoding': [0, 5], 'reasoning.blood-relations': [3, 3], 'reasoning.direction-distance': [3, 3], 'reasoning.order-ranking': [0, 3],
      'reasoning.alphanumeric-series': [0, 4], 'reasoning.word-building': [1, 2], 'reasoning.classification': [0, 1],
    },
  },
  'ibps-rrb-po/prelims/quant': {
    per: 40, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-rrb-po', 'ev-careerpower-rrb-po-2025'],
    note: 'Arithmetic 10–15, DI 10, simplification/approximation 5–10, number series 5, quadratic 0–5.',
    q: {
      ...scale(BANK_ARITH, 13 / 12), 'quant.data-interpretation': [10, 11], 'quant.simplification': [5, 10], 'quant.number-series': [5, 5],
      'quant.quadratic-equations': [0, 5], 'quant.quantity-comparison': [0, 1],
    },
  },
  'ibps-rrb-po/mains/reasoning': {
    per: 40, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-rrb-po'],
    note: '2024–25 (identical): puzzle sets 20, seating 10, coding 5, logical reasoning 5.',
    q: {
      'reasoning.puzzles': [18, 20], 'reasoning.seating-arrangement': [9, 10], 'reasoning.coding-decoding': [4, 5], 'reasoning.critical-reasoning': [3, 5],
      'reasoning.syllogism': [0, 2], 'reasoning.inequality': [0, 2], 'reasoning.blood-relations': [0, 1], 'reasoning.direction-distance': [0, 1],
      'reasoning.order-ranking': [0, 1], 'reasoning.alphanumeric-series': [0, 1], 'reasoning.input-output': [0, 2], 'reasoning.data-sufficiency': [0, 2],
    },
  },
  'ibps-rrb-po/mains/computer': {
    per: 40, basis: 'editorial-estimate', confidence: 'very-low', evidence: [],
    note: 'No topic-wise data for RRB Computer Knowledge; weighted by syllabus breadth and typical banking computer-awareness questions.',
    q: { ...BANK_COMPUTER_40 },
  },
  'ibps-rrb-po/mains/general-awareness': {
    per: 40, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-rrb-po'],
    note: '2024–25: current affairs 25–26, banking 6–7, economy 5, static 3. Rural/agricultural finance emphasised for RRBs.',
    q: {
      'ga.current-affairs': [17, 20], 'fin.rural-agri-finance': [1.5, 3], 'fin.banking-current-affairs': [2, 3], 'fin.banking-structure': [0.5, 1.5],
      'fin.rbi': [1, 2], 'fin.banking-terms': [1, 2], 'fin.digital-payments': [0.5, 1.5], 'fin.financial-inclusion': [0.5, 1.5],
      'fin.regulators-institutions': [0.5, 1], 'fin.insurance-pension': [0.5, 1], 'fin.financial-markets': [0, 0.5], 'fin.budget-economic-survey': [0.5, 1.5],
      'ga.economy-agriculture': [1, 2], 'ga.economy-basics': [0.5, 1.5], 'ga.economy-inflation': [0.5, 1], 'ga.govt-schemes': [1.5, 3],
      'ga.international-organisations': [0.5, 1], 'ga.static-gk': [1, 2], 'ga.sports': [0.5, 1.5], 'ga.geography-india': [0.5, 1.5],
      'ga.art-culture': [0, 1], 'ga.science-technology': [0.5, 1],
    },
  },
  'ibps-rrb-po/mains/english': {
    per: 40, basis: 'proxy-estimate', confidence: 'very-low', evidence: ['ev-mahendras-ibps-clerk'],
    note: 'No RRB English breakdown; IBPS Clerk Mains English 2024–25 used as proxy.',
    q: {
      'english.reading-comprehension': [10, 12], 'english.cloze-test': [5, 6], 'english.error-detection': [4, 6], 'english.fill-blanks': [3, 5],
      'english.para-jumbles': [3, 5], 'english.sentence-improvement': [2, 4], 'english.word-usage': [2, 4], 'english.sentence-completion': [1, 2],
      'english.grammar-rules': [0.5, 1], 'english.synonyms-antonyms': [0, 2], 'english.idioms-phrases': [0, 1],
    },
  },
  'ibps-rrb-po/mains/hindi': {
    per: 40, basis: 'editorial-estimate', confidence: 'very-low', evidence: [],
    note: 'No Hindi-section data; mirrors the English section mix (comprehension, cloze, error, fillers, rearrangement) plus vocabulary/idioms.',
    q: {
      'hindi.comprehension': [8, 10], 'hindi.cloze-test': [5, 6], 'hindi.sentence-correction': [5, 6], 'hindi.fill-blanks': [4, 5],
      'hindi.para-jumbles': [3, 5], 'hindi.vocabulary': [4, 6], 'hindi.idioms': [2, 3], 'hindi.grammar': [3, 5],
    },
  },
  'ibps-rrb-po/mains/quant': {
    per: 40, basis: 'pyq-estimate', confidence: 'medium', evidence: ['ev-mahendras-rrb-po'],
    note: '2024–25 (identical): DI 20, arithmetic 10, number series 5, approximation 5.',
    q: {
      ...scale(BANK_ARITH_MAINS, 10 / 9), 'quant.data-interpretation': [18, 20], 'quant.number-series': [4, 5], 'quant.quadratic-equations': [0, 2],
      'quant.quantity-comparison': [0, 2], 'quant.data-sufficiency': [0, 2], 'quant.simplification': [4, 5],
    },
  },
  'ibps-rrb-po/interview/interview': { nominal: true, note: 'Single topic.' },

  // ═════════ IBPS RRB Clerk ═════════
  'ibps-rrb-clerk/prelims/reasoning': {
    per: 40, basis: 'proxy-estimate', confidence: 'low', evidence: ['ev-mahendras-rrb-po', 'ev-mahendras-ibps-clerk'],
    note: 'No RRB Clerk topic counts read; RRB PO prelims (same structure) blended with IBPS Clerk prelims (more coding/inequality, easier puzzles).',
    q: {
      'reasoning.puzzles': [9, 13], 'reasoning.seating-arrangement': [5, 9], 'reasoning.syllogism': [3, 5], 'reasoning.inequality': [2, 5],
      'reasoning.coding-decoding': [3, 5], 'reasoning.blood-relations': [2, 3], 'reasoning.direction-distance': [2, 3], 'reasoning.order-ranking': [0, 3],
      'reasoning.alphanumeric-series': [0, 5], 'reasoning.word-building': [1, 2], 'reasoning.classification': [0, 1],
    },
  },
  'ibps-rrb-clerk/prelims/quant': {
    per: 40, basis: 'proxy-estimate', confidence: 'low', evidence: ['ev-mahendras-rrb-po', 'ev-mahendras-ibps-clerk'],
    note: 'Proxy blend: simplification 10–15 (clerk level), arithmetic 12–15, DI 5–10, number series 0–5, quadratic 0–5.',
    q: {
      ...scale(BANK_ARITH, 13 / 12), 'quant.simplification': [10, 15], 'quant.data-interpretation': [5, 10], 'quant.number-series': [0, 5],
      'quant.quadratic-equations': [0, 5], 'quant.mensuration-3d': [0, 0.5], 'quant.probability': [0, 0.5], 'quant.permutation-combination': [0, 0.5],
    },
  },
  'ibps-rrb-clerk/mains/reasoning': {
    per: 40, basis: 'proxy-estimate', confidence: 'very-low', evidence: ['ev-mahendras-rrb-po'],
    note: 'Proxy: RRB PO Mains 2024–25 (puzzles 20, seating 10, coding 5, logical 5), shifted toward simpler puzzles and miscellaneous topics for clerk level.',
    q: {
      'reasoning.puzzles': [15, 18], 'reasoning.seating-arrangement': [8, 10], 'reasoning.coding-decoding': [4, 5], 'reasoning.critical-reasoning': [1, 3],
      'reasoning.syllogism': [1, 3], 'reasoning.inequality': [1, 3], 'reasoning.blood-relations': [0, 2], 'reasoning.direction-distance': [0, 2],
      'reasoning.order-ranking': [0, 1], 'reasoning.alphanumeric-series': [0, 2], 'reasoning.input-output': [0, 2], 'reasoning.data-sufficiency': [0, 2],
    },
  },
  'ibps-rrb-clerk/mains/computer': {
    per: 40, basis: 'editorial-estimate', confidence: 'very-low', evidence: [],
    note: 'No topic-wise data; same editorial distribution as RRB PO but tilted toward fundamentals/MS Office for clerk level.',
    q: { ...BANK_COMPUTER_40, 'computer.fundamentals': [5, 7], 'computer.ms-office': [7, 10], 'computer.programming-dbms': [1, 3], 'computer.emerging-tech': [1, 3] },
  },
  'ibps-rrb-clerk/mains/general-awareness': {
    per: 40, basis: 'proxy-estimate', confidence: 'low', evidence: ['ev-mahendras-rrb-po'],
    note: 'Proxy: RRB PO Mains GA 2024–25 (CA 25–26, banking 6–7, economy 5, static 3) with a little more static GK.',
    q: {
      'ga.current-affairs': [16, 19], 'fin.rural-agri-finance': [1.5, 3], 'fin.banking-current-affairs': [1.5, 3], 'fin.banking-structure': [0.5, 1.5],
      'fin.rbi': [1, 2], 'fin.banking-terms': [1, 2], 'fin.digital-payments': [0.5, 1.5], 'fin.financial-inclusion': [0.5, 1.5],
      'fin.regulators-institutions': [0.5, 1], 'fin.insurance-pension': [0.5, 1], 'fin.budget-economic-survey': [0.5, 1.5], 'ga.economy-agriculture': [1, 2],
      'ga.economy-basics': [0.5, 1], 'ga.economy-inflation': [0.5, 1], 'ga.govt-schemes': [1.5, 3], 'ga.international-organisations': [0.5, 1],
      'ga.static-gk': [1.5, 2.5], 'ga.sports': [0.5, 1.5], 'ga.geography-india': [0.5, 1.5], 'ga.art-culture': [0.5, 1], 'ga.science-technology': [0.5, 1],
    },
  },
  'ibps-rrb-clerk/mains/english': {
    per: 40, basis: 'proxy-estimate', confidence: 'very-low', evidence: ['ev-mahendras-ibps-clerk'],
    note: 'No RRB English breakdown; IBPS Clerk Prelims/Mains English used as proxy (more vocabulary-style questions).',
    q: {
      'english.reading-comprehension': [10, 12], 'english.cloze-test': [5, 6], 'english.error-detection': [4, 6], 'english.fill-blanks': [3, 5],
      'english.para-jumbles': [3, 5], 'english.sentence-improvement': [2, 4], 'english.word-usage': [2, 4], 'english.sentence-completion': [1, 2],
      'english.grammar-rules': [0.5, 1], 'english.synonyms-antonyms': [1, 3], 'english.idioms-phrases': [0, 1],
    },
  },
  'ibps-rrb-clerk/mains/hindi': {
    per: 40, basis: 'editorial-estimate', confidence: 'very-low', evidence: [],
    note: 'No Hindi-section data; same editorial mix as RRB PO Hindi with more vocabulary/grammar for clerk level.',
    q: {
      'hindi.comprehension': [7, 9], 'hindi.cloze-test': [5, 6], 'hindi.sentence-correction': [5, 6], 'hindi.fill-blanks': [4, 6],
      'hindi.para-jumbles': [3, 4], 'hindi.vocabulary': [5, 7], 'hindi.idioms': [2, 3], 'hindi.grammar': [4, 6],
    },
  },
  'ibps-rrb-clerk/mains/quant': {
    per: 40, basis: 'proxy-estimate', confidence: 'very-low', evidence: ['ev-mahendras-rrb-po'],
    note: 'Proxy: RRB PO Mains quant (DI 20, arithmetic 10, series 5, approximation 5) with more simplification and less DI for clerk level.',
    q: {
      ...scale(BANK_ARITH_MAINS, 12 / 9), 'quant.data-interpretation': [14, 17], 'quant.simplification': [5, 7], 'quant.number-series': [4, 5],
      'quant.quadratic-equations': [0, 3], 'quant.quantity-comparison': [0, 2], 'quant.data-sufficiency': [0, 2], 'quant.permutation-combination': [0, 0.5],
    },
  },
};

// Single-topic and gate sections not listed above are filled automatically (100%, basis 'nominal').

// ─────────────────────────────── Subtopic profiles ───────────────────────────────
// Relative weights by subtopic slug. Variants: `all`, or `ssc` / `banking`. Missing slugs get weight 1.
// `basis` defaults to 'editorial-estimate'; 'pyq-estimate' where shift analyses name the sub-types.
export const SUBTOPIC_PROFILES = {
  'quant.number-system': { all: { classification: 1, 'place-face-value': 0.5, divisibility: 2, 'unit-digit': 2, remainders: 2.5, factors: 2, primes: 1, 'trailing-zeros': 1, 'recurring-decimals': 1, 'series-sums': 1.5, relationships: 1.5 } },
  'quant.hcf-lcm': { all: { basics: 3, 'fractions-decimals': 1.5, 'product-relation': 2, 'word-problems': 3.5 } },
  'quant.simplification': {
    ssc: { bodmas: 3, 'whole-numbers': 2, decimals: 1.5, fractions: 2, 'square-cube-roots': 2, approximation: 0.5, 'continued-fractions': 1 },
    banking: { bodmas: 3, 'whole-numbers': 1.5, decimals: 1.5, fractions: 1.5, 'square-cube-roots': 2, approximation: 3.5, 'continued-fractions': 0.25 },
    basis: 'pyq-estimate',
  },
  'quant.surds-indices': { all: { 'laws-of-indices': 3, 'surds-operations': 3, rationalisation: 2, comparison: 1.5, 'exponential-equations': 1 } },
  'quant.percentage': {
    ssc: { basics: 2, 'percent-change': 2.5, 'successive-change': 2, 'product-constancy': 1.5, 'population-depreciation': 1, applications: 2 },
    banking: { basics: 2, 'percent-change': 2.5, 'successive-change': 1.5, 'product-constancy': 1, 'population-depreciation': 1, applications: 3 },
  },
  'quant.ratio-proportion': { all: { 'ratio-basics': 3, proportion: 2, variation: 1, 'income-expenditure': 2, 'coins-distribution': 1.5 } },
  'quant.partnership': { all: { simple: 3, compound: 4, 'working-sleeping': 2 } },
  'quant.mixture-alligation': { all: { rule: 3, 'mean-price': 2, replacement: 2.5, 'multi-mixtures': 1, applications: 2 } },
  'quant.average': { all: { simple: 2.5, weighted: 2, replacement: 3, consecutive: 1.5, 'age-runs': 1.5 } },
  'quant.simple-interest': { all: { basics: 4, 'amount-doubling': 2, 'rate-time-change': 2, installments: 1 } },
  'quant.compound-interest': { all: { annual: 3, 'half-quarterly': 2, 'ci-si-difference': 2.5, installments: 1.5, 'effective-rate': 1, 'fractional-time': 0.5 } },
  'quant.profit-loss': { all: { 'cp-sp': 3, 'marked-price': 2.5, 'dishonest-dealer': 1.5, 'successive-transactions': 1, 'same-sp': 1, offers: 1, overheads: 0.5 } },
  'quant.discount': { all: { single: 2, successive: 3, 'mp-cp-relation': 3.5, 'true-bankers-discount': 0.25 } },
  'quant.time-work': { all: { efficiency: 3, 'group-work': 2.5, 'alternate-days': 1.5, 'joining-leaving': 2, 'man-days': 1.5, wages: 1 } },
  'quant.pipes-cisterns': { all: { 'inlet-outlet': 3, leaks: 2, alternate: 1.5 } },
  'quant.time-distance': { all: { basics: 2.5, 'average-speed': 2, 'relative-speed': 2.5, 'meeting-overtaking': 2, races: 1, 'circular-track': 1, 'late-early': 1.5 } },
  'quant.trains': { all: { 'crossing-pole': 2, 'crossing-platform': 2, 'two-trains': 3 } },
  'quant.boats-streams': { all: { 'upstream-downstream': 3, 'round-trip': 2 } },
  'quant.ages': { all: { 'present-past-future': 3, 'ratio-based': 3 } },
  'quant.algebra-identities': { all: { identities: 3, 'reciprocal-type': 3, factorization: 1.5, conditional: 2.5, 'min-max': 1, componendo: 1 } },
  'quant.linear-equations': { all: { 'one-variable': 2, 'two-variables': 3, consistency: 1.5, 'word-problems': 2 } },
  'quant.coordinate-geometry': { all: { 'graphs-linear': 3, 'slope-intercept': 2, 'area-by-lines': 2.5, 'distance-section': 1, 'triangle-area': 1 } },
  'quant.quadratic-equations': { all: { roots: 3, nature: 1, 'sum-product': 1, comparison: 5 }, basis: 'pyq-estimate' },
  'quant.geometry-lines-angles': { all: { angles: 1, 'parallel-transversal': 2 } },
  'quant.geometry-triangles': { all: { properties: 2, centres: 3, congruence: 1, similarity: 2.5, pythagoras: 1.5, theorems: 2, inequality: 1 } },
  'quant.geometry-circles': { all: { chords: 2.5, tangents: 3, 'angles-subtended': 2.5, 'cyclic-quadrilateral': 2, 'common-tangents': 1.5, intersecting: 1 } },
  'quant.geometry-quadrilaterals-polygons': { all: { quadrilaterals: 3, 'regular-polygons': 2 } },
  'quant.mensuration-2d': {
    ssc: { triangle: 2.5, quadrilaterals: 2, 'regular-polygons': 1.5, circle: 2.5, 'paths-combined': 1 },
    banking: { triangle: 2, quadrilaterals: 2.5, circle: 3, 'regular-polygons': 0.5, 'paths-combined': 1 },
  },
  'quant.mensuration-3d': { all: { 'cube-cuboid': 2, cylinder: 2, cone: 2, 'sphere-hemisphere': 2, prism: 1.5, pyramid: 1.5, frustum: 0.5, recasting: 1.5 } },
  'quant.trigonometry': { all: { ratios: 2, 'degree-radian': 0.5, identities: 3, complementary: 1.5, 'min-max': 1.5, simplification: 3 } },
  'quant.heights-distances': { all: { 'elevation-depression': 2, 'single-object': 2, 'two-objects': 1.5 } },
  'quant.statistics': { all: { 'mean-median-mode': 4, 'sd-variance': 2, range: 1, 'grouped-data': 1.5 } },
  'quant.probability': { all: { basics: 2, 'coins-dice': 2, cards: 1.5, 'balls-bags': 2.5, events: 1 } },
  'quant.permutation-combination': { all: { 'counting-principle': 1, arrangements: 3, selections: 3, circular: 1 } },
  'quant.data-interpretation': {
    ssc: { tables: 2.5, bar: 3, line: 1.5, pie: 3, histogram: 1, 'frequency-polygon': 0.5, mixed: 0.5, caselet: 0.5, missing: 0.5, 'new-pattern': 0.25 },
    banking: { tables: 3, bar: 2.5, line: 2, pie: 2, histogram: 0.25, 'frequency-polygon': 0.25, mixed: 2, caselet: 2.5, missing: 1.5, 'new-pattern': 1 },
    basis: 'pyq-estimate',
  },
  'quant.data-sufficiency': { all: { 'two-statement': 3, 'three-statement': 2, 'not-necessary': 1 } },
  'quant.number-series': { all: { missing: 3, wrong: 2.5, patterns: 2 }, basis: 'pyq-estimate' },
  'quant.quantity-comparison': { all: { 'quantity-i-ii': 3, 'arithmetic-based': 2 } },

  'reasoning.analogy': { all: { semantic: 3, 'symbolic-number': 3.5, letter: 2, figural: 1.5 } },
  'reasoning.classification': { ssc: { semantic: 2.5, 'symbolic-number': 3, letter: 2.5, figural: 1.5 }, banking: { semantic: 1, letter: 1 } },
  'reasoning.series': { all: { number: 3.5, alphabet: 2, 'alpha-numeric': 1, semantic: 1, figural: 1.5, 'missing-in-figure': 2 } },
  'reasoning.coding-decoding': {
    ssc: { letter: 3, number: 2.5, symbolic: 1.5, 'word-sentence': 0.5, conditional: 0.25 },
    banking: { letter: 1, number: 0.5, symbolic: 0.5, 'word-sentence': 4, conditional: 2 }, basis: 'pyq-estimate',
  },
  'reasoning.mathematical-operations': { all: { numerical: 2, symbolic: 3, interchange: 2.5, balancing: 1.5 } },
  'reasoning.word-building': { ssc: { formation: 1.5, 'dictionary-order': 3, 'letter-position': 1.5 }, banking: { formation: 2, 'dictionary-order': 1, 'letter-position': 2.5 } },
  'reasoning.blood-relations': { ssc: { direct: 3, coded: 2, 'family-tree': 1 }, banking: { direct: 2, coded: 1.5, 'family-tree': 2.5 } },
  'reasoning.direction-distance': { ssc: { basic: 3, shadow: 1, coded: 0.5 }, banking: { basic: 2, shadow: 0.5, coded: 2.5 }, basis: 'pyq-estimate' },
  'reasoning.order-ranking': { all: { position: 3, comparison: 2, interchange: 1 } },
  'reasoning.venn-diagrams': { all: { logical: 3, counting: 2 } },
  'reasoning.syllogism': { ssc: { classic: 4, possibility: 2, 'only-a-few': 0.5, reverse: 0.5 }, banking: { classic: 2.5, possibility: 3, 'only-a-few': 1.5, reverse: 1.5 }, basis: 'pyq-estimate' },
  'reasoning.critical-reasoning': {
    ssc: { 'statement-conclusion': 3, inferences: 2, 'decision-making': 1, assumptions: 1.5 },
    banking: { 'statement-conclusion': 1, assumptions: 1.5, arguments: 1, 'course-action': 1, 'cause-effect': 1.5, inferences: 3, 'strengthen-weaken': 3, 'decision-making': 0.5 },
  },
  'reasoning.emotional-social-intelligence': { all: { emotional: 1, social: 1 } },
  'reasoning.arithmetic-reasoning': { all: { 'arithmetic-reasoning': 2, 'problem-solving': 2, 'visual-memory': 1 } },
  'reasoning.calendar-clock': { all: { calendar: 1, clock: 1 } },
  'reasoning.mirror-water-images': { all: { mirror: 3, water: 1.5 } },
  'reasoning.paper-folding-cutting': { all: { 'punched-hole': 2, 'folding-unfolding': 2 } },
  'reasoning.figure-completion': { all: { completion: 2, formation: 1 } },
  'reasoning.counting-figures': { all: { triangles: 3, 'squares-rectangles': 1.5, 'lines-others': 0.5 } },
  'reasoning.cubes-dice': { all: { dice: 3, 'cube-cutting': 1.5, 'space-visualization': 1.5, rotation: 1 } },
  'reasoning.clerical-aptitude': { all: { indexing: 1, 'address-matching': 1.5, 'date-city-matching': 1, 'centre-codes': 1, 'case-coding': 1.5 } },
  'reasoning.seating-arrangement': {
    ssc: { 'linear-single': 1, circular: 1 },
    banking: { 'linear-single': 2, 'linear-double': 2.5, circular: 3, 'square-rectangle': 2, uncertain: 1.5 }, basis: 'pyq-estimate',
  },
  'reasoning.puzzles': { all: { floor: 3, box: 2.5, scheduling: 3, comparison: 1, categorised: 2, 'designation-age': 2, uncertain: 1 }, basis: 'pyq-estimate' },
  'reasoning.inequality': { all: { direct: 2, coded: 2, conditional: 1 } },
  'reasoning.input-output': { all: { shifting: 2, 'step-based': 2 } },
  'reasoning.data-sufficiency': { all: { 'two-statement': 3, 'three-statement': 2 } },
  'reasoning.alphanumeric-series': { all: { 'position-based': 2, 'conditional-counting': 2, 'word-letter-number': 2 } },

  'english.grammar-rules': { all: { 'parts-of-speech': 1, 'nouns-pronouns': 1.5, articles: 1.5, 'verbs-tenses': 2.5, 'subject-verb': 2.5, modals: 1, 'adjectives-adverbs': 1.5, prepositions: 2, conjunctions: 1.5, conditionals: 1, 'parallelism-redundancy': 1, 'misc-rules': 1 } },
  'english.reading-comprehension': { ssc: { factual: 3, inference: 3, 'vocab-in-context': 2, 'tone-title': 1.5, 'passage-types': 0.5 }, banking: { factual: 2.5, inference: 3.5, 'vocab-in-context': 2, 'tone-title': 1.5, 'passage-types': 0.5 } },
  'english.cloze-test': { ssc: { standard: 4, replacement: 0.25 }, banking: { standard: 3, replacement: 1.5 } },
  'english.error-detection': { ssc: { 'spot-error': 4, 'correct-sentence': 1 }, banking: { 'spot-error': 2.5, 'correct-sentence': 2.5 } },
  'english.sentence-improvement': { all: { 'phrase-replacement': 4, 'no-improvement': 1 } },
  'english.fill-blanks': { ssc: { single: 3, multiple: 0.5, 'grammar-based': 2, 'vocab-based': 2 }, banking: { single: 1, multiple: 3, 'grammar-based': 1, 'vocab-based': 2 }, basis: 'pyq-estimate' },
  'english.synonyms-antonyms': { ssc: { synonyms: 2.5, antonyms: 2.5, homonyms: 1, usage: 1.5 }, banking: { synonyms: 1, antonyms: 1, usage: 2 } },
  'english.spelling': { all: { misspelt: 2, 'correct-spelling': 1.5 } },
  'english.idioms-phrases': { ssc: { idioms: 3, 'phrasal-verbs': 1, 'idiomatic-usage': 1.5 }, banking: { idioms: 1.5, 'phrasal-verbs': 1, 'idiomatic-usage': 1 } },
  'english.para-jumbles': { ssc: { 'sentence-parts': 2, 'passage-sentences': 2 }, banking: { 'passage-sentences': 3, 'odd-sentence': 1, 'first-last-fixed': 1, 'para-completion': 1.5 }, basis: 'pyq-estimate' },
  'english.sentence-completion': { ssc: { completion: 1, connectors: 0.25 }, banking: { completion: 1, connectors: 2 } },
  'english.word-usage': { all: { 'word-swap': 2, 'word-usage': 2, 'phrase-rearrangement': 2, 'column-match': 1.5 }, basis: 'pyq-estimate' },

  'hindi.grammar': { all: { 'parts-of-speech': 1.5, sandhi: 2, samas: 2, 'upsarg-pratyay': 1.5, 'ling-vachan': 1.5, karak: 1, 'kaal-vachya': 1 } },
  'hindi.vocabulary': { all: { paryayvachi: 2, vilom: 2, 'one-word': 1.5, 'tatsam-tadbhav': 1, vartani: 1.5 } },
  'hindi.idioms': { all: { muhavare: 3, lokoktiyan: 1.5 } },
  'hindi.sentence-correction': { all: { error: 2, correction: 2 } },

  'ga.history-ancient': { all: { prehistoric: 0.5, 'indus-valley': 1.5, vedic: 1.5, mahajanapadas: 1, 'buddhism-jainism': 2, mauryan: 1.5, 'post-mauryan': 1, gupta: 1.5, 'post-gupta': 1, 'south-indian': 1.5 } },
  'ga.history-medieval': { all: { 'early-medieval': 1, 'delhi-sultanate': 2.5, 'vijayanagara-bahmani': 1.5, mughals: 3, marathas: 1.5, 'bhakti-sufi': 1.5, architecture: 1 } },
  'ga.history-modern': { all: { europeans: 1, 'british-expansion': 1.5, 'governor-generals': 1.5, 'revolt-1857': 1.5, 'reform-movements': 2, 'inc-early': 2, gandhian: 2.5, revolutionary: 1, 'constitutional-development': 1.5, independence: 1, personalities: 2 } },
  'ga.art-culture': { all: { dances: 2.5, music: 2, painting: 1, 'architecture-monuments': 1.5, unesco: 1, 'festivals-fairs': 2, 'literature-languages': 1, 'religion-philosophy': 1, 'theatre-puppetry': 0.5 } },
  'ga.geography-physical': { all: { 'universe-solar': 1.5, 'earth-structure': 1, 'lat-long-time': 1, 'rocks-landforms': 1, 'volcano-earthquake': 1, atmosphere: 1.5, 'climate-winds': 1.5, oceans: 1, 'world-geography': 1.5 } },
  'ga.geography-india': {
    ssc: { physiography: 1.5, 'rivers-drainage': 2.5, 'climate-monsoon': 1, soils: 1.5, 'vegetation-forests': 1, 'protected-areas': 1.5, 'minerals-energy': 1.5, 'agriculture-crops': 1.5, industries: 1, transport: 1, 'population-census': 1, 'dams-projects': 1, 'states-capitals': 1 },
    banking: { 'protected-areas': 2, 'dams-projects': 1.5, 'states-capitals': 1, 'agriculture-crops': 1.5 },
  },
  'ga.india-neighbours': { all: { borders: 2, 'capitals-currencies': 1.5, 'shared-rivers': 1, relations: 1 } },
  'ga.polity': { all: { 'making-sources': 1, 'preamble-features': 1.5, 'fundamental-rights': 2.5, dpsp: 1.5, 'fundamental-duties': 1, 'union-executive': 2, parliament: 2.5, judiciary: 2, 'state-government': 1, 'local-government': 1.5, 'constitutional-bodies': 1.5, 'non-constitutional-bodies': 1, emergency: 1, amendments: 1.5, 'centre-state': 0.5, citizenship: 0.5, elections: 1, 'articles-schedules': 2 } },
  'ga.economy-basics': { all: { concepts: 1.5, 'national-income': 2, sectors: 1.5, 'nature-indian-economy': 1 } },
  'ga.economy-planning': { all: { 'five-year-plans': 1.5, 'niti-aayog': 1 } },
  'ga.economy-fiscal': { all: { budget: 2, deficits: 1.5, 'taxation-gst': 2, frbm: 1 } },
  'ga.economy-inflation': { all: { 'types-causes': 2, indices: 2, control: 1 } },
  'ga.economy-social': { all: { poverty: 1.5, unemployment: 1.5, population: 1.5, hdi: 1 } },
  'ga.economy-reforms': { all: { 'lpg-1991': 2, disinvestment: 1, demonetisation: 1 } },
  'ga.economy-external': { all: { bop: 2, 'fdi-fpi': 1.5, 'exchange-rate': 1.5, 'trade-policy': 1 } },
  'ga.economy-infrastructure': { all: { energy: 1.5, transport: 1.5, communication: 1 } },
  'ga.economy-agriculture': { all: { 'green-revolution': 1, 'msp-procurement': 1.5, 'agri-schemes': 1.5 } },
  'ga.international-organisations': { all: { un: 2, 'bretton-woods': 2, regional: 2, 'hq-heads': 2 } },
  'ga.govt-schemes': { all: { 'social-welfare': 2, 'employment-rural': 1.5, 'health-education': 1.5, 'flagship-missions': 2 } },
  'ga.e-governance': { all: { 'digital-india': 1.5, 'dbt-jam': 1.5, 'service-delivery': 1 } },
  'ga.science-physics': { all: { units: 1.5, motion: 1.5, 'work-energy': 1, gravitation: 1, 'pressure-fluids': 1, heat: 1, sound: 1, light: 1.5, 'electricity-magnetism': 1.5, 'modern-physics': 0.5 } },
  'ga.science-chemistry': { all: { matter: 1, 'atomic-structure': 1, 'periodic-table': 1.5, 'bonding-reactions': 1, 'acids-bases-salts': 1.5, 'metals-nonmetals': 1.5, 'carbon-compounds': 1, 'everyday-chemistry': 2 } },
  'ga.science-biology': { all: { cell: 1.5, 'human-body': 3, nutrition: 2, diseases: 2, 'plant-kingdom': 1.5, 'animal-kingdom': 1.5, genetics: 1, biotechnology: 0.5 } },
  'ga.science-technology': { all: { space: 2, defence: 2, nuclear: 0.5, 'it-emerging': 1, research: 1, inventions: 1.5 } },
  'ga.environment': { all: { ecology: 1.5, biodiversity: 1.5, pollution: 1, 'climate-change': 1.5, 'laws-organisations': 1, wetlands: 1 } },
  'ga.static-gk': { ssc: { 'books-authors': 2, awards: 2, 'important-days': 1.5, 'national-symbols': 1, firsts: 1, 'world-capitals-currencies': 0.5, abbreviations: 0.5 }, banking: { 'books-authors': 1.5, awards: 2, 'important-days': 1.5, 'world-capitals-currencies': 1.5 } },
  'ga.sports': { all: { trophies: 1.5, terms: 1, events: 2, 'players-records': 1.5, 'sports-awards': 1 } },
  'ga.current-affairs': {
    ssc: { national: 3, international: 2, 'economy-business': 1.5, 'science-tech': 1, sports: 2, 'awards-honours': 2, appointments: 1.5, summits: 1, 'schemes-policies': 1.5, defence: 1, 'rankings-indices': 1, obituaries: 0.5 },
    banking: { national: 2.5, international: 2, 'economy-business': 2.5, 'science-tech': 1, sports: 1.5, 'awards-honours': 1.5, appointments: 2, summits: 1.5, 'schemes-policies': 2, defence: 1, 'rankings-indices': 2, obituaries: 0.5 },
  },

  'fin.banking-structure': { all: { history: 1, nationalisation: 1, 'types-of-banks': 2, 'psb-mergers': 1.5, nbfc: 1.5, 'hq-taglines': 2 } },
  'fin.rbi': { ssc: { 'history-functions': 2, 'monetary-tools': 3 }, banking: { 'history-functions': 1, 'monetary-tools': 3, mpc: 1.5, 'rbi-circulars': 3, leadership: 1 } },
  'fin.banking-terms': { all: { 'accounts-deposits': 1.5, 'kyc-aml': 1, 'negotiable-instruments': 1, 'loans-npa': 2, 'capital-basel': 1.5, 'priority-sector': 1, 'recovery-laws': 1, terms: 2 } },
  'fin.digital-payments': { all: { 'payment-systems': 2, 'upi-npci': 3, 'cards-atm': 1, cbdc: 1.5, fintech: 1, 'cyber-fraud': 1.5 } },
  'fin.financial-markets': { all: { 'money-market': 2, 'capital-market': 1.5, 'stock-exchanges': 1.5, sebi: 1.5, 'mutual-funds-bonds': 1 } },
  'fin.financial-inclusion': { all: { schemes: 3, 'lead-bank': 1, 'shg-mfi': 1.5, literacy: 1 } },
  'fin.regulators-institutions': { all: { regulators: 2, dfis: 2, dicgc: 1, global: 1.5 } },
  'fin.insurance-pension': { all: { 'insurance-basics': 1.5, insurers: 1.5, pension: 1.5 } },
  'fin.rural-agri-finance': { all: { rrb: 2, nabard: 2, kcc: 1.5, 'crop-insurance': 1, 'shg-linkage': 1 } },
  'fin.budget-economic-survey': { all: { 'budget-highlights': 2, 'economic-survey': 1 } },
  'fin.banking-current-affairs': { all: { appointments: 1.5, 'mergers-licences-penalties': 2, 'products-partnerships': 1.5, 'reports-rankings': 1.5 } },

  'computer.fundamentals': { all: { generations: 1, organization: 2, cpu: 2, 'io-devices': 2, types: 1 } },
  'computer.memory': { all: { primary: 2, cache: 1, secondary: 1.5, units: 1.5, organization: 1, backup: 1 } },
  'computer.hardware-ports': { all: { ports: 2, 'buses-motherboard': 1 } },
  'computer.software-os': { all: { 'system-application': 1.5, 'os-functions': 1.5, 'windows-os': 1.5, 'windows-explorer': 1.5, shortcuts: 2.5, 'utilities-boot': 1 } },
  'computer.ms-office': { ssc: { word: 3, excel: 3.5, powerpoint: 2, access: 0.5 }, banking: { word: 2.5, excel: 2.5, powerpoint: 1.5, access: 1.5 } },
  'computer.internet-email': { all: { 'web-basics': 2, 'browsing-searching': 1, 'download-upload': 1, email: 2, 'e-banking': 1 } },
  'computer.networking': { all: { types: 1.5, topologies: 1.5, devices: 2, protocols: 2, osi: 1.5, 'ip-addressing': 1, wireless: 1 } },
  'computer.security': { all: { threats: 3, prevention: 2, 'cyber-law': 1 } },
  'computer.number-systems-logic': { all: { conversions: 2, 'logic-gates': 1.5, codes: 1 } },
  'computer.programming-dbms': { all: { languages: 1.5, translators: 1.5, dbms: 2 } },
  'computer.emerging-tech': { all: { cloud: 1, 'ai-ml': 1, iot: 1, blockchain: 0.5, abbreviations: 2 } },

  'stats.data-presentation': { all: { 'primary-secondary': 1, 'collection-methods': 1, tabulation: 1, 'graphs-charts': 1, 'frequency-distributions': 1.5, diagrammatic: 1 } },
  'stats.central-tendency': { all: { 'mean-median-mode': 3, 'partition-values': 2 } },
  'stats.dispersion': { all: { absolute: 3, relative: 1.5 } },
  'stats.moments': { all: { moments: 1.5, 'skewness-kurtosis': 1, measures: 1.5 } },
  'stats.correlation-regression': { all: { scatter: 0.5, correlation: 2, 'regression-lines': 2, spearman: 1.5, attributes: 1, 'multiple-regression': 1, 'multiple-partial': 1 } },
  'stats.probability-theory': { all: { definitions: 1, conditional: 2, compound: 1, independent: 1, bayes: 2 } },
  'stats.random-variables': { all: { 'random-variable': 1.5, 'expectation-variance': 2, 'higher-moments': 1, distributions: 3.5, joint: 1 } },
  'stats.sampling': { all: { 'population-sample': 1, errors: 1, techniques: 2.5, 'sampling-distribution': 1, 'sample-size': 1 } },
  'stats.inference': { all: { estimation: 1.5, 'estimator-properties': 1.5, 'estimation-methods': 1.5, 'hypothesis-testing': 1.5, tests: 3, 'confidence-intervals': 1 } },
  'stats.anova': { all: { 'one-way': 1.5, 'two-way': 1 } },
  'stats.time-series': { all: { components: 1, trend: 1.5, seasonal: 1.5 } },
  'stats.index-numbers': { all: { 'meaning-construction': 1, 'types-formulae': 2, 'base-shifting': 1, 'cost-of-living': 1.5, uses: 0.5 } },
  'accounts.fundamentals': { all: { 'nature-scope': 1, limitations: 0.5, 'concepts-conventions': 2, gaap: 1.5 } },
  'accounts.process': { all: { 'single-double-entry': 1, 'books-original-entry': 1, 'journal-ledger': 2, 'trial-balance': 1.5, 'bank-reconciliation': 2, rectification: 2, 'self-balancing': 0.5 } },
  'accounts.final-accounts': { all: { 'manufacturing-trading': 1.5, 'pl-appropriation': 1.5, 'balance-sheet': 2, 'capital-revenue': 1.5 } },
  'accounts.depreciation-inventory': { all: { depreciation: 2, inventory: 1.5 } },
  'accounts.npo': { all: { npo: 1, 'receipts-payments': 1.5, 'income-expenditure': 1.5 } },
  'econ.cag': { all: { 'constitutional-provisions': 1.5, role: 1.5 } },
  'econ.micro-basics': { all: { 'definition-scope': 1, methods: 1, 'central-problems-ppc': 1.5 } },
  'econ.demand-supply': { all: { demand: 2, 'elasticity-demand': 2.5, 'consumer-behaviour': 2, supply: 1.5, 'elasticity-supply': 1 } },
  'econ.production-cost': { all: { factors: 1, 'variable-proportions': 2, 'returns-to-scale': 2, 'cost-concepts': 1.5 } },
  'econ.market-forms': { all: { 'perfect-competition': 2, monopoly: 2, monopolistic: 1.5, oligopoly: 1.5 } },

  'descriptive.essay': { all: { 'economic-social': 1.5, 'banking-tech': 1.5, 'current-ethics': 1 } },
  'skill.deo-skill-test': { all: { 'part-a': 1, 'part-b': 1 }, basis: 'nominal', note: 'Part A or Part B applies depending on the department; set the applicable one to 100 via custom.' },
  'skill.typing-test': { all: { english: 1, hindi: 1 }, basis: 'nominal', note: 'Only the medium chosen in the application applies; set it to 100 via custom.' },
  'physical.pst': { all: { height: 2, chest: 1.5, weight: 0.5 }, basis: 'nominal' },
  'physical.pet-male': { all: { 'sprint-100m': 1, 'run-1600m': 1.5, 'long-jump': 1, 'high-jump': 1, 'shot-put': 1 }, basis: 'nominal' },
  'physical.pet-female': { all: { 'sprint-100m': 1, 'run-800m': 1.5, 'long-jump': 1, 'high-jump': 1 }, basis: 'nominal' },
  'personality.interview': { all: { 'self-intro': 2, 'banking-economy': 2, 'current-affairs': 1.5, 'situational-hr': 1.5, 'academics-state': 1 } },
  'language-test.local-language': { all: { reading: 1, writing: 1, 'speaking-understanding': 1, 'non-verbal-objective': 15, 'non-verbal-subjective': 15, verbal: 20 }, basis: 'nominal' },
};

/** Section-specific subtopic overrides (take precedence over profiles). */
export const SUBTOPIC_OVERRIDES = {
  'sbi-clerk/llpt/llpt': {
    'language-test.local-language': {
      weights: { 'non-verbal-objective': 15, 'non-verbal-subjective': 15, verbal: 20 },
      basis: 'official-marks', note: 'Official LLPT marks: non-verbal objective 15, non-verbal subjective 15, verbal 20 (total 50).',
    },
  },
};

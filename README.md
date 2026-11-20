# Competitive Exam Syllabus Tracker

Structured syllabus and weightage data for **SSC CGL, SSC CHSL, SSC CPO, SBI PO, SBI Clerk, IBPS PO, IBPS Clerk, IBPS RRB PO and IBPS RRB Clerk**, built from the **2026 official notifications**. There is no UI yet.

- **Phase 1:** syllabus database (sections 1–4)
- **Phase 2:** exam-wise weightage database (section 5)
- **Phase 3:** progress calculation engine: [`docs/PROGRESS_ENGINE.md`](docs/PROGRESS_ENGINE.md) (`src/progress/`, `npm test`, `npm run demo:progress`)

```
data/                         ← SOURCE OF TRUTH (hand-edited)
  registry.json               exam list, categories, status legend
  sources.json                every notification / reference cited
  library/topics.json         canonical topic library (15 subjects, 179 topics, 765 subtopics)
  exams/<exam-id>.json        one file per exam: Stage → Section → topic references
  schema/*.schema.json        JSON Schemas (editor validation)
scripts/build.mjs             validator + resolver + overlap analysis (no dependencies)
dist/                         ← GENERATED (npm run build:data), import this from React
  syllabus.json               fully resolved tree + topic catalogue with coverage
  overlap.json                overlap analysis (machine-readable)
  OVERLAP.md                  overlap analysis (human-readable)
```

## 1. Hierarchy

`Exam → Stage → Section → Topic → Subtopic`

| Level | Example | Defined in |
|---|---|---|
| Exam | `ssc-cgl` | `data/exams/ssc-cgl.json` |
| Stage | `tier2-paper1` (Tier-II Paper-I) | exam file |
| Section | `maths` (Section-I Part A: Mathematical Abilities) | exam file |
| Topic | `quant.percentage` | **library** (referenced by the exam) |
| Subtopic | `quant.percentage.successive-change` | **library** (selected by the exam) |

Stages and sections carry the official pattern: questions, marks, duration, sectional timing, negative marking, qualifying vs merit, `applicableTo` posts, and `choiceGroup` for alternatives (e.g. RRB English *or* Hindi). They also carry a `source` locator (notice + paragraph) and, where the notice has one, the `officialSyllabus` text.

## 2. How common topics are mapped between exams

**Every topic and subtopic is defined once, in `library/topics.json`, with a stable ID.** Exam files never define topics. They only reference library IDs and say which subtopics apply:

```jsonc
// data/exams/ssc-cgl.json → Tier-I → Quantitative Aptitude
{ "topic": "quant.trigonometry", "status": "official",
  "verbatim": ["ratios", "degree-radian", "identities", "complementary"] }

// data/exams/ssc-chsl.json → Tier-I → Quantitative Aptitude (2026 text dropped degree/radian)
{ "topic": "quant.trigonometry", "status": "official",
  "verbatim": ["ratios", "identities", "complementary"],
  "override": { "degree-radian": { "status": "unverified" } } }

// data/exams/sbi-po.json → Prelims → Quantitative Aptitude (banks publish no topic list)
{ "topic": "quant.time-distance", "status": "pyq-derived",
  "only": ["basics", "average-speed", "relative-speed", "meeting-overtaking"] }
```

| Field | Meaning |
|---|---|
| `only` / `exclude` | Which library subtopics this exam includes (default: all). This captures *depth* differences, e.g. banks skip races and circular tracks. |
| `verbatim` | Subtopics named word-for-word in the official text, marked `official`. |
| `override` | Per-subtopic status/note, e.g. `unverified`. |
| `subtopicStatus` | Default status for non-verbatim subtopics, e.g. interview content = `pyq-derived`. |
| `officialLabel` | The exact official wording this topic maps to (e.g. CGL's "General Policy" → `ga.polity`). |

Because overlap comes from **shared IDs**, it is **computed by the build, never hand-maintained**. Each topic and subtopic in `dist/syllabus.json` gets a `coverage` block:

```jsonc
"coverage": {
  "scope": "cross-category",          // universal | cross-category | category-common | exam-specific | unused
  "exams": ["ssc-cgl", "ssc-chsl", "ssc-cpo", "sbi-po", ...],
  "byCategory": { "ssc": [...], "banking": [...] },
  "completeInCategories": ["ssc"],    // used by every exam of these categories
  "statusByExam": { "ssc-cgl": "official", "sbi-po": "pyq-derived", ... }
}
```

| Scope | Rule | Count (topics) |
|---|---|---:|
| `universal` | used by all 9 exams | 48 |
| `cross-category` | SSC **and** banking, but not all 9 | 18 |
| `category-common` | 2+ exams of one category only | 74 |
| `exam-specific` | exactly one exam | 39 |

Scope is computed per **subtopic** too. For example, `quant.time-distance` is universal, but `.races` and `.circular-track` are SSC-only. `related` links connect concepts across subjects (e.g. `quant.statistics` ↔ `stats.central-tendency`, `reasoning.series` ↔ `quant.number-series`). They are hints and are not counted as overlap.

**Progress tracking (Phase 3):** key progress by **subtopic ID**, not by exam. Finishing `quant.percentage.successive-change` once then counts toward all 9 exams automatically.

## 3. Official vs unofficial content

| Status | Meaning |
|---|---|
| `official` | Named in the official notification syllabus text. |
| `official-umbrella` | Not named itself, but covered by an official heading or section name (e.g. *Modern History* under SSC "History"; *RBI* under a "Banking Awareness" section). |
| `pyq-derived` | Not in any official syllabus; included because previous-year papers ask it. **Editorial.** |
| `unverified` | Uncertain or low-frequency; verify before investing time. |

**SBI and IBPS publish only section names, never topic lists.** So every banking topic is `pyq-derived` unless the section name itself names the subject. Descriptive tasks, interview marks and similar items stated in the notices are `official`.

## 4. Sources (all read on 2026-11-15)

| Exam | Notification | Retrieved from |
|---|---|---|
| SSC CGL | Notice CGL 2026 (21-05-2026), Paras 13.8–13.11, 16 | ssc.gov.in |
| SSC CHSL | Notice CHSL 2026 (07-09-2026), Paras 13.8–13.11, 17 | mirror of official PDF |
| SSC CPO | Notice SI in Delhi Police & CAPFs 2026 (10-09-2026), Paras 12, 16 | ssc.gov.in |
| SBI PO | Advt. CRPD/PO/2026-27/09 (18-06-2026) | mirror of official PDF |
| SBI Clerk | Advt. CRPD/CR/2026-27/17 | sbi.bank.in |
| IBPS PO | CRP PO/MT-XVI (30-06-2026) | mirror of official PDF |
| IBPS Clerk | CRP CSA-XVI (31-07-2026) | mirror (ibps.in failed on SSL) |
| IBPS RRB PO/Clerk | CRP RRBs-XV (01-09-2026) | ibps.in |

Full URLs are in `data/sources.json`.

## 5. Phase 2: Weightage database

The weightage layer sits **beside** the syllabus. It references syllabus IDs and never changes them.

```
data/weightage/
  config.json            rules: weighting methods, legends, priority thresholds, merit ratios, validation tolerance
  evidence.json          historical question-trend sources + reported topic counts + known data gaps
  exams/<exam-id>.json   EDITABLE weights: tracks → stages → sections → topics → subtopics
scripts/weightage/estimates.mjs   authoring tables (expected-question ranges, subtopic profiles)
scripts/seed-weightage.mjs        estimates → exams/*.json (keeps existing `custom` values)
scripts/build-weightage.mjs       validation + effective weights + priorities → dist/weightage.json, dist/WEIGHTAGE_REPORT.md
data/schema/weightage.schema.json
```

**Hierarchy and rules.** Every level is relative to its parent and totals 100%:
- **Track:** stage weights. Optional post-specific papers (CGL Paper-II/III) get their own tracks.
- **Stage:** section weights.
- **Section:** topic weights.
- **Topic:** subtopic weights.

`overall % = stage% × section% × topic% (× subtopic%)`.

| Level | How the default is set | Official? |
|---|---|---|
| Stage | Marks share of the track's scored stages. Where the notice gives a merit ratio (IBPS PO / RRB PO 80:20, SBI PO 75:25), that ratio is used. Pass/fail stages are gates (0). | `official-marks` |
| Section | Section marks ÷ stage marks. Choice groups (RRB English/Hindi) count once. Sections without marks are gates (0). | `official-marks` |
| Topic | Expected questions per paper `[min, max]` → midpoint share. Informed by `evidence.json`. | **estimate** (`pyq-` / `proxy-` / `editorial-estimate`) |
| Subtopic | Relative importance profile (SSC or banking variant). | **estimate** (SBI LLPT uses official marks) |

Every weight object stores `default`, `custom`, `basis`, `isOfficial`, `confidence`, `justification`, `evidence` and `lastUpdated` (plus an optional `customNote`). Topics also carry `expectedQuestions`, a `trend` (`consistent`, `fluctuating`, `emerging` or `declining`) and `customPriority`.

**Editing.** Set `custom` (and `customNote`) and keep siblings at 100. Then run `npm run check:weightage`. It reports the exact entry whose siblings no longer total 100. Re-running `npm run seed:weightage` after changing the estimates keeps all custom values.

**Priority** (Very High / High / Medium / Low) is computed per exam from overall weight by cumulative share. The topics forming the top 40% of exam weight are Very High, up to 70% High, and up to 90% Medium. Pass/fail-only topics (PET, DEST, LLPT) are High. `customPriority` overrides the computed value.

## 6. Maintenance

```bash
npm run check:data       # syllabus: validate only (exit 1 on any broken reference)
npm run build:data       # syllabus: validate + regenerate dist/syllabus.json, overlap files
npm run check:weightage  # weightage: validate against the syllabus (sums, coverage, orphans, duplicates)
npm run build            # both layers → dist/ (weightage.json, WEIGHTAGE_REPORT.md included)
npm run seed:weightage   # regenerate weightage defaults from scripts/weightage/estimates.mjs (keeps custom values)
npm test                 # build both layers, then run the progress-engine test suite
npm run demo:progress    # worked example on real data → examples/progress-sample/
```

- **New exam** (e.g. RRB NTPC): add a category in `registry.json` if needed, create `data/exams/<id>.json` reusing library IDs, add new topics to the library only when nothing existing fits, then run the build. Overlap with all existing exams appears automatically.
- **New notification cycle:** update the exam file's `cycle`, `lastVerified`, pattern numbers and statuses, add the new source to `sources.json`, then rebuild and compare `dist/OVERLAP.md`.
- The build fails on unknown topics/subtopics/sources, duplicate IDs, or invalid statuses. It warns when section totals don't match the stage pattern and when library topics are unused.

# Progress Calculation Engine (Phase 3)

The engine is framework-agnostic ES modules in `src/progress/`, with no dependencies, running in Node 22+ and the browser. It reads the Phase 1 syllabus and Phase 2 weightage **without modifying them**, and keeps all user data in four separate collections.

```
src/progress/
  config.js       scoring config compiler + date/ID helpers
  model.js        joins syllabus structure + weightage → normalised weight tree per exam/track
  mastery.js      practice aggregation + mastery score
  calculate.js    pure calculation: completion, mastery, rollups, analytics
  progress-db.js  progress data model + pure (immutable) update functions
  storage.js      MemoryStorage, WebStorageAdapter (localStorage), load/save
  engine.js       ProgressEngine: exam switching, auto-recalculation, auto-save, subscriptions
  node.js         Node only: FileStorage (atomic JSON files), dist/ loader, default config
data/progress/config.json        scoring configuration (statuses, mastery weights, thresholds)
data/schema/progress.schema.json JSON Schema of the four user-data collections
test/progress/*.test.mjs         71 automated tests (node:test)
scripts/progress-demo.mjs        worked example on real data → examples/progress-sample/
```

## 1. Formulas

### Weights (from Phase 2, re-normalised at run time)
Every sibling group is normalised to sum to 1. Custom weights therefore never need to total 100, and results can't leave the 0–100 range.

```
stageW   = stage weight in the selected track          (gate stages = 0)
sectionW = section weight in its stage                  (gate sections and unchosen choice-group alternatives = 0)
topicW   = topic weight in its section
subW     = subtopic weight in its topic

effective weight of a leaf      = stageW × sectionW × topicW × subW
effective weight of a topic (%) = Σ over its occurrences (stageW × sectionW × topicW) × 100
```
Example: a topic that is 20% of a section, in a section that is 30% of the exam, has an effective weight of 0.2 × 0.3 = **6%**.

### A. Syllabus completion
```
status score:  not-started 0 · learning 20 · concept-completed 50 · practicing 65 · revision-pending 75 · completed 90 · mastered 100
               (configurable in data/progress/config.json)

completion(subtopic) = own exam status score
                       (own subtopic status → else the topic's status → else not-started; a completionOverride replaces it)
                       raised to min(shared conceptual score, 50) when shared learning is enabled
completion(topic)    = Σ subW × completion(subtopic)
completion(section)  = Σ topicW × completion(topic)
completion(stage)    = Σ sectionW × completion(section)
completion(exam)     = Σ stageW × completion(stage)
                     = Σ (topic effective weight × topic completion score)   ← the requested formula
```
**No double counting:** progress is scored only at subtopic (leaf) level. A topic status is the *default* for its subtopics, never an extra amount added on top. A topic that appears in two stages (e.g. CGL Tier-I and Tier-II quant) has two separate weight portions that together still sum to its exam share.

**Scope:** `stageId = null` covers the whole exam (track weights). A stage ID covers only that stage, which is then 100%. The selected stage is stored per exam (`setStage`).

### B. Exam mastery (independent of completion)
```
mastery = (wC·concept + wA·accuracy + wK·consistency + wR·revision + wS·speed) / (wC+wA+wK+wR+wS)
          default weights 0.25 / 0.40 / 0.20 / 0.15 / 0 (speed off)

concept     = conceptScoreByStatus[own exam status]   (not-started 0, learning 40, concept-completed and above 100)
accuracy    = min(100, Σ correct × difficultyMultiplier / Σ attempted × 100) × √(min(1, attempted / target))
              multipliers easy 0.85 · medium 1 · hard 1.15; target 50 questions (topic) / 20 (subtopic)
consistency = 100 × (0.6 × min(1, practiceSets / target) + 0.4 × recency)
              target 6 sets (topic) / 3 (subtopic); recency 1 within 7 days, linear down to 0 at 60 days
revision    = 100 × min(1, revisions / 3) × revisionPerformance
              (accuracy on revision sessions; 0.8 when revisions were logged without questions)
speed       = 100 if avg time ≤ 60 s/Q, 0 at 3× that, linear between
```
- **Completion ≠ mastery.** A topic marked *Mastered* with no practice scores at most 25 (concept only) and is labelled `not-assessed`. A topic counts as *mastered* in analytics only with mastery ≥ 80 **and** at least 20 questions attempted.
- **Rollup.** Topic mastery uses all practice in the topic's subtree (each session counted once). It rolls up to section, stage and exam with the same weights as completion.
- **Concept source.** By default (`exam-only`), mastery uses the exam's own status, so shared learning never changes another exam's mastery.

### Analytics
| Output | Rule |
|---|---|
| Completed / in progress / pending | topic completion ≥ 90 / > 0 / = 0 |
| Mastered topics | mastery ≥ 80 and ≥ 20 questions attempted (or a manual mastery override) |
| Remaining weighted syllabus | 100 − completion; per topic `remaining = weight × (100 − completion)` |
| High-weightage incomplete | priority Very High/High (Phase 2), completion < 90, sorted by remaining weighted gap |
| Gates | pass/fail sections (DEST, typing, PST/PET, LLPT) with their completion, outside the weighted total |

## 2. Data model

User data lives in four collections. Each is stored under its own key/file, so one can't corrupt another. All records use stable library IDs: topic `quant.percentage`, subtopic `quant.percentage.successive-change`.

| Collection | Contents | Keyed by |
|---|---|---|
| `progress` | per-exam status, overrides, difficulty, notes, dates, sharing flag, manual revision log, manual totals; per-exam settings (track, stage scope, language choice) | `exams[examId].topics[topicId]` / `.subtopics[subtopicId]` |
| `sharedLearning` | conceptual status shared across exams (max *Concept Completed*), only ever increases | `topics[topicId]` / `subtopics[subtopicId]` |
| `practice` | practice sessions: attempted, correct, incorrect, time, difficulty, set, revision, date | `exams[examId].sessions[]` (session `id`, `nodeId`) |
| `weightOverrides` | user custom weights (weightage layer, kept out of progress) | `exams[examId]["section:tier1/quant"]` etc. |

Every topic and subtopic record (`createNodeRecord`) has these fields. Each one can be updated on its own:

```jsonc
{
  "status": "practicing",          // current status
  "completionOverride": null,      // manual syllabus-completion score (0–100)
  "masteryOverride": null,         // manual mastery score (0–100)
  "difficulty": "hard",            // exam-specific target difficulty
  "notes": "",                     // personal notes
  "startDate": "2026-11-02",       // auto-set when work starts
  "completionDate": null,          // auto-set at ≥ Completed, cleared if it drops back
  "lastUpdated": "2026-11-20T09:00:00.000Z",
  "shareLearning": true,           // false = this exam neither reads nor writes shared learning for the node
  "revisions": [{ "date": "2026-11-12", "note": "formula sheet" }],
  "manualStats": null              // directly-set totals (questions attempted/correct, sets, revisions…)
}
```
The report computes the remaining per-node fields: completion score, mastery score and components, attempted, correct, incorrect, accuracy, practice sets, average time, revision count, last practised, and effective status with its source (`subtopic`, `topic`, `override`, `shared` or `default`).

Samples: `examples/progress-sample/*.json`. Schema: `data/schema/progress.schema.json`.

## 3. Shared vs exam-specific progress
- **Shared (conceptual learning):** whenever a status changes in any exam, its conceptual part (capped at *Concept Completed* = 50) is merged into `sharedLearning` under the library ID. Every exam containing that topic or subtopic then shows at least that completion. The stored value only ever increases; `setSharedStatus` can reset it explicitly.
- **Exam-specific (preparation):** practising, revision, completion and mastery levels; practice records; difficulty; notes; dates. These are never copied between exams.
- **Opt-out:** `setShareLearning(topicId, false)` turns sharing off per topic per exam, and `setSharedLearningEnabled(false)` turns it off globally.

Worked example from the demo: SBI PO "Data Interpretation → Practicing" shares *Concept Completed* to SSC CGL. CGL DI then shows 50% completion (source `shared`), which adds 50% × 2.32% = **+1.16 points** to CGL completion. CGL's own records and DI mastery (0%) are unchanged.

## 4. Integration with the existing databases
```
data/library + data/exams ──build.mjs──▶ dist/syllabus.json ─┐
data/weightage ───build-weightage.mjs──▶ dist/weightage/<exam>.json ─┤
                                                         loader.loadExam(examId)
                                                                 ▼
user weightOverrides ──────────────────────▶ buildExamModel()  (normalised weight tree, per track/choice)
progress + sharedLearning + practice ──────▶ calculateProgress() ──▶ report (summary, stages, sections, topics, subtopics, analytics)
```
- **Phase 1 syllabus** is the structural source of truth. Topics missing from the weightage get the mean weight of their siblings (with a warning); stale weightage entries are ignored.
- **Phase 2 weightage** supplies relative weights (`weight.effective`, which includes Phase 2 `custom` values), tracks, gates and priorities. Editing weightage, or setting an in-app override, re-normalises the weights and recalculates.
- **Common-topic mapping** (Phase 1 library IDs) is what shared learning keys on.

### Usage
```js
import { ProgressEngine, WebStorageAdapter } from './src/progress/index.js';
const engine = await new ProgressEngine({ loader, storage: new WebStorageAdapter(localStorage), config }).init();
await engine.switchExam('ssc-cgl');                       // loads syllabus + weightage + this exam's progress
engine.setStatus('quant.percentage', 'mastered');         // topic or subtopic id
engine.recordPractice('quant.percentage', { attempted: 20, correct: 17, difficulty: 'medium', timeSeconds: 1100 });
engine.updateTopic('quant.percentage', { notes: 'shortcuts', difficulty: 'hard' });
engine.setStage('tier1');                                 // scope (null = whole exam)
const report = engine.getReport();                        // recalculated automatically after every change
engine.subscribe(() => {/* React: useSyncExternalStore(engine.subscribe.bind(engine), () => engine.getVersion()) */});
```
In the browser, `loader` is any object with `loadExam(examId) → { syllabusExam, weightageExam }`, e.g. `fetch('/dist/weightage/ssc-cgl.json')`.

## 5. Example calculations (real data, `npm run demo:progress`, clock 2026-11-20)

| SSC CGL topic | Effective weight | × completion | = points | Mastery |
|---|---:|---:|---:|---:|
| Percentage (Mastered + 60 Q practice) | 0.70% (Tier-I 0.3523 + Tier-II 0.3462) | 100% | 0.70 | 87.13 (mastered) |
| Algebraic Identities (Concept Completed) | 1.74% | 50% | 0.87 | 25.00 (not-assessed) |
| Reading Comprehension (Practicing + 30 Q) | 5.91% | 65% | 3.84 | 59.79 (developing) |
| Trigonometry (one subtopic Mastered) | 1.86% | 26.09% | 0.48 | 6.52 |
| Modern History (Learning) | 1.04% | 20% | 0.21 | 10.00 |
| **Exam total** | | | **6.10%** | **4.80%** |

Percentage mastery: concept 100, accuracy 90.33 (53/60 with one hard set), consistency 90 (5 of 6 sets, practised yesterday), revision 53.33 (2 revisions out of a target of 3, revision accuracy 80%), giving **87.13**. In SBI PO the same topic shows **50% completion (shared), 0 mastery, 0 questions**.

## 6. Test cases and expected outputs (`npm test`)
Fixture `SIMPLE`: one stage with secA (30%: Percentage 20% [a 50, b 50], Average 80%), secB (70%: Cloze 100%), and secG (gate: DEST).

| # | Case | Input | Expected |
|---|---|---|---|
| 1 | Not Started contributes 0 | Percentage = not-started | overall **0.00**, contribution 0, category pending |
| 2 | Mastered = full effective weight | Percentage = mastered | weight **6.00**, overall **6.00**, remaining 94.00 |
| 3 | Partial completion | Percentage = concept-completed; + Average = practicing | **3.00**; then **18.60** (secA = 62.00) |
| 3c | Subtopic-level | Percentage.a = mastered only | topic 50.00 → overall **3.00** |
| 4 | No double counting | topic completed + sub a mastered; then topic + both subs mastered | **95.00 → 5.70**; **6.00** (not 12), leaf sum = rollup |
| – | Stage scope (MULTI) | Puzzles mastered (prelims 20% + mains 36%) | exam **56**, prelims **50**, mains **60** |
| 5 | Exam switching | updates in 3 exams, switch back | first exam's records deep-equal; report identical |
| 6 | Weight change | secA 30→60 (of 130); topic 20→40 | **9.23**; **12.00** |
| 7 | Shared ≠ mastery | A: Percentage mastered + 40 Q → B | B completion **50 (shared)**, B mastery **0**, B attempted **0**; disabling sharing → **0** |
| 8 | Missing topics | orphan records, orphan session, unknown status, weightage missing a topic, no weightage, empty db | no error; orphans reported; sibling-mean fallback → **15.00** |
| 9 | Bounds | 450 random scenarios on fixtures, plus real-data fuzz on CGL and SBI PO | every percentage within 0–100, finite; rollup = leaf sum |
| 10 | Reload | file and localStorage round-trip; corrupted file; malformed records | identical report after reload; only the corrupt collection resets (backup kept) |
| – | Mastery formula | 50 Q / 45 correct, 6 sets today, 3 revisions w/o scores | components 100/90/100/80 → **93.00** |
| – | Completion ≠ mastery | Mastered, no practice | completion 100, mastery **25**, level not-assessed, not counted as mastered |
| – | All 9 exams, every track | nothing / every topic Mastered | **0** / **100** in every stage; topic weights sum to **100** |

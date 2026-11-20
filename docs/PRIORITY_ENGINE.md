# Phase 5: Smart preparation priority engine

The planner answers "what should I study next, and what should today look like?" for one or more target exams. It reads the existing modules and does not rebuild them:

- the syllabus (Phase 1)
- weightage, history trend and confidence (Phase 2)
- syllabus completion and exam mastery (Phase 3)
- common topic mapping, exam-level requirements and shared concepts (Phase 4)

| Module | File | Role |
|---|---|---|
| Configuration | [`data/planner/config.json`](../data/planner/config.json), [`src/planner/config.js`](../src/planner/config.js) | Default weights, thresholds, intervals and minutes; validation of user overrides |
| Priority scoring | [`src/planner/priority.js`](../src/planner/priority.js) | Per-exam score, multi-exam combination, next action, reasons |
| Revision engine | [`src/planner/revision.js`](../src/planner/revision.js) | Spaced-repetition schedule and overdue detection |
| Weak-area detection | [`src/planner/weak-areas.js`](../src/planner/weak-areas.js) | Weakness category, flags and weakest sections per exam |
| Daily plan | [`src/planner/daily-plan.js`](../src/planner/daily-plan.js) | Time-budgeted task list that keeps the user's edits |
| Insights | [`src/planner/insights.js`](../src/planner/insights.js) | Untouched high-weight topics, backlog, declining accuracy, shared-learning savings |
| Facade | [`src/planner/planner.js`](../src/planner/planner.js) | `StudyPlanner`: user controls, persistence, task completion through the progress engine |
| Schema | [`data/schema/planner.schema.json`](../data/schema/planner.schema.json) | Planner collection and config |

```bash
npm test                 # all phases (planner tests: test/planner/)
npm run test:planner     # planner only
npm run demo:planner     # worked example → examples/planner/
```

## 1. Ground rules

- **Progress records are read, never edited by the planner.** It reads `engine.getCrossExamReports()` and `engine.getExamSessions()`. It writes progress only when *you* complete a task with an outcome, and then only through the progress engine's methods (`updateTopic`, `recordPractice`, `addRevision`, `updateConcept`).
- **The planner has its own collection.** It is stored under the key `planner`: settings, dismissals and daily plans. Dismissing, re-planning or deleting planner data never touches `progress`, `practice` or `sharedLearning`.
- **Exam-wise records are never mixed.** Each target exam is scored from its own report and practice sessions. Only the final ranking combines them.
- **Nothing is automatic that the user did not do.**
  - Tasks are completed only by `completeTask`.
  - A topic counts as revised only after a confirmed revision (`addRevision`) or a practice session recorded with `revision: true`.
  - A status change alone never counts as a revision.
- **Labels follow Phase 2.** A topic's weight and history trend come from Phase 2, so for most topics they are *estimates* (PYQ/proxy/editorial). Each recommendation carries `weightageConfidence` through the report.

## 2. Priority formula

For each target exam *e* and each in-scope topic *t*, every factor is in the range 0–1:

| Symbol | Factor | Definition | Source |
|---|---|---|---|
| I | importance (weightage) | √(effectiveWeight / heaviest topic weight in *e*); gate-only topics (qualifying papers, weight 0) use `gateTopicImportance` = 0.3 | Phase 2 effective weight |
| F | historical frequency | `trendScore[trend]`: consistent 1, emerging 0.9, fluctuating 0.6, declining 0.4, not-applicable/unknown 0.5 | Phase 2 `topicSummary.trend` |
| I′ | adjusted importance | I × (0.7 + 0.3 F) | |
| G | learning gap | 1 − completion/100 | Phase 3 syllabus completion (incl. Phase 4 shared concept uplift) |
| M | mastery gap | 1 − mastery/100 | Phase 3 exam mastery (exam-specific) |
| U₀ | untouched | 1 if completion = 0, else 0 | |
| R | revision due | overdue: min(1, 0.5 + 0.5 × daysOverdue / interval); due today 0.5; due soon 0.25; otherwise 0 | Revision engine (§5) |
| A | accuracy gap | max(0, (target − recent accuracy) / target), only when the last 3 sessions hold ≥ 10 questions | Practice sessions; Phase 4 accuracy target |
| D | difficulty | `difficultyScore`: easy 0.3, medium 0.6, hard 1, unknown 0.5 | Phase 4 exam-specific difficulty |

```
score_e = 100 × ( wL·I′·G + wM·I′·M + wU·I′·U₀ + wR·R·(0.5 + 0.5·I′) + wA·I′·A + wD·D·max(G, M) ) / Σw
```

Default weights: learningGap 0.30, masteryGap 0.20, untouched 0.10, revisionDue 0.20, accuracyGap 0.10, difficulty 0.05.

Each term in the formula has a specific purpose:

- **Gap terms are scaled by I′.** A big gap matters more in a heavy topic.
- **Revision keeps a floor.** Revision is scaled by (0.5 + 0.5 I′), so a light topic that is overdue still surfaces.
- **Difficulty only counts with work left.** It is multiplied by max(G, M), so hard topics already mastered do not stay on top.

**Range.** Every factor and every multiplier is in [0, 1], so the score is in [0, 100] for any non-negative weights. The result is also clamped to that range, and a fuzz test checks 3,000 random inputs and weight sets.

**Time remaining.** In the final stretch (≤ 30 days to an exam's date):
- the revision weight is multiplied by 1.5;
- for minor topics (I < 0.5) the untouched weight is multiplied by 0.5, so the plan consolidates instead of starting low-value topics.

**Exclusion.** A topic with completion ≥ 90 and mastery ≥ 90 and no revision due is marked `done` and not recommended.

### Multiple exams, without multi-exam inflation

```
urgency_e = clamp(1 − daysLeft_e / 180, 0, 1)      (0 when no exam date; a past exam gets share 0 and a warning)
share_e   = importance_e × (1 + urgency_e) / Σ_exams (…)
combined  = Σ_e share_e × score_e                   (score_e = 0 when the topic is not in exam e)
```

The combined score is a **share-weighted average, not a sum**. Two consequences follow:
- A topic can never score above its best per-exam score.
- Appearing in many exams helps only in proportion to the topic's real weight in each exam. Static GK, which is light in both CGL and SBI PO, stays below Puzzles, which is heavy in SBI PO only. Data Interpretation, which is heavy in both, rises to the top.

The recommendation names the exam that contributes most (`relevantExam`), and lists every exam with its share, score and contribution (`relevantExams`).

### Classification

| Class | Score | Meaning |
|---|---|---|
| Critical | ≥ 45 | Act now: heavy and untouched, or heavily overdue |
| High | ≥ 30 | Should be in this week's plan |
| Medium | ≥ 15 | Schedule after the above |
| Low | < 15 | Light, or already well prepared |

The weights, thresholds, trend and difficulty scores, final-stretch factors and horizon are configurable through `planner.setConfigOverrides({...})`. Overrides are deep-merged onto the defaults and validated:
- weights must be ≥ 0 with a sum > 0;
- thresholds must decrease, with Low = 0;
- scores must be in [0, 1];
- intervals must be integers from 1 to 3650.

An invalid override is rejected and nothing is saved.

### Explanation

`planner.explain(topicId)` returns, for every exam:
- the share, score, contribution and arithmetic (`0.48 × 57.98 = 27.88`);
- the factor values;
- the points each term contributed, which sum to the score;
- the context (trend, difficulty, target, final stretch);
- the reasons.

Reasons are generated from the three largest contributions. For example: "High weightage (9.94% of SBI PO) with 0% syllabus completion", "Revision overdue by 7 day(s)", or "Recent accuracy 43% vs target 80%".

## 3. Next action

For each topic and exam, the first matching rule wins:

| # | Condition | Action |
|---|---|---|
| 1 | Revision overdue or due today | `revise-notes` |
| 2 | Completion 0, or < 50 | `learn-concept` |
| 3 | Some subtopics < 50% and topic not done | `complete-subtopics` (lists them) |
| 4 | Questions attempted < Phase 4 question target | `practice-questions` (count, accuracy and speed targets) |
| 5 | Targets met = false (accuracy or speed gap) | `practice-questions` (the gaps to close) |
| 6 | Mastery ≥ 65 | `sectional-test` |
| 7 | Otherwise | `practice-questions` |

`mock-test` is an exam-level recommendation (`examRecommendations`). It applies when:
- syllabus completion is ≥ 50%, or the exam is ≤ 45 days away with completion ≥ 30%;
- and no mock was completed for that exam in the last 7 days.

Because the shared concept is learned once (Phase 4), a topic whose concept is complete in one exam is recommended as `practice-questions` in the other, not `learn-concept` again.

## 4. Recommendation record

Each record contains these fields:
- `rank`, `topicId`, `name`, `subject`, `masterTopicId`
- `priorityScore`, `classification`
- `relevantExam {examId, name}`, `section`, `topicWeightage`
- `syllabusCompletion`, `examMastery`
- `reasons[]`, `suggestedAction {action, label, detail}`
- `relevantExams[]`: per exam, `{share, score, contribution, section, topicWeightage, syllabusCompletion, examMastery, action, revisionStatus}`

There is one record per topic, and dismissed topics are excluded (see §9).

## 5. Revision engine

Inputs are per exam:
- completion, last practised date, last revision date, revision count, completion and start dates;
- previous and recent test accuracy, and mastery.

| Item | Rule |
|---|---|
| Studied | own completion ≥ 50, or any practice or revision recorded; otherwise `not-studied` and not scheduled |
| Last studied | latest of lastPracticed, lastRevised, completionDate, startDate |
| Next due | (lastRevised, or else lastStudied) + intervals[min(revisionCount, n − 1)]; default intervals **1, 3, 7, 15, 30** days, then 30 repeatedly |
| Low accuracy | previous test accuracy < 60% → the interval is halved (7 → 4) |
| Status | `overdue` (with `daysOverdue`), `due-today`, `due-soon` (≤ 2 days), `scheduled` |
| Counts as revised | `engine.addRevision(...)` (manual confirmation) or `recordPractice(..., { revision: true })` (a completed revision session); never a status change |

Intervals are editable with `planner.setRevisionIntervals([1, 2, 5])`. `getRevisionTracker()` lists every studied topic per exam with the fields `lastStudied`, `lastRevised`, `revisionCount`, `previousAccuracy`, `mastery`, `nextDue`, `status` and `daysOverdue`.

## 6. Weak-area detection

Detection runs per exam on that exam's own sessions. Thresholds are in `weakAreas` in the config.

| Category | Rule (first match) |
|---|---|
| `not-studied` | completion 0 and no questions |
| `studied-but-weak` | ≥ 10 questions and: accuracy < 60%, **or** accuracy over the last 3 sessions < 60% (with ≥ 10 recent questions), **or** mastery < 40 |
| `good-concept-poor-speed` | completion ≥ 50, accuracy ≥ target − 5, average time > speed target × 1.15 |
| `good-accuracy-insufficient-practice` | accuracy ≥ target but attempted < 50% of the question target |
| `below-target` | ≥ 10 questions, not weak, accuracy below target − 5 |
| `studied-not-practised` | some completion, no questions |
| `ok` | none of the above |

There are also four flags:
- `slow`
- `repeated-incorrect`: ≥ 15 wrong answers in the recent sessions while below target
- `needs-repeated-revision`: ≥ 3 revisions with mastery still < 50
- `declining-accuracy`: the recent sessions are ≥ 10 points below the earlier ones

A weakness score ranks the weak topics. It combines the accuracy gap, mastery gap, slowness and flags, scaled by importance.

`getWeakAreas()[examId]` returns `weakTopics`, the five `weakestSections` (lowest mastery, then highest weight), `categories` and `all`.

## 7. Daily study plan

The time budget is hours × 60. The hours come from the call, the user setting, or the default of 4. The plan is filled in this order:

1. **Revisions first.** Overdue and due-today topics, by priority, up to 40% of the budget.
2. **One mock test**, when an exam is mock-ready (§3).
3. **Topics by combined priority**, each with its next action.

Constraints:
- one task per topic per day;
- at most 3 tasks per subject and at most 10 tasks;
- each task must fit in the time left.

Minutes per task are configurable:

| Action | Minutes |
|---|---|
| learn-concept | 40 / 60 / 90 (easy / medium / hard) |
| complete-subtopics | 20 per pending subtopic, max 90 |
| practice-questions | 20 questions × speed target × 1.5, clamped to 20–60 |
| revise-notes | 15 / 20 / 30 |
| sectional-test | 30 |
| mock-test | 120 |

User edits:
- `addTask`, `removeTask` and `reorderTasks` are saved with the plan.
- On regeneration, manual and completed tasks are kept.
- Removed topics are not re-added, and the custom order is kept.

`completeTask(date, taskId, { outcome })` marks a task done. Without an outcome, no progress changes. With one, it is applied through the progress engine for the task's exam:

| Outcome field | Engine call |
|---|---|
| `status` | `engine.updateTopic` |
| `practice` | `engine.recordPractice` |
| `revision` | `engine.addRevision` |
| `concept` | `engine.updateConcept`, applied once |

`progressUpdates` records the calls that were made. `reopenTask` clears only the completed mark.

## 8. Insights

`getInsights()` returns:
- `untouchedHighWeight`: Phase 2 Very High or High topics at 0% completion
- `commonAcrossTargets`: topics ranked by share-weighted weight
- `lowestMasterySections`
- `revisionBacklog`: overdue, due today and due soon, plus the oldest overdue topics
- `decliningAccuracy`: earlier vs recent accuracy
- `morePracticeWouldHelp`: insufficient practice, poor speed, below target, or not practised
- `sharedLearningSavings`: concept repetitions avoided, from Phase 4; no hours are claimed, because there is no reliable data for them

## 9. User controls

| Control | API |
|---|---|
| Select target exams, importance, dates | `setTargets([{ examId, importance (0,100], examDate }])` |
| Change exam priority | `setExamImportance('ssc-cgl', 60)` |
| Set exam date | `setExamDate('sbi-po', '2027-03-10')` (null clears it) |
| Daily hours | `setDailyHours(3.5)`, or per plan `generateDailyPlan(date, { hours })` |
| Scoring configuration | `setConfigOverrides({ priority: { weights: {...}, classification: { thresholds: {...} } } })` |
| Revision intervals | `setRevisionIntervals([1, 3, 7, 15, 30])` |
| Dismiss a recommendation | `dismissRecommendation(topicId, { examId?, until?, reason })` and `undismissRecommendation(...)` |
| Edit the plan | `addTask`, `removeTask`, `reorderTasks` |
| Complete a task manually | `completeTask(date, taskId, { outcome?, note })`, `reopenTask` |

Dismissal works at two levels:
- Without `examId`, the topic is hidden for all exams.
- With `examId`, only that exam's contribution is removed, and the rest is re-scored and re-ranked.

An `until` date makes the dismissal expire. Dismissal never touches progress.

## 10. Data structures

The planner collection, stored under the key `planner` and validated by `planner.schema.json`:

```json
{
  "schemaVersion": 1, "kind": "planner", "updatedAt": "2026-11-20T09:00:00.000Z",
  "settings": {
    "targets": [{ "examId": "ssc-cgl", "importance": 60, "examDate": "2027-06-15" }, { "examId": "sbi-po", "importance": 40, "examDate": "2027-03-10" }],
    "dailyHours": 3.5,
    "configOverrides": {}
  },
  "dismissed": { "ga.current-affairs@ssc-cgl": { "topicId": "ga.current-affairs", "examId": "ssc-cgl", "until": null, "reason": "…", "dismissedAt": "…" } },
  "plans": { "2026-11-20": { "date": "2026-11-20", "hours": 3.5, "budgetMinutes": 210, "plannedMinutes": 200, "tasks": ["…"], "removed": ["…"], "customOrder": null } }
}
```

Task fields:
- `taskId`, `kind` (topic or exam), `topicId`, `name`, `subject`
- `examIds`, `primaryExamId`, `section`
- `action`, `detail`, `minutes`
- `priorityScore`, `classification`, `reason`
- `source` (auto or manual), `status` (pending or completed), `order`
- set on completion: `completedAt`, `note`, `progressUpdates[]`

## 11. Worked example (`npm run demo:planner`)

The scenario simulates three weeks of preparation, with a fixed clock and the real data:
- **Targets:** CGL (importance 60, exam on 2027-06-15) and SBI PO (importance 40, exam on 2027-03-10), studying 3.5 h/day.
- **Practice so far:** Percentage, Ratio and Coding–Decoding in CGL; Simplification, Percentage and a declining Seating Arrangement in SBI PO.
- **Dismissal:** Current Affairs is dismissed for CGL only.

On 2026-11-20 the shares are CGL 51.9% and SBI PO 48.1%. SBI PO is 110 days away (urgency 0.39), which lifts its 40% importance.

```
 #  Score  Class     Topic                       Exam     Wt    Compl  Mast   Action
 1   48.7  Critical  Data Interpretation         SBI PO   9.94     0%    0%  learn-concept
      ↳ High weightage (9.94% of SBI PO) with 0% syllabus completion · No SBI PO practice yet (mastery 0%)
 2   44.0  High      Cloze Test                  SSC CGL  3.79     0%    0%  learn-concept
 3   42.7  High      Reading Comprehension       SSC CGL  5.91    20%    0%  learn-concept
 8   28.3  Medium    Seating Arrangement         SBI PO   4.40    65%   70%  revise-notes
      ↳ Revision overdue by 1 day(s) · High weightage (4.4% of SBI PO) with 65% syllabus completion
11   26.0  Medium    Coding–Decoding             SSC CGL  2.40    65%   52%  revise-notes
      ↳ Revision overdue by 7 day(s) · High weightage (2.4% of SSC CGL) with 65% syllabus completion

Why "Data Interpretation" scored 48.69 (Critical)
  ssc-cgl: 0.52 × 40.09 = 20.82   learningGap 17.4, masteryGap 11.6, untouched 5.8, difficulty 5.3
  sbi-po:  0.48 × 57.98 = 27.88   learningGap 26.4, masteryGap 17.6, untouched 8.8, difficulty 5.3
  (SBI PO: I = 0.948, trend fluctuating → F = 0.6, I′ = 0.835, hard → D = 1)

Weak areas
  sbi-po: Seating Arrangement [studied-but-weak; slow, repeated-incorrect, declining-accuracy 80% → 43%]
          Simplification & Approximation [good-concept-poor-speed]
  ssc-cgl: Coding–Decoding [studied-but-weak; repeated-incorrect], Ratio & Proportion [good-accuracy-insufficient-practice]

Daily plan 2026-11-20: 200/210 min
  1. [completed]  20 min  revise-notes   Synonyms, Antonyms & Homonyms (manual) → engine.addRevision
  2. [pending]    30 min  revise-notes   Seating Arrangement (sbi-po)
  3. [pending]    30 min  revise-notes   Coding–Decoding (ssc-cgl)
  4. [pending]    90 min  learn-concept  Data Interpretation (ssc-cgl+sbi-po)
  5. [pending]    30 min  revise-notes   Percentage (ssc-cgl+sbi-po)
```

The full outputs are in [`examples/planner/`](../examples/planner/): `recommendations.json`, `explain-quant.data-interpretation.json`, `revision-tracker.json`, `weak-areas.json`, `daily-plan.json`, `insights.json`, and `store/` (all collections, including `planner.json`).

The Personal Interview stage carries its Phase 2 weight in SBI PO, so it appears as a Medium learn-concept item. A learner who wants to defer it can dismiss it until a date.

## 12. Tests (`test/planner/`)

| Requirement | Test | Expected |
|---|---|---|
| High-weightage incomplete topics rank higher | scoring 1, planner 1 | RC (5.9%) > Percentage; RC's score drops once completed |
| Low mastery increases priority | scoring 2, planner 2 | 12/40 correct outranks 38/40 at the same completion |
| Overdue revisions identified | scoring 3, revision tests, planner 3 | Studied 11-10 → due 11-11 → overdue 9 days on 11-20; a status change does not count; `addRevision` or a revision session does; intervals 3/7/15/30 then 30; edited intervals apply; low accuracy halves the interval |
| Common topics considered appropriately | planner 4 | combined = Σ share × score ≤ best exam score; Puzzles (SBI-only, heavy) > Static GK (both, light) |
| Exam priorities influence recommendations | planner 5 | Puzzles ranks higher at SBI 90%, Geometry higher at CGL 90% |
| Study hours adjust the plan | scoring 12, planner 6 | 1 h → 1 task, 4 h → 4; 1.5 h < 6 h in tasks and minutes; 0 h → empty |
| Task completion only through the progress engine | planner 7 | No outcome → progress, practice and shared records byte-identical; with an outcome → `engine.updateTopic` and `engine.recordPractice`, visible in the exam report; other tasks stay pending |
| Dismissal does not erase progress | planner 8 | Records identical, status kept; exam-specific dismissal removes one exam; `until` expires |
| Scores within range | scoring 9 (fuzz, 3,000 cases), planner 9 (all 9 exams, random progress) | 0 ≤ score ≤ 100, valid class, shares sum to 1 |
| No duplicate topics | planner 10 | Unique topics in recommendations and plans; manual tasks, removals and order survive regeneration |
| Weak-area categories | planner weak-area test | weak, poor speed, insufficient practice, not studied, below target, declining → weak on recent sessions |
| Persistence and controls | planner last test | Settings, plans, overrides and dismissals reload; nothing is written to `progress`; invalid exam or hours rejected |

There are 28 planner tests. They run alongside the Phase 1–4 suites in `npm test`.

# Common Syllabus Mapping & Smart Progress Synchronization (Phase 4)

Phase 4 adds a master topic database, a cross-exam mapping and controlled synchronization of conceptual learning between exams. It builds on the existing databases: the syllabus, weightage and Phase 3 progress records are **not recreated, replaced or rewritten**.

```
data/mapping/config.json              rules: similarity thresholds, default sync per level, stage classes, requirement profiles
data/mapping/overrides.json           MANUAL edits (verification, sync mode, requirements, exclusions, related links)
data/mapping/master-topics.json       GENERATED master topic database (140 masters)
data/mapping/cross-exam-mapping.json  GENERATED mapping (1,333 exam mappings, per-exam requirements, review list)
data/schema/mapping.schema.json       schema for the three mapping files
src/mapping/build.js                  mapping generator (pure); scripts/build-mapping.mjs = CLI (+ --check)
src/mapping/insights.js               shared-topic dashboard + cross-exam insights (pure)
src/progress/*                        engine integration (sync modes, concept records, requirements)
test/mapping/*.test.mjs               23 tests; test/fixtures/phase3-progress = frozen Phase 3 data
scripts/sync-demo.mjs                 worked example → examples/common-mapping/
```

## 1. Master topic database
A **master topic** is one canonical Phase 1 library topic that two or more exams use. Its ID is `mt.<libraryTopicId>`, e.g. `mt.quant.percentage`.
- Identity comes **only from stable IDs**. Names are never matched: *Cloze Test* (English) and *Cloze Test (रिक्त स्थान गद्यांश)* (Hindi) stay separate masters.
- Concepts that are related but different are linked, never merged or synced: `relatedMasterTopics` with `sync: "never"` and `verification: "needs-review"`. Example: quant *Number Series* ↔ reasoning *Series*.

| Field | Example (Percentage) |
|---|---|
| `masterTopicId`, `name`, `subject`/`subjectName` | `mt.quant.percentage`, Percentage, quant / Quantitative Aptitude |
| exam-specific mappings | 18 entries, e.g. `ssc-cgl/tier1/quant/quant.percentage`, `sbi-po/mains/data-analysis/quant.percentage` |
| subtopic IDs | `subtopicIds` (union), `sharedSubtopicIds` (in every mapped exam) |
| `similarity` | `identical` (min Jaccard 1.0) |
| `verification` | `verified` (manual review note in overrides.json) |
| `defaultSyncMode` | `full` |
| `coverage` | `ssc-and-banking` (all 9 exams) |

**Concept similarity level.** This is the minimum pairwise Jaccard overlap of the subtopic sets that each exam includes, from the Phase 1 only/exclude choices:

| Level | Rule | Masters | Default verification | Default sync |
|---|---|---:|---|---|
| identical | 1.0 | 99 | verified | full |
| high | ≥ 0.6 | 18 | verified | full |
| partial | ≥ 0.3 | 18 | **needs-review** | partial |
| low | < 0.3 | 5 | **needs-review** | independent |

That gives 22 masters flagged in `cross-exam-mapping.json → review`. Example: SSC Cloze covers standard passages only, while banking adds replacement-style cloze. Uncertain mappings never default to full sync.

## 2. Cross-exam mapping JSON
- `mappings[masterTopicId]`: one entry per exam/stage/section occurrence (`mappingId`, `subtopicSlugs`, `similarityToCore`).
- `byExam[examId][topicId]`: `masterTopicId` (null when unmapped), `requirement` (exam level), and `stageRequirements` (per stage/section). The engine reads this.
- `unmapped` (39 single-exam topics, e.g. CGL DEST, CPO PST), `excluded` (manual), `review` (flagged).

## 3. Difficulty & depth mapping (per exam, never assumed identical)
Each exam topic occurrence gets a requirement:

| Field | How it's set |
|---|---|
| `depth` / `depthDescription` | profile by exam category × stage class (prelims/mains) × exam level (officer/clerical); topic-specific text in overrides |
| `difficulty` | profile (easy / medium / hard) |
| `questionTarget`, `accuracyTarget` | profile (editorial estimates, configurable) |
| `speedTargetSec` | **official pace**: section duration ÷ section questions from the notification |

Percentage, for example:

| Exam / stage | Depth | Difficulty | Target | Speed |
|---|---|---|---|---|
| SSC CGL Tier-I | Standard to advanced arithmetic problems | medium | 40 Q ≥ 85% | ≤ 36 s (25 Q / 15 min) |
| SSC CGL Tier-II | Advanced multi-step percentage problems | hard | 60 Q ≥ 85% | ≤ 60 s |
| SBI PO Prelims | Speed-based calculations | medium | 60 Q ≥ 80% | ≤ 40 s (30 Q / 20 min) |
| SBI PO Mains | Complex applications and DI-related calculations | hard | 50 Q ≥ 70% | ≤ 90 s |
| SBI Clerk Prelims | Speed-based calculations | easy | 60 Q ≥ 85% | ≤ 34.3 s |

The exam-level `requirement` is the strictest of its stages. `stagePreparation` in the report checks each stage on its own (prelims vs mains). You can override targets per exam through the topic record's `targets`, which is stored with that exam only.

## 4. Shared concept learning model
The shared concept record extends the Phase 3 shared topic record (`sharedLearning.topics[libraryTopicId]`). It uses the same key, the old fields are unchanged, and new fields are optional:

```jsonc
{
  "status": "concept-completed",        // concept learning status (≤ Concept Completed: practice is exam-specific)
  "conceptCompletion": 100,             // concept completion % (status ↔ % kept consistent; 50 status points = 100%)
  "notes": "Fraction equivalents, …",
  "learningDates": ["2026-11-15"],
  "resources": [{ "id": "id-001", "title": "…", "type": "book", "url": null, "addedOn": "2026-11-20" }],
  "revisions": [{ "date": "2026-11-18", "note": "Formula sheet recap" }],   // concept revision count = length
  "updatedAt": "…", "sourceExamId": "ssc-cgl"
}
```
In a linked exam, the shared concept lifts subtopic completion to `conceptCompletion × 50 / 100` (the concept phase of the status ladder). It can never go higher.

## 5. Independent exam mastery
- **Mastery** uses only the exam's own status, practice, revision and speed. The `conceptSource: exam-only` setting means a shared concept never changes another exam's mastery (tested).
- **Practice** is stored per exam. Each session is tagged with `level` (ssc or banking) and `stageId` (prelims, mains, tier1 …), so SSC-level, banking-level, prelims and mains practice stay separate (`practiceByStage`, `stagePreparation`).
- **Exam-specific measures:** accuracy, speed (vs the official pace), revision and difficulty are all per exam.
- **Targets in mastery:** the requirement's question target replaces the generic one in the mastery volume factor. Because of this, Phase 3 mastery figures can change; completion figures don't.

## 6. Synchronization rules
| Mode | Linked exams read the shared concept | Exam status changes write back | Exam status label |
|---|---|---|---|
| **A. full** | yes (completion raised to the concept level) | yes (conceptual part only, never lowers it) | shows the shared concept status |
| **B. partial** | yes (completion raised) | **no** (only explicit concept updates are shared) | each exam keeps its own status |
| **C. independent** | no | no | own |

Resolution order for a topic in an exam:
1. Global switch off (`setSyncEnabled(false)`) gives independent everywhere.
2. Per-exam opt-out (`setShareLearning(topic, false)`) makes that exam independent for the topic.
3. Topics that aren't mapped (single-exam or excluded) are always independent.
4. A rejected mapping is independent.
5. Otherwise the user's choice (`setSyncMode(master, mode)`) applies, falling back to the mapping's `defaultSyncMode`.

Defaults are: Percentage `full`; Current Affairs `partial` (different time windows); Coding–Decoding `partial` (different coding styles); Interview, local language and psychometric `independent`.

## 7. Shared-topic dashboard and insights
`engine.getSharedTopicDashboard(examIds)` returns:
- `groups`: common to all selected exams, common to SSC, common to banking, unique to SSC, unique to banking
- `sharedConceptsCompleted`
- `examSpecificPracticePending`: per exam **and stage**, with gaps
- `topicCards`: per master, the concept plus each exam's sync mode, completion (with own completion), mastery, practice, requirement and readiness

`engine.getCrossExamInsights(examIds)` returns:
- shared concepts completed
- `conceptReuse.repetitionsAvoided` (no hours are estimated, since there's no reliable data)
- `remainingExamSpecific`
- `examsBenefiting` (points of completion gained from shared learning)
- `commonHighWeightage`
- `recommendations`, e.g. *"Percentage: concept already completed, so skip basic concept learning for SBI PO prelims. Practise speed-based calculations … (30 more questions (target 60); accuracy 73.33% → 80%; speed 46 s → ≤ 40 s per question)."*

## 8. Data integrity
| Guarantee | How |
|---|---|
| Shared progress never overwrites exam-specific mastery | concept capped at the concept phase; mastery is exam-only; exam records are never written by sync (test 2) |
| No duplicate master topics | one master per library ID; checked in the generator (test) |
| No incorrect mappings | every mapping resolves to a real exam/stage/section/topic with its exact subtopics; invalid overrides fail the build |
| Existing progress records intact | loading never injects defaults; Phase 3 files load byte-identical and give the same completion (7.26 / 10.66) (test 7) |
| Mapping can be manually edited | `overrides.json`: verification, sync mode, requirements, exclusions, related links; re-applied on every build |
| Synchronization can be enabled/disabled | globally, per master topic, per exam topic |
| Uncertain mappings flagged | `review` list + `needs-review` status + safer default sync |

## 9. Engine API (additions)
```js
engine.updateConcept('mt.quant.percentage', { status: 'concept-completed', notes, learningDate });
engine.addConceptResource('quant.percentage', { title, type: 'book' });   // master or library id
engine.addConceptRevision('quant.percentage', { date, note });
engine.getConcept('quant.percentage');            // concept record + sync mode per linked exam
engine.setSyncMode('mt.quant.percentage', 'partial');   // 'full' | 'partial' | 'independent' | null (default)
engine.setSyncEnabled(false);
engine.updateTopic('quant.percentage', { targets: { questionTarget: 150, accuracyTarget: 90 }, difficulty: 'hard' });
engine.recordPractice('quant.percentage', { attempted, correct, timeSeconds, stageId: 'prelims' });
await engine.getCrossExamReports(['ssc-cgl', 'sbi-po']);   // without switching exam
await engine.getSharedTopicDashboard([...]);  await engine.getCrossExamInsights([...]);
```

## 10. Tests (`npm test`; 94 total, 23 new)
| # | Requirement | Expected result |
|---|---|---|
| 1 | Completing Percentage concept updates linked exams | all 9 exams: completion **50**, effective status *concept-completed*, own record untouched, mastery **0** |
| 2 | CGL mastery independent of SBI PO | CGL mastery > 50 after practice; SBI PO mastery **0**, concept component **0**; SBI practice leaves CGL's topic report identical |
| 3 | Disabling sync stops future updates | partial: no write-back, SBI 20 with own status; independent: SBI **0**, no write-back; global off: no shared writes; re-enable restores (nothing deleted) |
| 4 | One exam's practice doesn't affect another | record / set totals / delete in SBI PO → CGL report deep-equal |
| 5 | Exam-specific requirements separate | CGL ≠ SBI PO depth/speed; clerk prelims *easy* vs PO *medium*; CGL target override doesn't change SBI PO |
| 6 | Unmapped topics independent | DEST: `updateConcept` rejected, sync `independent`, no shared record |
| 7 | Existing progress preserved | Phase 3 files load and save byte-identical; completion **7.26 / 10.66** |
| – | Mapping integrity | unique IDs; every 2+-exam topic mapped; every mapping valid; name collisions separate; committed files up to date |
| – | Manual edits / invalid edits | overrides applied (exclusion → unmapped, rejected → independent); six kinds of invalid override rejected |
| – | Dashboard & insights | groups correct; stage-specific recommendations; repetitions avoided = 3 for 4 exams |

## 11. Maintenance
```bash
npm run build:mapping   # regenerate master-topics.json + cross-exam-mapping.json (applies overrides.json)
npm run check:mapping   # fail if overrides are invalid or the generated files are stale
npm run demo:sync       # worked example → examples/common-mapping/
```
Review the `review` list after each syllabus update, and record decisions in `overrides.json` under `masters.<id>.verification`.

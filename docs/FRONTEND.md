# Phase 6: Interactive frontend

The app in [`app/`](../app/) is the user interface for everything built in Phases 1–5. It contains **no calculation logic and no sample data**:

- **Engines:** every figure on screen comes from the engines in [`src/`](../src/), imported directly:
  - `ProgressEngine`: completion, mastery, shared learning and sync
  - `StudyPlanner`: priorities, revision, weak areas and plans
- **Data:** the engines run on the built data files (`dist/syllabus.json`, `dist/weightage/*.json` and `data/mapping/*.json`), which are copied unchanged into `app/public/data/`.

| | |
|---|---|
| Stack | React 18, TypeScript (strict), Tailwind CSS 3, Recharts 2, Lucide icons, Vite 6 |
| Tests | Vitest + Testing Library (jsdom, real engines and data), Playwright (real Chrome, desktop and mobile) |
| Storage | IndexedDB since Phase 7 (atomic, batched writes; restore points): see [PERSISTENCE.md](PERSISTENCE.md). Phase 6 used `localStorage` and is migrated automatically. |

## Running

```bash
npm run build            # once: build the syllabus/weightage/mapping data (Phases 1–4)
npm run app:install      # once: install the app's dependencies (app/node_modules)
npm run app:dev          # dev server on http://localhost:5173 (copies the data into app/public/data first)
npm run app:build        # production build → app/dist (static files; open with any static server)
npm run app:preview      # serve the production build on http://localhost:4173
npm run app:test         # unit + UI integration tests (Vitest)
npm run app:e2e          # browser tests (Playwright, uses the installed Chrome; run app:build first)
```

The commands can also be run inside `app/` (`npm run dev`, `npm test` …). `app/dist` is a static site and needs no backend.

## Architecture

```
app/src
  lib/engines.ts     typed bridge to ../src/progress and ../src/planner (the only place the engines are imported)
  lib/loader.ts      fetch-based loader (same interface as createNodeLoader in src/progress/node.js)
  lib/store.ts       AppStore: ONE ProgressEngine + ONE StudyPlanner on one storage = the single source of truth
  lib/selectors.ts   regroups engine output for display (never recalculates scores)
  lib/useExam.ts     active exam + scope: report, sessions, Phase 5 analysis of that exam
  lib/hooks.tsx      React binding (useSyncExternalStore), async hook, hash routing, theme
  components/        ui kit, layout (sidebar, exam/stage selectors), charts, practice form, target gate
  pages/             Dashboard, Syllabus, Compare, CommonTopics, Priorities, Planner, Revision, Practice, Settings
```

### Data flow

1. **Writes go through the engines.** Every user action calls an engine method:
   - `engine.setStatus`, `updateTopic`, `recordPractice`, `addRevision`, `updateConcept`, `setSyncMode`, `setWeightOverride`, `setStage`
   - `planner.setTargets`, `generateDailyPlan`, `addTask`, `moveTask`, `completeTask`, `dismissRecommendation` …

   The engine validates the change, recalculates lazily and auto-saves its collections. The store re-renders the UI through `engine.subscribe`.
2. **Reads also come from the engines:**
   - `engine.getReport()` for the active exam and its selected stage
   - `engine.getCrossExamReports()` for the comparison pages
   - `engine.getSharedTopicDashboard()` for Common Topics
   - `planner.getRecommendations()` / `getRevisionTracker()` / `explain()`
   - the pure Phase 5 functions (`computePriorities`, `detectWeakAreas`) applied to the active exam
3. **There are no duplicate progress stores.** Storage keys:

| Key | Written by | Content |
|---|---|---|
| `progress`, `sharedLearning`, `practice`, `weightOverrides`, `syncSettings` | ProgressEngine | Phases 3–4 collections, unchanged format |
| `planner` | StudyPlanner | targets, hours, overrides, dismissals, daily plans |
| `progressConfig` | AppStore | user-edited status scores and mastery parameters (absent = defaults); validated by the engine's `compileConfig` |
| `history` | AppStore | one whole-exam snapshot (completion, mastery, counts) per exam per day, for the trend chart; derived data, not progress |
| `ui:*`, `theme` | browser | per-viewer conveniences (collapsed sidebar, compared exams, theme) |

Exam switching calls `engine.switchExam`, so each exam keeps its own progress.

Stage selection is stored per exam (`setStage`). Practice is tagged with its stage, so prelims and mains practice are never mixed. Shared concept learning follows the Phase 4 sync modes.

### Small additions to the engines

These are additive, with tests in `test/progress` and `test/planner`:

- **`engine.setConfig(config)`** makes status scores and mastery parameters editable at runtime. The config is validated and stored records are untouched.
- **`engine.getExamRecords(examId)` and `engine.getWeightOverrides(examId)`** are read-only copies, used for revision history and the weightage editor.
- **`planner.addTask` creates an empty plan** when a day has none, which lets you add a recommendation to any day.
- **`planner.moveTask(from, taskId, to, { index })`** supports drag-and-drop between days and reordering.
- **`planner.generateDailyPlan(date, { excludeTopicIds })`** lets "Plan this week" spread topics across days instead of repeating them.
- **Bug fix (Phase 3) in `calculateProgress`:** classification now compares the rounded completion and mastery that the report shows. Before the fix, a topic set to *Completed* could come out as 89.999…% and not be counted as completed. This affected 101 of 828 exam-topic pairs. A regression test now covers all 9 exams.
- **Bug fix (app loader):** a failed data load is no longer cached, so *Try again* really reloads. A test covers this.

## Pages

| Page | Shows | Edits (through the engines) |
|---|---|---|
| **Dashboard** | completion, mastery, topics completed and remaining, revisions needed; completion donut; section-wise completion and mastery bars; status distribution; preparation trend (daily history) and weekly practice; high-weightage incomplete, weakest topics, pending revisions, today's priorities | – |
| **Syllabus Tracker** | Stage → Section → Topic → Subtopic, with weight in section, effective exam weight, completion, mastery, status, revision status, Phase 2 weightage class, Phase 5 priority, shared/independent badge, targets and gaps | inline status (topic and subtopic, inherit), notes, practice log (topic or subtopic, stage-tagged, revision flag), confirm revision; search (topics and subtopics), section and status filters, pending-only, high-priority-only, sort by weightage/priority/completion/mastery, expand and collapse |
| **Exam Comparison** | any set of exams: completion and mastery chart and table, subject-wise heatmap (or each exam's sections), shared topics completed, exam-specific pending topics | exam selection |
| **Common Topics** | master topics across the selected exams: verification, similarity, shared concept progress (learned once), per-exam completion, mastery, questions and remaining practice gaps; sync mode clearly marked (fully shared, partially shared, independent) | shared concept status, sync mode; open the topic in an exam |
| **Smart Priorities** | Phase 5 recommendations grouped Critical/High/Medium/Low with score, exam, section, weightage, completion, mastery, reasons, next action; exam shares; mock-test recommendations | add to plan (day, exam, action, minutes), dismiss (all exams or one, optional end date), restore, "Why?" factor breakdown |
| **Study Planner** | month calendar (plans, completion, exam dates), weekly board, weekly targets (planned vs available, completed), day detail with daily target | generate day or week, add, remove, reorder (drag or arrows), move between days (drag, or menu on touch), complete with optional outcome (status, practice, revision) applied via the engine; never automatic |
| **Revision Tracker** | overdue, due today, upcoming; revision history (confirmed and revision sessions) with session accuracy and current mastery; intervals | manual confirmation per exam (optional questions), never automatic |
| **Practice Analytics** | attempted, correct, incorrect, accuracy, average time; weekly or daily volume and accuracy trend; section-wise and topic-wise performance against exam targets; recent sessions | log practice, delete a mistaken session |
| **Settings** | – | target exams with importance and exam dates, daily hours, revision intervals, priority weights and thresholds, topic weightage overrides, status scores, mastery parameters, shared learning on or off, theme, export, import (validated, confirmed), reset (typed confirmation) |

Every page has loading, empty and error states. Every exam-specific page follows the exam and stage selectors at the top.

### Design

The design is a minimal, neutral dashboard in light and dark themes, using system fonts and 1px borders, with no gradients or decorative motion (`prefers-reduced-motion` is respected).

Charts follow a validated palette:
- **Fixed series colours:** completion is blue and mastery is orange, everywhere.
- **Many exams:** compared in a sequential-blue heatmap rather than many hues.
- **Marks:** thin, with 4px rounded ends, one axis per chart, and hover tooltips.
- **Status:** status colours always come with an icon and a label.

On phones the sidebar becomes a drawer and the selectors form a compact grid. Tables scroll inside their cards, and no page scrolls horizontally (checked by the browser tests).

## Test results

| Suite | Command | Result |
|---|---|---|
| Engines, Phases 1–5 plus additions | `npm test` | 126 / 126 pass |
| App store, selectors, loader, UI integration | `npm run app:test` | 29 / 29 pass |
| Browser end-to-end (Chrome, desktop 1440×900 and mobile 390×844 touch) | `npm run app:e2e` | 21 pass, 3 skipped by design (desktop-only drag and collapsible sidebar; mobile-only move menu) |
| Type check | `npm --prefix app run typecheck` | 0 errors |

**What the browser tests cover:**
- first run → exam chooser → dashboard values equal to `engine.getReport()`
- sidebar navigation to all 9 pages with the active item highlighted, no console errors and no horizontal scrolling (desktop and mobile)
- collapsible sidebar, remembered after reload
- exam and stage switching recalculating values without mixing progress
- search and filters
- an inline status edit that persists after reload and updates the dashboard
- planner drag-and-drop between days, and the touch move menu
- manual task completion leaving progress byte-identical
- manual revision confirmation
- the error state (data unavailable) with recovery, and the loading state
- the dark theme, remembered after reload
- export of a complete backup

The integration tests additionally cover:
- export → reset → import restoring every collection exactly
- import rejecting foreign files
- scoring config edits recalculating and invalid ones being rejected
- completing a task without an outcome leaving progress untouched
- practice logged from a topic showing up in analytics

> Phase 7 updates: storage, saving, backup/restore, CSV, restore points and current test counts are documented in [PERSISTENCE.md](PERSISTENCE.md).

## Known limitations (Phase 6; see PERSISTENCE.md for the current list)

- **Single device.** Data lives in the browser's local storage, so there is no cross-device sync. Export and import move data between browsers. If storage is unavailable (private mode), the app warns and keeps data for the session only.
- **The trend chart starts empty.** It is recorded from the first use, one point per day, and is not reconstructed for earlier dates, because the engines don't keep status history. Practice trends use the dated sessions and are complete.
- **Weightage overrides are topic-level only in the UI.** The engine also supports stage, section and subtopic overrides.
- **Some engine features are not in the UI yet:** manual mastery overrides, aggregate practice totals (`setPracticeTotals`), and shared-concept resources and concept revisions (Phase 4).
- **Drag-and-drop is mouse-only.** HTML5 drag-and-drop doesn't work on touch devices, so they use the "Move to…" menu and the arrow buttons.
- **One JavaScript bundle.** It is about 245 kB gzipped and could be code-split by page. The data files total 8 MB uncompressed and load once at start.

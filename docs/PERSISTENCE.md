# Phase 7: Persistence, backup, restore and final integration

This phase makes the tracker a reliable personal system. The earlier phases are unchanged in behaviour:
- **Phases 1–2:** the syllabus and weightage databases.
- **Phases 3–5:** the progress, mapping and priority engines.
- **Phase 6:** the interface.

What this phase adds:
- **Permanent storage:** preparation data is stored permanently in the browser's database (IndexedDB).
- **Saving:** automatic, atomic and visible.
- **Backup and restore:** files can be exported and re-imported (fully or merged), and data can be exported as CSV.
- **Restore points:** local copies are kept automatically.
- **Integrity checks.**

## 1. Final architecture

```
                      ┌──────────────── build time (Node) ────────────────┐
data/library, data/exams ──► scripts/build.mjs ──► dist/syllabus.json        (Phase 1)
data/weightage            ──► build-weightage   ──► dist/weightage/*.json     (Phase 2)
                              build-mapping     ──► data/mapping/*.json       (Phase 4)
                      └───────────────────────────────────────────────────┘
                                   │ copied unchanged (app/scripts/sync-data.mjs)
                                   ▼
Browser ── app/public/data/*.json (read-only reference data, fetched once)
   │
   ├── src/progress  ProgressEngine   completion · mastery · shared learning · sync   (Phases 3–4)
   ├── src/planner   StudyPlanner     priorities · revision · weak areas · plans      (Phase 5)
   │        ▲ both write through ONE storage adapter
   │        │
   ├── app/src/lib/store.ts   AppStore: single source of truth, save status, backup, CSV, snapshots
   ├── app/src/lib/idb.ts     IndexedDBStorage: atomic batched writes, retries, snapshots, migration
   ├── app/src/lib/backup.ts  backup format v2, validation, safe merge (pure)
   ├── app/src/lib/csv.ts     CSV exports (pure)
   └── app/src/pages, components   React UI (pages lazy-loaded)
```

Reference data (syllabus, weightage, mapping) is **read-only** and versioned with the code. The user's **preparation data** lives only in IndexedDB. The two are never mixed.

## 2. Database schema

The database is called `syllabus-tracker` and is at version 1. It is IndexedDB, per browser profile and per site.

| Object store | Key | Record |
|---|---|---|
| `collections` | `key` | `{ key, data, savedAt, schema }`: one record per collection, below |
| `snapshots` | `id` (index `createdAt`) | `{ id, createdAt, reason, collections, bytes }`: restore points |
| `meta` | `key` | `{ key, value }`: e.g. `migratedFromLocalStorage`, `quarantine:<key>:<time>` |

| Collection (`key`) | Written by | Stores | Schema |
|---|---|---|---|
| `progress` | ProgressEngine | Per exam: track, stage and choices; topic and subtopic records (status, completion/mastery overrides, notes, start and completion dates, revisions, targets, shared-learning flag) | [`progress.schema.json`](../data/schema/progress.schema.json), v2 |
| `practice` | ProgressEngine | Per exam: practice sessions `{ id, nodeId, date, attempted, correct, incorrect, timeSeconds, difficulty, revision, stageId, level, note, createdAt }`. Accuracy and mastery are calculated from these. | v2 |
| `sharedLearning` | ProgressEngine | Common-topic concept records: status, concept completion, notes, learning dates, resources, concept revisions | v2 |
| `syncSettings` | ProgressEngine | Sync on or off; per-master-topic sync mode (full, partial, independent) | v2 |
| `weightOverrides` | ProgressEngine | Custom weights per exam `{ weightKey: value }` | v2 |
| `planner` | StudyPlanner | Target exams (importance, dates), daily hours, priority and revision settings, dismissals, daily plans and tasks | [`planner.schema.json`](../data/schema/planner.schema.json), v1 |
| `progressConfig` | AppStore | User-edited status scores and mastery parameters (absent = defaults) | as `data/progress/config.json` |
| `history` | AppStore | One whole-exam point per exam per day (completion, mastery, counts), for the trend chart | v1 |

These items are calculated, not stored:
- **Exam mastery:** stored only as manual overrides; otherwise derived from practice, revision and status records.
- **Accuracy:** derived from the practice sessions.
- **Weekly targets:** derived from daily hours and plans.

Calculating these values means they can never disagree with their inputs.

**Unique IDs and references:**
- Practice sessions use `crypto.randomUUID()`, and the engine rejects a duplicate session ID.
- Topic and subtopic IDs are the stable library IDs from Phase 1.
- Plan task IDs are unique per day.
- Records referring to topics outside an exam's current syllabus are kept and reported as orphans; they are never deleted.

UI preferences (theme, collapsed sidebar, compared exams) stay in `localStorage`. They are per-viewer conveniences, not preparation data.

## 3. Saving

**Automatic.** Every edit is applied by an engine method and saved immediately, with no Save button:
- topic or subtopic status
- completion and mastery overrides
- practice
- revisions
- notes
- custom weights
- plans and tasks
- targets and settings
- shared concepts and sync modes

**Status.** The header shows **Saving…**, **Saved** or **Save failed (Retry)**. If the tab is closed while a save is pending or failed, the browser asks for confirmation.

**Atomic.** A change that touches several collections is committed in **one IndexedDB transaction** (`writeMany`). For example, logging practice updates both `practice` and `progress`. An interrupted save therefore never leaves them inconsistent: after a crash you get either the state before the change or the state after it.

**No unnecessary writes:**
- Writes made in the same tick are combined into one transaction.
- A collection that did not change is not written again.

**Failures are recoverable:**
- A failed write (quota exceeded, disk error) keeps the data pending in memory.
- The next save, or the Retry button, writes it.
- The engines' save chains recover after a failure. Before this phase, one failed save silently blocked all later saves; this is fixed and tested.

**Corrupted records** are moved to `meta` (`quarantine:…`) instead of being discarded, and the user is told. Restore points and backups can then recover the data.

**Migration.** Phase 6 data in `localStorage` is copied into IndexedDB on the first start, verified by reading it back through a fresh connection, and only then removed from `localStorage`.

**Fallback.** If IndexedDB is unavailable, the app uses `localStorage`. If that is blocked too, data is kept for the session only, and the app says so clearly.

## 4. Backup and restore

### Export
In Settings → Data & backups, choose **Export backup (JSON)**. You get `syllabus-tracker-backup-YYYY-MM-DD.json`, a complete copy of every collection above.

| Field | Content |
|---|---|
| `format`, `formatVersion` | `syllabus-tracker-export`, version 2 |
| `app` | name and version |
| `exportedAt` | ISO timestamp |
| `schema.collections` | schema version of every collection |
| `mapping` | Phase 4 mapping reference (master topic count and metadata) |
| `summary` | counts per exam, used on the confirmation screen |
| `collections` | the data |
| `checksum` | `sha256:` of the collections, which detects damaged or edited files |

The file format is described by [`data/schema/backup.schema.json`](../data/schema/backup.schema.json).

### Import
In Settings → Data & backups, choose **Import backup…**. Nothing is written until you confirm.

1. **Validation:**
   - JSON structure and file format
   - format version, and a newer schema version for each collection, which is refused
   - checksum
   - required collections and fields (`progress`; session `id`, `nodeId`, `date`, `attempted`, `correct ≤ attempted`; task IDs; targets)
   - duplicate IDs (practice sessions, plan tasks, target exams)
   - references to unknown exams (an error)
   - references to topics outside the syllabus (a warning; they are kept)
   - invalid custom weights and sync modes
   - scoring settings, validated by the engine's own config validator
2. **Confirmation screen:**
   - file details and checksum status
   - your current data next to the backup, per exam (records, sessions, revisions), with shared concepts, plans, targets, weights, sync preferences and history
   - any warnings
3. **Choose a mode:**
   - **Merge with my data (safe, the default when you have data).** Nothing you have is deleted:
     - Practice sessions are combined by ID, with no duplicates, even when the same file is merged twice.
     - Revisions are combined.
     - For a topic record or shared concept present in both, the more recently updated one wins.
     - Exam settings, targets, custom weights, sync modes and scoring settings keep your current values; only missing ones are added.
     - Day plans gain the missing tasks.
     - A report lists what was added and updated.
   - **Full restore.** Your data is replaced by the backup exactly as exported.
4. **Safety.** A **restore point** of your current data is created automatically before either mode, so every import can be undone.

### Restore points (local)
Restore points are created automatically:
- once a day when there is data (the last 7 are kept)
- before every import, restore or reset (the last 10 are kept)

You can also create one manually. Each restore point can be restored (your current data is saved as a restore point first), downloaded as a backup file, or deleted.

Restore points live in the same browser. **They do not replace exported backups.**

### CSV export
Settings → Data & backups → **Export as spreadsheet**. Each export can cover the current exam, exams with saved progress, or all 9 exams. Files are UTF-8 with a BOM so Excel opens them correctly, and formula characters are escaped.

| Report | Rows |
|---|---|
| Overall exam progress | one per exam: completion (own and shared), mastery, topic counts, questions, accuracy, average time |
| Section-wise progress | one per section: weights in stage and exam, completion, mastery |
| Topic-wise completion | one per topic per section: weights, weightage class, status, completion, mastery, dates, notes |
| Mastery and accuracy | one per topic: mastery and its components, override flag, accuracy, speed, exam targets, targets met |
| Revision history | every confirmed revision and revision session |
| Study activity | practice sessions, revisions and completed planner tasks, by date |

### Data integrity check
Settings → Data & backups → **Run check**. It runs the import validation on your current data and lists orphan records, which are kept but not counted.

## 5. Cross-device use

**No cloud synchronisation is configured.** Data stays in the browser profile and device where it was entered, and the app says so in Settings. To use another device or browser:
1. Export a backup on device A.
2. Import it on device B, choosing **Merge** to combine with data already there, or **Full restore**.

Keep regular exports. Clearing the site's data in the browser deletes the IndexedDB database. Settings offers **Ask the browser to keep this data**, which uses the persistent-storage API, to prevent automatic eviction.

## 6. Deployment

The app is a static site with no server and no database server.

```bash
npm run build          # data build (Phases 1–4) → dist/, data/mapping/
npm run app:install    # once
npm run app:build      # → app/dist/ (index.html, assets/, data/)
```

Any static host can serve `app/dist`, for example:
- **GitHub Pages:** publish `app/dist`. The base path is relative (`base: './'`), so a sub-path such as `/syllabus-tracker/` works.
- **Netlify or Vercel:** set the build command to `npm ci && npm run build && npm --prefix app ci && npm --prefix app run build`, and the publish directory to `app/dist`.
- **nginx, Apache, or any file server:** copy `app/dist`. HTTPS (or localhost) is required for the backup checksum (SubtleCrypto) and for the persistent-storage request.

Local use: `npm run app:preview` serves on http://localhost:4173.

IndexedDB data belongs to one **origin** (scheme, host and port). Moving the app to another address starts with empty data, so export before moving and import afterwards.

## 7. Performance

| Measure | Result |
|---|---|
| Initial JavaScript | 175 kB (56 kB gzip), down from 871 kB; pages and charts load on demand |
| Start-up reads | all collections in **one** IndexedDB transaction |
| Report recalculation (one exam) | 9–23 ms with 1,000–50,000 practice sessions; sessions are indexed per topic |
| Exam switch (new model + report) | 22–30 ms |
| Multi-exam recommendations (2 targets) | ≈ 100 ms |
| Writes | coalesced per tick; unchanged collections skipped |
| Re-renders | toasts and save status use a separate subscription, so they never re-render pages |

## 8. Tests

| Suite | Command | Result |
|---|---|---|
| Engines (Phases 1–5, plus the save-chain recovery, atomic writes and duplicate-ID tests) | `npm test` | 129 / 129 |
| App unit and integration: store, selectors, loader, UI, IndexedDB, backup validation and merge, CSV, persistence | `npm run app:test` | 49 / 49 |
| Browser end-to-end (real Chrome; desktop 1440×900 and mobile 390×844 touch) | `npm run app:e2e` | 45 passed, 3 skipped by design |

The Phase 7 browser tests run each flow through the real UI:
- **Persistence:**
  - topic status, notes and a mastery override survive a refresh, stored in IndexedDB and not in localStorage
  - switching exams and returning shows identical values
  - practice and revisions logged in the UI survive a reload and raise mastery
  - custom weightage persists and changes the calculation
- **Common topics:** shared concepts and sync preferences persist and survive a backup and restore.
- **Backup:**
  - an exported backup has format 2, a SHA-256 checksum and every collection
  - a full restore in a fresh browser profile reproduces the original exactly
  - merging into a profile with other data, twice, keeps both with no duplicates and leaves a restore point
  - tampered and foreign files are refused with an explanation
- **CSV:** all six exports download and contain the engine's values.
- **Recovery:**
  - Phase 6 localStorage data is migrated on first start
  - a forced save failure shows "Save failed", keeps the change, and recovers
  - a restore point brings back an earlier state
- **Local-only notice:** the "No cloud sync is configured" message is shown.
- **Regression:** all Phase 6 tests still pass, including navigation without horizontal scrolling on mobile.

## 9. Known limitations

- **No cloud sync.** Data is per browser profile and device. Export and import move it.
- **Restore points share the browser's storage.** Clearing site data removes them too, so exported files are the real backup.
- **The trend chart has no history before first use.** It starts at the first recorded day, because status history before that was never stored.
- **Merging is per collection.** Settings without timestamps (exam settings, targets, weights, sync modes, scoring) keep the current value rather than being reconciled field by field.
- **Some engine features are not in the UI yet:**
  - weight overrides above topic level (stage, section, subtopic)
  - aggregate practice totals (`setPracticeTotals`)
  - shared-concept resources

## 10. Recommended future improvements

1. **Optional cloud sync with sign-in,** for example a small backend or Supabase/Firebase. It would sync the same collections, use the existing merge rules for conflicts, and add per-record timestamps for settings.
2. **Scheduled automatic export.** Use the File System Access API where supported, so backups land in a folder you choose, such as a cloud-drive folder.
3. **Status history** (an append-only event log) for a complete progress timeline and undo.
4. **Service worker (PWA)** for offline start-up, and caching of the 8 MB of reference data.
5. **UI for the remaining engine features,** and a mock-test score log feeding mastery.
6. **Web worker for the planner** when many target exams are selected.

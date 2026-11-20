// Public, environment-neutral API of the progress engine (safe to import in the browser).
// Node-only helpers (FileStorage, createNodeLoader, loadDefaultConfig) live in ./node.js.
export { ProgressEngine } from './engine.js';
export { calculateProgress } from './calculate.js';
export { buildExamModel, weightKey } from './model.js';
export { aggregateStats, scoreMastery } from './mastery.js';
export { compileConfig, clampPct, round2, nodeKind } from './config.js';
export * as progressDb from './progress-db.js';
export { MemoryStorage, WebStorageAdapter, loadDb, saveCollections } from './storage.js';
// Phase 4: common syllabus mapping & synchronization
export { buildMapping, masterIdOf, topicIdOfMaster, stageClassOf } from '../mapping/build.js';
export { buildSharedTopicDashboard, buildCrossExamInsights } from '../mapping/insights.js';

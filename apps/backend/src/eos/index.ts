export { engineeringEventBus } from './event-bus.js';
export type { EngineeringEvent, KnownEvent, WorkerJobEvent, BootEvent, QueueDepthEvent, AlertErrorRateEvent, ProcessMemoryEvent, ApiLatencySummaryEvent, AiProviderObservationEvent, PromptOutcomeEvent, AlertPromptRegressionEvent, EngineeringSnapshotEvent } from './event-bus.js';
export { attachWorkerCollector } from './worker-collector.js';
export { eosApiCollector } from './api-collector.js';
export { registerHealthProbe, startHealthCollector, stopHealthCollector } from './health-collector.js';
export { markBootStart, emitBootComplete } from './boot-collector.js';
export { registerDependencyProbes } from './dependency-probes.js';
export { sampleQueueDepths, startQueueDepthCollector, stopQueueDepthCollector } from './queue-depth-collector.js';
export { startErrorRateMonitor, stopErrorRateMonitor, getErrorRateSnapshot } from './error-rate-monitor.js';
export { sampleMemory, startMemoryCollector, stopMemoryCollector } from './memory-collector.js';
export { recordLatency, getLatencySnapshot, startLatencyTracker, stopLatencyTracker } from './latency-tracker.js';
export { recordProviderObservation, getProviderMatrix, startProviderObservatory, stopProviderObservatory } from './provider-observatory.js';
export type { ProviderMatrixEntry } from './provider-observatory.js';
export { recordPromptOutcome, getPromptReport, startPromptIntelligence, stopPromptIntelligence } from './prompt-intelligence.js';
export type { PromptReportEntry } from './prompt-intelligence.js';
export { InMemoryHistoryStore, FileHistoryStore } from './history-store.js';
export type { EngineeringHistoryStore, EngineeringSnapshot, HistoryQuery } from './history-store.js';
export {
  buildSnapshot,
  captureSnapshot,
  queryHistory,
  setHistoryStore,
  getHistoryStore,
  startHistoryRecorder,
  stopHistoryRecorder,
} from './history-recorder.js';
export { eosRouter } from './routes.js';

export { engineeringEventBus } from './event-bus.js';
export type { EngineeringEvent, KnownEvent, WorkerJobEvent, BootEvent, QueueDepthEvent, AlertErrorRateEvent, ProcessMemoryEvent, ApiLatencySummaryEvent, AiProviderObservationEvent, PromptOutcomeEvent, AlertPromptRegressionEvent, AlertCostAnomalyEvent, EngineeringSnapshotEvent, EvaluationRunCompletedEvent, AiInteractionCompletedEvent, EvaluationCaseCapturedEvent } from './event-bus.js';
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
export { DetectorWindow } from './detector-window.js';
export type { WindowConfig, WindowSlices } from './detector-window.js';
export { recordCostObservation, getCostReport, startCostMonitor, stopCostMonitor } from './cost-monitor.js';
export {
  recordLatencyObservation,
  getLatencyDriftReport,
  startLatencyDrift,
  stopLatencyDrift,
} from './latency-drift.js';
export type { LatencyDriftEntry } from './latency-drift.js';
export {
  recordReliabilityObservation,
  getDegradationReport,
  startProviderDegradation,
  stopProviderDegradation,
} from './provider-degradation.js';
export type { DegradationEntry } from './provider-degradation.js';
export type { CostReportEntry } from './cost-monitor.js';
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
export {
  applyGraders,
  registerGrader,
  getGrader,
  listGraders,
  resetGraders,
} from './evaluation-graders.js';
export type { Grader, GraderSpec, GradeResult } from './evaluation-graders.js';
export {
  createDataset,
  addCase,
  removeCase,
  getDataset,
  getCases,
  summarizeDataset,
  listDatasets,
  deleteDataset,
  resetDatasets,
} from './evaluation-datasets.js';
export type {
  CaseOrigin,
  EvaluationCase,
  EvaluationDataset,
  DatasetSummary,
} from './evaluation-datasets.js';
export { runEvaluation, compareRuns } from './evaluation-runner.js';
export {
  InMemoryBaselineStore,
  FileBaselineStore,
  setBaselineStore,
  getBaselineStore,
} from './baseline-store.js';
export type { BaselineStore } from './baseline-store.js';
export {
  runRegressionSuite,
  measureRegressionGate,
  acceptAsBaseline,
  getBaseline,
  clearBaselines,
} from './regression-suite.js';
export type { RegressionRun, RegressionResult } from './regression-suite.js';
export type {
  CaseExecutor,
  CaseResult,
  EvaluationRunResult,
  RunComparison,
  RunOptions,
} from './evaluation-runner.js';
export {
  configureJudge,
  isJudgeConfigured,
  judgeOutput,
  resetJudge,
  summariseJudgements,
} from './ai-judge.js';
export type { Judge, Judgement, JudgedSummary } from './ai-judge.js';
export {
  registerMediaPrice,
  getMediaPrice,
  listMediaPrices,
  priceMediaUsage,
  priceAgeDays,
  resetMediaPrices,
} from './media-pricing.js';
export type { MediaPrice, PricingBasis, PricingResult } from './media-pricing.js';
export { redact, containsSensitive, defaultRedactionRules } from './redaction.js';
export type { RedactionRule, RedactionResult } from './redaction.js';
export {
  captureInteraction,
  shouldCapture,
  startCaseCapture,
  stopCaseCapture,
  getCaptureStats,
  setSampler,
} from './case-capture.js';
export { isCaptureActive } from './case-capture.js';
export type { CaptureConfig, Interaction, CaptureDecision } from './case-capture.js';
export {
  declareEgressPath,
  auditPrivacyCoverage,
  measurePrivacyGate,
  listEgressPaths,
  resetEgressPaths,
  SENSITIVE_PROBE_INPUT,
} from './privacy-coverage.js';
export type { EgressPath, PathResult, PrivacyCoverageResult } from './privacy-coverage.js';
export { registerEgressPaths } from './egress-registry.js';
export { getRuntimeCheck, EXPECTED_SUBSCRIPTIONS } from './runtime-check.js';
export {
  InMemoryGateStore,
  FileGateStore,
  setGateStore,
  getGateStore,
} from './gate-store.js';
export type { GateStore } from './gate-store.js';
export {
  LAUNCH_GATES,
  getLaunchReadiness,
  recordGateMeasurement,
  clearGateMeasurements,
  hydrateGateMeasurements,
  persistGateMeasurement,
} from './launch-gates.js';
export type {
  GateStatus,
  GateCategory,
  GateDefinition,
  GateMeasurement,
  GateResult,
  LaunchReadiness,
} from './launch-gates.js';
export type { RuntimeCheckEntry, RuntimeCheckResult } from './runtime-check.js';
export { recordAiInteraction } from './instrumentation.js';
export type { AiInteractionRecord } from './instrumentation.js';
export {
  configureDraftGenerator,
  generateDraft,
  resetDraftGenerator,
} from './draft-generator.js';
export type { Drafter, DraftResult, DraftMeasurement } from './draft-generator.js';
export {
  attachDraft,
  buildCostAnomalyProposal,
  buildLatencyDriftProposal,
  buildProviderDegradationProposal,
  buildPromptRegressionProposal,
  startProposalEngine,
  stopProposalEngine,
  listProposals,
  getProposal,
  decideProposal,
} from './proposal-engine.js';
export type { Proposal, ProposalStatus, ProposalEvidence } from './proposal-engine.js';
export {
  configureExecution,
  executeProposal,
  resetExecution,
  buildPullRequestBody,
} from './execution-layer.js';
export type { GitOperations, ExecutionRecord, ExecutionOutcome } from './execution-layer.js';
export { rankCandidates, recommendRoute, DEFAULT_WEIGHTS } from './evidence-router.js';
export type {
  RoutingWeights,
  RoutingCandidate,
  RankedCandidate,
  RoutingDecision,
} from './evidence-router.js';
export { eosRouter } from './routes.js';

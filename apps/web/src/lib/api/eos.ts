import { api } from './client';

/**
 * Engineering Operating System API client.
 *
 * Mirrors apps/backend/src/eos/routes.ts. Every route is gated by
 * requireAdminRole, so these are founder-only — the page must be gated at
 * its layout so the request never fires for a caller who cannot see it.
 */

export interface LatencySnapshot {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}

export interface ErrorRateSnapshot {
  errorsInWindow: number;
  windowMs: number;
  threshold: number;
}

export interface ProviderMatrixEntry {
  providerId: string;
  modelId: string;
  requests: number;
  successes: number;
  failures: number;
  successRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  errorCodes: Record<string, number>;
  /** Recorded by the backend, not inferred from a zero cost. */
  tokenPriced: boolean;
  /** How this model is billed. Absent means the caller never said. */
  pricingBasis?: 'token' | 'per-image' | 'per-character' | 'per-second';
  /** 'stated' means the figure came from a published price table, not the provider. */
  costProvenance?: 'observed' | 'stated';
  lastObservedAt: number;
}

export interface PromptReportEntry {
  promptId: string;
  version: number;
  executions: number;
  successes: number;
  failures: number;
  successRate: number;
  recentSuccessRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCostCents: number;
  regressing: boolean;
  lastObservedAt: number;
}

export interface EngineeringEvent {
  type: string;
  timestamp: number;
  source: string;
  payload: Record<string, unknown>;
}

export interface EventBusStats {
  totalEmitted: number;
  bufferSize: number;
  listenerCount: number;
}

export interface CaptureStats {
  active: boolean;
  datasetId: string;
  captured: number;
  skipped: number;
  maxCases: number;
}

export interface DatasetSummary {
  id: string;
  name: string;
  version: number;
  caseCount: number;
  realCases: number;
  syntheticCases: number;
  tags: string[];
  updatedAt: number;
}

export function getLatency(): Promise<{
  current: LatencySnapshot;
  recentSummaries: EngineeringEvent[];
}> {
  return api.get('/api/eos/latency');
}

export function getErrorRate(): Promise<{
  current: ErrorRateSnapshot;
  recentAlerts: EngineeringEvent[];
}> {
  return api.get('/api/eos/error-rate');
}

export function getProviderMatrix(): Promise<ProviderMatrixEntry[]> {
  return api.get('/api/eos/provider-matrix');
}

export function getPromptReport(): Promise<{
  report: PromptReportEntry[];
  recentAlerts: EngineeringEvent[];
}> {
  return api.get('/api/eos/prompt-report');
}

export function getEventStats(): Promise<EventBusStats> {
  return api.get('/api/eos/events/stats');
}

export function getRecentEvents(limit = 50): Promise<EngineeringEvent[]> {
  return api.get(`/api/eos/events/recent?limit=${limit}`);
}

export function getCaptureStatus(): Promise<{
  stats: CaptureStats;
  recentCaptures: EngineeringEvent[];
}> {
  return api.get('/api/eos/evaluation/capture');
}

export function getDatasets(): Promise<DatasetSummary[]> {
  return api.get('/api/eos/evaluation/datasets');
}

export interface AiPathCoverage {
  promptId: string;
  label: string;
  instrumented: boolean;
  observed: boolean;
}

export function getCoverage(): Promise<AiPathCoverage[]> {
  return api.get('/api/eos/coverage');
}

export interface RuntimeCheckEntry {
  component: string;
  eventType: string;
  listeners: number;
  running: boolean;
  consequenceIfMissing: string;
}

export interface RuntimeCheckResult {
  entries: RuntimeCheckEntry[];
  allRunning: boolean;
  notRunning: string[];
  /** Components the check structurally cannot see. Shown, not hidden. */
  notCoveredByThisCheck: string[];
}

export function getRuntimeCheck(): Promise<RuntimeCheckResult> {
  return api.get('/api/eos/runtime-check');
}

export interface CostReportEntry {
  providerId: string;
  modelId: string;
  requests: number;
  /** Null means no baseline was ever established — not a baseline of zero. */
  baselineCostCents: number | null;
  recentCostCents: number | null;
  /** Null when the baseline was zero, which makes a multiple undefined. */
  ratio: number | null;
  baselineSamples: number;
  sufficientData: boolean;
  anomalous: boolean;
  lastObservedAt: number;
}

export function getCostReport(): Promise<{
  report: CostReportEntry[];
  recentAlerts: EngineeringEvent[];
}> {
  return api.get('/api/eos/cost-report');
}

export interface LatencyDriftEntry {
  providerId: string;
  modelId: string;
  requests: number;
  baselineP95Ms: number | null;
  recentP95Ms: number | null;
  ratio: number | null;
  baselineSamples: number;
  sufficientData: boolean;
  drifting: boolean;
  lastObservedAt: number;
}

export function getLatencyDrift(): Promise<{
  report: LatencyDriftEntry[];
  recentAlerts: EngineeringEvent[];
}> {
  return api.get('/api/eos/latency-drift');
}

export interface DegradationEntry {
  providerId: string;
  modelId: string;
  requests: number;
  baselineSuccessRate: number | null;
  recentSuccessRate: number | null;
  /** Points, not a ratio — 100% to 98% is a 2-point drop. */
  dropPercentagePoints: number | null;
  baselineSamples: number;
  sufficientData: boolean;
  degraded: boolean;
  lastObservedAt: number;
}

export function getDegradation(): Promise<{
  report: DegradationEntry[];
  recentAlerts: EngineeringEvent[];
}> {
  return api.get('/api/eos/degradation');
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected';

export interface ProposalEvidence {
  summary: string;
  metrics: Record<string, string | number>;
  affectedCaseIds: string[];
}

export interface Proposal {
  id: string;
  createdAt: number;
  trigger: string;
  title: string;
  problem: string;
  suggestedAction: string;
  /** The limits of the reasoning. Rendered as prominently as the finding. */
  caveats: string[];
  evidence: ProposalEvidence;
  status: ProposalStatus;
  decidedAt?: number;
  decisionNote?: string;
  /**
   * A candidate revision and what measuring it showed. Absent means no
   * draft exists — never that one was tried and found unnecessary.
   */
  draft?: ProposalDraft;
}

export interface ProposalDraft {
  /** Null when no drafter was configured. */
  text: string | null;
  summary: string;
  /** Why a draft or its measurement is missing. */
  unavailable: string[];
  /** Absent when the draft was written but never run. */
  verdict?: 'improvement' | 'regression' | 'mixed' | 'no-change' | 'incomparable';
  meanScoreDelta?: number;
  passRateDelta?: number;
}

export function getProposals(status?: ProposalStatus): Promise<Proposal[]> {
  return api.get(`/api/eos/proposals${status ? `?status=${status}` : ''}`);
}

/**
 * Records a founder decision. Approving does not execute the suggested
 * action — the backend engine has no execution path at all. The wording in
 * the UI must not imply otherwise.
 */
export function decideProposal(
  id: string,
  decision: 'approved' | 'rejected',
  note?: string
): Promise<Proposal> {
  return api.post(`/api/eos/proposals/${id}/decide`, { decision, note });
}

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

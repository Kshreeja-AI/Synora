/**
 * Engineering dashboard tests.
 *
 * The property under test is honesty. This page's job is not merely to
 * render numbers — it is to make absent measurement visible, so nobody
 * reads a partial picture as a complete one. These tests assert the
 * distinctions that carry that meaning: instrumented vs observed, and
 * "not token-priced" vs a cost of zero.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EngineeringDashboardPage from '../page';
import * as eosApi from '@/lib/api/eos';

vi.mock('@/lib/api/eos');

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EngineeringDashboardPage />
    </QueryClientProvider>
  );
}

const emptyLatency = {
  current: { count: 0, p50: 0, p95: 0, p99: 0, mean: 0 },
  recentSummaries: [],
};
const emptyErrorRate = {
  current: { errorsInWindow: 0, windowMs: 60_000, threshold: 10 },
  recentAlerts: [],
};
const emptyPrompts = { report: [], recentAlerts: [] };
const emptyCapture = {
  stats: { active: false, datasetId: 'captured-failures', captured: 0, skipped: 0, maxCases: 500 },
  recentCaptures: [],
};
const emptyEvents = { totalEmitted: 0, bufferSize: 1000, listenerCount: 0 };

beforeEach(() => {
  vi.mocked(eosApi.getLatency).mockResolvedValue(emptyLatency);
  vi.mocked(eosApi.getErrorRate).mockResolvedValue(emptyErrorRate);
  vi.mocked(eosApi.getProviderMatrix).mockResolvedValue([]);
  vi.mocked(eosApi.getPromptReport).mockResolvedValue(emptyPrompts);
  vi.mocked(eosApi.getEventStats).mockResolvedValue(emptyEvents);
  vi.mocked(eosApi.getCaptureStatus).mockResolvedValue(emptyCapture);
  vi.mocked(eosApi.getCoverage).mockResolvedValue([]);
  vi.mocked(eosApi.getProposals).mockResolvedValue([]);
  vi.mocked(eosApi.getCostReport).mockResolvedValue({ report: [], recentAlerts: [] });
  vi.mocked(eosApi.getRuntimeCheck).mockResolvedValue(healthyRuntime);
});

const healthyRuntime = {
  entries: [
    {
      component: 'prompt-intelligence',
      eventType: 'ai.prompt.outcome',
      listeners: 1,
      running: true,
      consequenceIfMissing: 'Prompt quality is never tracked, so no regression can ever be detected.',
    },
  ],
  allRunning: true,
  notRunning: [],
  notCoveredByThisCheck: ['memory-collector', 'latency-tracker'],
};

const costEntry = {
  providerId: 'anthropic',
  modelId: 'claude-x',
  requests: 40,
  baselineCostCents: 2,
  recentCostCents: 6,
  ratio: 3,
  baselineSamples: 30,
  sufficientData: true,
  anomalous: true,
  lastObservedAt: Date.now(),
};

describe('EngineeringDashboardPage', () => {
  it('states that measurements reset on restart', async () => {
    renderPage();
    // Without this, a low number reads as "quiet period" rather than
    // "the server restarted".
    expect(await screen.findByText(/reset when the server restarts/i)).toBeInTheDocument();
  });

  it('renders coverage from the backend, not a hardcoded list', async () => {
    vi.mocked(eosApi.getCoverage).mockResolvedValue([
      { promptId: 'chat.generate', label: 'Chat generation', instrumented: true, observed: true },
      { promptId: 'video.generate', label: 'Video generation', instrumented: false, observed: false },
    ]);

    renderPage();

    expect(await screen.findByText('Chat generation')).toBeInTheDocument();
    expect(screen.getByText('Video generation')).toBeInTheDocument();
    expect(screen.getByText('reporting')).toBeInTheDocument();
    expect(screen.getByText('not instrumented')).toBeInTheDocument();
  });

  it('distinguishes a wired path with no traffic from one that is reporting', async () => {
    vi.mocked(eosApi.getCoverage).mockResolvedValue([
      { promptId: 'image.generate', label: 'Image generation', instrumented: true, observed: false },
    ]);

    renderPage();

    // Nothing is deployed yet, so this is the state that matters most:
    // connected but not yet producing data.
    expect(await screen.findByText('wired, no traffic yet')).toBeInTheDocument();
    expect(screen.queryByText('reporting')).not.toBeInTheDocument();
  });

  it('shows "not token-priced" rather than a zero cost for image generation', async () => {
    vi.mocked(eosApi.getProviderMatrix).mockResolvedValue([
      {
        providerId: 'openai',
        modelId: 'gpt-image-1',
        requests: 5,
        successes: 5,
        failures: 0,
        successRate: 1,
        p50LatencyMs: 900,
        p95LatencyMs: 1500,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostCents: 0,
        errorCodes: {},
        tokenPriced: false,
        lastObservedAt: Date.now(),
      },
    ]);

    renderPage();

    // A $0.00 here would read as "free" rather than "not measured this way".
    expect(await screen.findByText('not token-priced')).toBeInTheDocument();
    expect(screen.queryByText('$0.0000')).not.toBeInTheDocument();
  });

  it('shows a real cost for a token-priced provider', async () => {
    vi.mocked(eosApi.getProviderMatrix).mockResolvedValue([
      {
        providerId: 'anthropic',
        modelId: 'claude-x',
        requests: 10,
        successes: 9,
        failures: 1,
        successRate: 0.9,
        p50LatencyMs: 400,
        p95LatencyMs: 800,
        totalInputTokens: 5000,
        totalOutputTokens: 2000,
        totalCostCents: 250,
        errorCodes: { timeout: 1 },
        tokenPriced: true,
        lastObservedAt: Date.now(),
      },
    ]);

    renderPage();

    expect(await screen.findByText('$2.5000')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
  });

  it('shows $0.0000 for a token-priced provider that genuinely cost nothing', async () => {
    vi.mocked(eosApi.getProviderMatrix).mockResolvedValue([
      {
        providerId: 'anthropic',
        modelId: 'claude-x',
        requests: 1,
        successes: 1,
        failures: 0,
        successRate: 1,
        p50LatencyMs: 100,
        p95LatencyMs: 100,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostCents: 0,
        errorCodes: {},
        tokenPriced: true,
        lastObservedAt: Date.now(),
      },
    ]);

    renderPage();

    // The old heuristic inferred "not token-priced" from zero tokens, so it
    // mislabelled this case. tokenPriced is now recorded, not inferred.
    expect(await screen.findByText('$0.0000')).toBeInTheDocument();
    expect(screen.queryByText('not token-priced')).not.toBeInTheDocument();
  });

  it('labels a media cost with its basis and marks it as stated', async () => {
    vi.mocked(eosApi.getProviderMatrix).mockResolvedValue([
      {
        providerId: 'openai',
        modelId: 'gpt-image-1',
        requests: 4,
        successes: 4,
        failures: 0,
        successRate: 1,
        p50LatencyMs: 900,
        p95LatencyMs: 1500,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostCents: 16,
        errorCodes: {},
        tokenPriced: false,
        pricingBasis: 'per-image',
        costProvenance: 'stated',
        lastObservedAt: Date.now(),
      },
    ]);

    renderPage();

    // The figure is real, but it came from a published rate card rather
    // than from the provider's response, and must not read as measured.
    expect(await screen.findByText('$0.1600 (per-image, stated)')).toBeInTheDocument();
    expect(screen.queryByText('not token-priced')).not.toBeInTheDocument();
  });

  it('still shows "not token-priced" for media with no published price', async () => {
    vi.mocked(eosApi.getProviderMatrix).mockResolvedValue([
      {
        providerId: 'openai',
        modelId: 'gpt-image-1',
        requests: 4,
        successes: 4,
        failures: 0,
        successRate: 1,
        p50LatencyMs: 900,
        p95LatencyMs: 1500,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostCents: 0,
        errorCodes: {},
        tokenPriced: false,
        lastObservedAt: Date.now(),
      },
    ]);

    renderPage();

    expect(await screen.findByText('not token-priced')).toBeInTheDocument();
  });

  it('explains that the matrix is empty rather than rendering a bare table', async () => {
    renderPage();
    expect(await screen.findByText(/No provider traffic recorded yet/i)).toBeInTheDocument();
  });

  it('flags regressing prompts', async () => {
    vi.mocked(eosApi.getPromptReport).mockResolvedValue({
      report: [
        {
          promptId: 'chat.generate',
          version: 1,
          executions: 40,
          successes: 30,
          failures: 10,
          successRate: 0.75,
          recentSuccessRate: 0.2,
          p50LatencyMs: 300,
          p95LatencyMs: 900,
          avgInputTokens: 100,
          avgOutputTokens: 50,
          totalCostCents: 40,
          regressing: true,
          lastObservedAt: Date.now(),
        },
      ],
      recentAlerts: [],
    });

    renderPage();

    expect(await screen.findByText('regressing')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
  });

  it('warns at the top of the page when a watcher is not running', async () => {
    vi.mocked(eosApi.getRuntimeCheck).mockResolvedValue({
      entries: [
        {
          component: 'proposal-engine (cost anomalies)',
          eventType: 'alert.cost_anomaly',
          listeners: 0,
          running: false,
          consequenceIfMissing: 'Detected cost rises raise an alert that nothing turns into a proposal.',
        },
      ],
      allRunning: false,
      notRunning: ['proposal-engine (cost anomalies)'],
      notCoveredByThisCheck: [],
    });

    renderPage();

    // The exact failure that prompted this check: components existed, were
    // tested, and were never started. The page must not look calm.
    expect(await screen.findByText(/1 watcher\(s\) are not running/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing was watching/i)).toBeInTheDocument();
    expect(
      screen.getByText(/nothing turns into a proposal/i)
    ).toBeInTheDocument();
  });

  it('shows no alarm banner when every watcher is running', async () => {
    renderPage();

    expect(await screen.findByText(/running \(1 listener/i)).toBeInTheDocument();
    expect(screen.queryByText(/are not running/i)).not.toBeInTheDocument();
  });

  it('names what the watcher check cannot see', async () => {
    renderPage();

    // A green list must not be mistaken for full coverage.
    expect(await screen.findByText(/Not covered by this check: memory-collector/i)).toBeInTheDocument();
  });

  it('flags a cost rise with the multiple it actually measured', async () => {
    vi.mocked(eosApi.getCostReport).mockResolvedValue({ report: [costEntry], recentAlerts: [] });

    renderPage();

    expect(await screen.findByText(/risen 3.0×/i)).toBeInTheDocument();
    expect(screen.getByText('2.0000¢')).toBeInTheDocument();
    expect(screen.getByText('6.0000¢')).toBeInTheDocument();
  });

  it('distinguishes "not enough history" from "steady"', async () => {
    vi.mocked(eosApi.getCostReport).mockResolvedValue({
      report: [
        {
          ...costEntry,
          baselineCostCents: null,
          recentCostCents: null,
          ratio: null,
          baselineSamples: 4,
          sufficientData: false,
          anomalous: false,
        },
      ],
      recentAlerts: [],
    });

    renderPage();

    // "steady" would be a claim of normality the platform has not earned.
    expect(await screen.findByText(/not enough history yet/i)).toBeInTheDocument();
    expect(screen.queryByText('steady')).not.toBeInTheDocument();
    // And an unestablished baseline must not render as a measured zero.
    expect(screen.getAllByText('not established')).toHaveLength(2);
    expect(screen.queryByText('0.0000¢')).not.toBeInTheDocument();
  });

  it('describes a rise from no recorded cost without inventing a multiple', async () => {
    vi.mocked(eosApi.getCostReport).mockResolvedValue({
      report: [{ ...costEntry, baselineCostCents: 0, ratio: null }],
      recentAlerts: [],
    });

    renderPage();

    expect(await screen.findByText(/risen from no recorded cost/i)).toBeInTheDocument();
  });

  it('explains why image and audio never appear in the cost table', async () => {
    renderPage();
    expect(await screen.findByText(/unmeasured rather than zero/i)).toBeInTheDocument();
  });

  it('reports capture as off rather than showing a misleading zero', async () => {
    renderPage();
    // "0 captured" would suggest capture is running and finding nothing.
    expect(await screen.findByText(/Capture is off/i)).toBeInTheDocument();
  });

  it('shows capture counts when it is running', async () => {
    vi.mocked(eosApi.getCaptureStatus).mockResolvedValue({
      stats: { active: true, datasetId: 'ds', captured: 12, skipped: 3, maxCases: 500 },
      recentCaptures: [],
    });

    renderPage();

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText(/Skipped: 3/)).toBeInTheDocument();
  });

  it('renders without crashing when every endpoint fails', async () => {
    const boom = new Error('backend unreachable');
    vi.mocked(eosApi.getLatency).mockRejectedValue(boom);
    vi.mocked(eosApi.getErrorRate).mockRejectedValue(boom);
    vi.mocked(eosApi.getProviderMatrix).mockRejectedValue(boom);
    vi.mocked(eosApi.getPromptReport).mockRejectedValue(boom);
    vi.mocked(eosApi.getEventStats).mockRejectedValue(boom);
    vi.mocked(eosApi.getCaptureStatus).mockRejectedValue(boom);
    vi.mocked(eosApi.getCoverage).mockRejectedValue(boom);
    vi.mocked(eosApi.getProposals).mockRejectedValue(boom);
    vi.mocked(eosApi.getCostReport).mockRejectedValue(boom);
    vi.mocked(eosApi.getRuntimeCheck).mockRejectedValue(boom);

    renderPage();

    // A monitoring page that white-screens when the thing it monitors is
    // down is useless precisely when it is needed.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Engineering' })).toBeInTheDocument();
    });
  });
});

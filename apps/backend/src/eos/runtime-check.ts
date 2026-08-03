import { engineeringEventBus } from './event-bus.js';

/**
 * Checks that the platform's watchers are actually running.
 *
 * WHY THIS EXISTS. Three components — prompt intelligence, the cost
 * monitor, and the proposal engine — were built, tested, exported, exposed
 * over HTTP, and given a founder-facing screen, while never being started
 * by the server. Every test passed, because a test starts the component it
 * is testing. In a real deployment no alert would have fired, no proposal
 * would have been created, and the dashboard would have shown a calm,
 * empty, entirely wrong picture.
 *
 * That failure is invisible to unit tests by construction, so it needs a
 * different kind of check: not "does this work when started?" but "was it
 * started?".
 *
 * HOW IT DECIDES. It asks the event bus how many subscribers are attached
 * to each event type. That is observed evidence, not a declaration — a
 * component cannot report itself healthy while doing nothing, because the
 * count comes from the bus rather than from the component. Zero listeners
 * on an event type means nothing is processing it, whatever the startup
 * code intended.
 *
 * WHAT IT CANNOT SEE, stated rather than hidden. Components driven by a
 * timer rather than a subscription (the memory collector, latency tracker,
 * health collector, and history recorder) attach no listener, so this check
 * is blind to them and says so in its output instead of implying full
 * coverage.
 */

interface ExpectedSubscription {
  component: string;
  eventType: string;
  /** What silently stops working when nothing is listening. */
  consequenceIfMissing: string;
}

/**
 * Every event type that must have a consumer for the platform's
 * intelligence to function. Adding a subscriber-based component without
 * adding it here means this check will not cover it.
 */
export const EXPECTED_SUBSCRIPTIONS: readonly ExpectedSubscription[] = [
  {
    component: 'provider-observatory',
    eventType: 'ai.provider.observation',
    consequenceIfMissing: 'The provider capability matrix stays empty and no provider is ever compared.',
  },
  {
    component: 'prompt-intelligence',
    eventType: 'ai.prompt.outcome',
    consequenceIfMissing: 'Prompt quality is never tracked, so no regression can ever be detected.',
  },
  {
    component: 'proposal-engine (prompt regressions)',
    eventType: 'alert.prompt_regression',
    consequenceIfMissing: 'Detected regressions raise an alert that nothing turns into a proposal.',
  },
  {
    component: 'proposal-engine (cost anomalies)',
    eventType: 'alert.cost_anomaly',
    consequenceIfMissing: 'Detected cost rises raise an alert that nothing turns into a proposal.',
  },
  {
    component: 'proposal-engine (latency drift)',
    eventType: 'alert.latency_drift',
    consequenceIfMissing: 'Detected slowdowns raise an alert that nothing turns into a proposal.',
  },
] as const;

export interface RuntimeCheckEntry {
  component: string;
  eventType: string;
  listeners: number;
  running: boolean;
  consequenceIfMissing: string;
}

export interface RuntimeCheckResult {
  entries: RuntimeCheckEntry[];
  /** True only when every expected subscription has at least one listener. */
  allRunning: boolean;
  notRunning: string[];
  /**
   * Components this check structurally cannot verify, named so the result
   * is not mistaken for full coverage of the platform.
   */
  notCoveredByThisCheck: string[];
}

const TIMER_DRIVEN_COMPONENTS = [
  'memory-collector',
  'latency-tracker',
  'health-collector',
  'history-recorder',
  'queue-depth-collector',
];

export function getRuntimeCheck(): RuntimeCheckResult {
  const entries: RuntimeCheckEntry[] = EXPECTED_SUBSCRIPTIONS.map((expected) => {
    const listeners = engineeringEventBus.listenerCountFor(expected.eventType);
    return {
      component: expected.component,
      eventType: expected.eventType,
      listeners,
      running: listeners > 0,
      consequenceIfMissing: expected.consequenceIfMissing,
    };
  });

  const notRunning = entries.filter((e) => !e.running).map((e) => e.component);

  return {
    entries,
    allRunning: notRunning.length === 0,
    notRunning,
    notCoveredByThisCheck: [...TIMER_DRIVEN_COMPONENTS],
  };
}

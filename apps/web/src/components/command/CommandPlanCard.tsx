'use client';

import Link from 'next/link';
import type { CommandPlan, PlanRunResult, PlanStepState } from '@/lib/api/command';

/**
 * "I understood your request as 4 actions."
 *
 * The reading surface for a multi-action request — before it runs, and
 * after. Both shapes are rendered by this one component on purpose: a
 * person should recognize the same list in the same order whether they are
 * deciding to start it or reading what happened, and two components would
 * drift into showing the same plan two ways.
 *
 * WHAT THIS COMPONENT REFUSES TO DO:
 *
 * It does not reduce a plan to a progress bar. "3 of 4" is a fact; a bar
 * implies the fourth is coming, and when execution has STOPPED that is a
 * promise nobody is keeping.
 *
 * It does not invent a retry button. Whether asking again is safe is a
 * server fact (`safeToRetry`), false the moment anything completed, and a
 * button offered anyway would invite someone to duplicate a side effect.
 *
 * It does not translate the server's wording. Each step's message is
 * rendered verbatim, for the same reason `CommandOutcomeCard` does it: the
 * server is the only thing that knows why a step did not run, and a second
 * wording of the same rule eventually disagrees in front of a user.
 */

/** Plain words for what a step is, never a verdict about it. */
const STEP_LABEL: Record<string, string> = {
  completed: 'Done',
  pending: 'Not started',
  skipped: 'Not attempted',
  'waiting-approval': 'Needs your approval',
  'needs-input': 'One detail missing',
  'not-authorized': 'You cannot do this',
  unavailable: 'Not connected here',
  'not-implemented': 'Synora cannot do this yet',
  'not-bound': 'Do this in the app',
  rejected: 'Refused',
  expired: 'Expired',
  failed: 'Did not work',
};

/**
 * Colour carries the same information as the words, never information the
 * words lack — a person who cannot distinguish these must lose nothing.
 */
const STEP_TONE: Record<string, string> = {
  completed: 'text-emerald-700 dark:text-emerald-400',
  'waiting-approval': 'text-amber-700 dark:text-amber-400',
  'needs-input': 'text-amber-700 dark:text-amber-400',
  failed: 'text-red-700 dark:text-red-400',
  rejected: 'text-red-700 dark:text-red-400',
};

function StepRow({
  index,
  text,
  state,
  message,
  dependsOn,
  appPath,
}: {
  index: number;
  text: string;
  state: PlanStepState;
  message: string;
  dependsOn: number[];
  appPath?: string;
}) {
  return (
    <li className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm">
          <span className="mr-2 text-xs text-muted-foreground">{index}.</span>
          {text}
        </p>
        <span
          className={`shrink-0 text-xs font-medium ${STEP_TONE[state] ?? 'text-muted-foreground'}`}
        >
          {STEP_LABEL[state] ?? state}
        </span>
      </div>
      {message && <p className="mt-1 text-xs text-muted-foreground">{message}</p>}
      {dependsOn.length > 0 && (
        // Stated rather than drawn: a person needs to know this step waits
        // on another, and an arrow between boxes says it less clearly than
        // a sentence does.
        <p className="mt-1 text-xs text-muted-foreground">
          Uses the result of step {dependsOn.join(', ')}.
        </p>
      )}
      {appPath && (
        <Link href={appPath} className="mt-1 inline-block text-xs underline">
          Open the page for this
        </Link>
      )}
    </li>
  );
}

/** The plan BEFORE anything runs. Nothing here has happened. */
export function CommandPlanPreview({
  plan,
  onRun,
  running,
}: {
  plan: CommandPlan;
  onRun?: () => void;
  running?: boolean;
}) {
  if (plan.status === 'cannot-plan') {
    return (
      <section className="rounded-lg border p-4" aria-labelledby="plan-heading">
        <h2 id="plan-heading" className="font-semibold">
          I could not turn that into a plan
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{plan.question}</p>
      </section>
    );
  }

  // Ready means "would run now" — and a step whose input will never exist
  // is not ready however fine it looks on its own.
  const runnable = plan.steps.filter(
    (step) => step.readiness === 'completed' && step.blockedBy === undefined,
  ).length;

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="plan-heading">
      <div>
        <h2 id="plan-heading" className="font-semibold">
          {plan.summary}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing has run yet. This is what Synora understood.
        </p>
      </div>

      {plan.observations.length > 0 && (
        <ul className="space-y-1">
          {plan.observations.map((observation) => (
            <li
              key={observation.kind}
              className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:bg-amber-950/30"
            >
              {observation.detail}
            </li>
          ))}
        </ul>
      )}

      <ol className="space-y-2">
        {plan.steps.map((step) => (
          <StepRow
            key={step.index}
            index={step.index}
            text={step.text}
            state={step.blockedBy !== undefined ? 'skipped' : step.readiness}
            message={step.message}
            dependsOn={step.dependsOn}
            appPath={step.appPath}
          />
        ))}
      </ol>

      {onRun && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onRun}
            disabled={running || runnable === 0}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {running ? 'Running…' : `Run these ${plan.steps.length} actions`}
          </button>
          <span className="text-xs text-muted-foreground">
            {runnable === 0
              ? 'None of these can run right now, so there is nothing to start.'
              : 'Runs in order, and stops at the first one that cannot go ahead.'}
          </span>
        </div>
      )}
    </section>
  );
}

/** The plan AFTER it ran, or stopped. */
export function CommandPlanResult({ result }: { result: PlanRunResult }) {
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="plan-result-heading">
      <div>
        <h2 id="plan-result-heading" className="font-semibold">
          {result.summary}
        </h2>
        {result.stoppedReason && (
          <p className="mt-1 text-sm text-muted-foreground">
            Stopped at step {result.stoppedAtStep}: {result.stoppedReason}
          </p>
        )}
      </div>

      <ol className="space-y-2">
        {result.steps.map((step) => (
          <StepRow
            key={step.index}
            index={step.index}
            text={step.text}
            state={step.state}
            message={step.message}
            dependsOn={step.dependsOn}
          />
        ))}
      </ol>

      {/* Said plainly, and only when true. Someone who re-sends a sentence
          whose first two actions already happened would do them twice. */}
      {!result.safeToRetry && (
        <p className="text-xs text-muted-foreground">
          {result.completedCount === 1 ? 'One action' : `${result.completedCount} actions`} already
          happened, so asking for this again would repeat{' '}
          {result.completedCount === 1 ? 'it' : 'them'}.
        </p>
      )}
    </section>
  );
}

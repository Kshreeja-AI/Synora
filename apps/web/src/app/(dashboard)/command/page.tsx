'use client';

import { useState, type FormEvent } from 'react';
import { Button, Textarea } from '@synora/design-system';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import {
  useCommandExecutions,
  useRunCommand,
  usePlanCommand,
  useRunPlan,
  type CommandOutcome,
  type CommandPlan,
  type PlanRunResult,
} from '@/lib/api/command';
import { CommandOutcomeCard, COMMAND_STATE_LABEL } from '@/components/command/CommandOutcome';
import { CommandPlanPreview, CommandPlanResult } from '@/components/command/CommandPlanCard';
import { PendingApprovals } from '@/components/command/PendingApprovals';

/**
 * Ask Synora for an outcome, in a sentence.
 *
 * The steering wheel for the Universal Command Layer. Everything the layer
 * does has been reachable only by API until now, which meant a person could
 * not use any of it — including the approval gate, which was a state the
 * system could enter and nobody could leave.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT DO:
 *
 * It does not preview before running. Read-only and reversible commands
 * simply run; asking "are you sure?" before a search is how people learn to
 * click through prompts without reading them, and the prompt that finally
 * matters gets the same reflex. Anything that leaves Synora, spends money,
 * or changes who can do what stops on its own and appears below, where the
 * decision is made with full context in view.
 *
 * It does not promise. The input's placeholder shows things Synora can
 * actually do today; a hint suggesting "email the team a summary" would
 * teach a capability that does not exist and be discovered as a lie on
 * first use.
 *
 * It does not translate refusals. Every state's wording comes from the
 * server, which is the only thing that knows why it refused.
 */

/**
 * Examples drawn from CAPABILITIES THAT ARE ACTUALLY BOUND today. When
 * more are bound, this list grows; it must never lead the catalogue.
 */
const EXAMPLES = [
  'Find everything about onboarding',
  'Create a conversation about pricing',
  'Show me how the AI providers have been doing',
];

export default function CommandPage() {
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const [command, setCommand] = useState('');
  const [outcome, setOutcome] = useState<CommandOutcome | null>(null);
  const [plan, setPlan] = useState<CommandPlan | null>(null);
  const [planResult, setPlanResult] = useState<PlanRunResult | null>(null);
  const run = useRunCommand(workspaceId);
  const planIt = usePlanCommand(workspaceId);
  const runPlan = useRunPlan(workspaceId);
  const { data: history } = useCommandExecutions(workspaceId);

  /** Only one answer is ever on screen, so nothing stale reads as current. */
  function clearAnswers() {
    setOutcome(null);
    setPlan(null);
    setPlanResult(null);
  }

  /**
   * Resolve the sentence into steps WITHOUT running any of it.
   *
   * A separate action rather than a confirmation step in front of "Do it":
   * making every search pass through a preview is how people learn to click
   * through prompts, and the prompt that finally matters gets the same
   * reflex. This is for when a person WANTS to see the shape of what they
   * asked for first.
   */
  function preview() {
    const text = command.trim();
    if (!text || !workspaceId) return;
    clearAnswers();
    planIt.mutate(text, { onSuccess: setPlan });
  }

  function startPlan() {
    const text = command.trim();
    if (!text || !workspaceId) return;
    runPlan.mutate(text, {
      onSuccess: (result) => {
        setPlan(null);
        setPlanResult(result);
        if (result.completedCount > 0) setCommand('');
      },
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = command.trim();
    if (!text || !workspaceId) return;
    clearAnswers();
    run.mutate(text, {
      onSuccess: (result) => {
        setOutcome(result);
        // The box is cleared only when something actually ran. After a
        // refusal the person most likely wants to edit what they wrote,
        // and making them retype it punishes them for Synora's limits.
        if (result.executed) setCommand('');
      },
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Ask Synora</h1>
        <p className="text-sm text-muted-foreground">
          Say what you want in your own words. Synora tells you exactly what it did, or exactly why
          it did not.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-3">
        <Textarea
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={EXAMPLES[0]}
          rows={3}
          aria-label="What do you want Synora to do?"
          maxLength={2000}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={run.isPending || !command.trim() || !workspaceId}>
            {run.isPending ? 'Working…' : 'Do it'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={preview}
            disabled={planIt.isPending || !command.trim() || !workspaceId}
          >
            {planIt.isPending ? 'Reading…' : 'See the steps'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Anything that would leave Synora, spend money, or change who can do what stops and asks
            you first.
          </span>
        </div>
      </form>

      <section className="space-y-2" aria-labelledby="examples-heading">
        <h2 id="examples-heading" className="text-sm font-semibold">
          Things Synora can do from a sentence today
        </h2>
        <ul className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => setCommand(example)}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Synora understands far more than this, and will say so plainly when it understands a
          request it cannot yet carry out itself.
        </p>
      </section>

      {run.isError && (
        <p className="text-sm text-muted-foreground">
          That did not reach Synora, so nothing was done. Try again.
        </p>
      )}

      {outcome && <CommandOutcomeCard outcome={outcome} />}

      {plan && (
        <CommandPlanPreview plan={plan} onRun={startPlan} running={runPlan.isPending} />
      )}

      {planResult && <CommandPlanResult result={planResult} />}

      {workspaceId && <PendingApprovals workspaceId={workspaceId} />}

      {history && history.items.length > 0 && (
        <section className="space-y-2" aria-labelledby="history-heading">
          <h2 id="history-heading" className="font-semibold">
            Recently asked
          </h2>
          <ul className="space-y-2 text-sm">
            {history.items.slice(0, 10).map((item) => (
              <li key={item.id} className="rounded-md border p-3">
                <p>{item.commandText}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {COMMAND_STATE_LABEL[item.state] ?? item.state} ·{' '}
                  {new Date(item.createdAt).toLocaleString()}
                </p>
                {item.message && (
                  <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
                )}
              </li>
            ))}
          </ul>
          {/* Refusals are in this list too. A history showing only the
              things that worked would quietly imply Synora succeeds more
              often than it does. */}
          <p className="text-xs text-muted-foreground">
            This includes everything you asked for — the things Synora did and the things it
            declined.
          </p>
        </section>
      )}
    </div>
  );
}

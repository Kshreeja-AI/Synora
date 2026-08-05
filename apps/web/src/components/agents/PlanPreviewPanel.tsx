'use client';

import { Eye, PauseCircle, AlertTriangle } from 'lucide-react';
import type { PlanPreviewReport } from '@/lib/api/agents';
import { RuntimeNotice } from './RuntimeNotice';

/**
 * What a run WOULD do, stated before anything is committed.
 *
 * The report comes from the same planner, validation and per-step checks
 * the real run uses, so this panel never has to soften or interpret —
 * it renders facts: which steps, which would pause for a person, what
 * would fail, and what cannot be known until the run happens. The
 * caveats are rendered in full because a preview that hides its blind
 * spots reads as a guarantee.
 */
export function PlanPreviewPanel({ report }: { report: PlanPreviewReport }) {
  return (
    <section
      className="space-y-3 rounded-md border p-4"
      aria-labelledby="plan-preview-heading"
    >
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4" aria-hidden />
        <h3 id="plan-preview-heading" className="font-semibold">
          Plan preview — nothing has run
        </h3>
      </div>

      <p className="text-sm text-muted-foreground">
        For the task: <span className="italic">“{report.task}”</span>
      </p>

      {/* The exact provenance component every run uses — one labeling
          system, so a previewed local plan can never look more real
          than an executed one. */}
      <RuntimeNotice runtime={report.runtime} />

      {report.blockers.length > 0 && (
        <div className="space-y-1 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <p className="flex items-center gap-1 font-medium">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            This run would not succeed as-is
          </p>
          <ul className="list-inside list-disc">
            {report.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      <ol className="space-y-2">
        {report.steps.map((step, index) => (
          <li key={step.stepId} className="rounded-md border p-3 text-sm">
            <p className="font-medium">
              {index + 1}. {step.description}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {step.kind === 'tool' ? `Calls tool ${step.toolId}` : 'Generates text'}
              {step.treatedAsMutating ? ' · may change things outside the run' : ''}
            </p>
            {step.pausesForApproval && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <PauseCircle className="h-3 w-3" aria-hidden />
                Pauses here and waits for your approval before running
              </p>
            )}
            {step.problems.map((problem) => (
              <p key={problem} className="mt-1 text-xs text-red-700 dark:text-red-300">
                Would fail: {problem}
              </p>
            ))}
            {step.unknowns.map((unknown) => (
              <p key={unknown} className="mt-1 text-xs text-muted-foreground">
                Unknown until it runs: {unknown}
              </p>
            ))}
          </li>
        ))}
      </ol>

      <p className="text-xs text-muted-foreground">
        {report.projected.steps} step(s), {report.projected.toolCalls} tool call(s),{' '}
        {report.projected.approvalPauses} approval pause(s) — within limits of{' '}
        {report.projected.maxSteps} steps and {report.projected.maxToolCalls} tool calls.
      </p>

      <ul className="space-y-1 text-xs text-muted-foreground">
        {report.caveats.map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>
    </section>
  );
}

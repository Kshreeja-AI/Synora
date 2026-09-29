'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileSearch } from 'lucide-react';
import { decideProposal, getProposals, type Proposal } from '@/lib/api/eos';

/**
 * Founder review surface for automated proposals.
 *
 * Two design rules hold this together:
 *
 * 1. Caveats render at the same visual weight as the finding. A proposal
 *    states a correlation, not a diagnosis, and the honesty built into the
 *    data is lost if the limits appear as small grey text under a bold
 *    headline — the reader will skip them and act on a claim the evidence
 *    does not support.
 *
 * 2. The wording never implies execution. Approving records a decision;
 *    the backend engine has no code path that could apply anything. The UI
 *    says so explicitly so approval is never mistaken for a launch button.
 */

const REFRESH_MS = 30_000;

function StatusBadge({ status }: { status: Proposal['status'] }) {
  const tone =
    status === 'approved'
      ? 'bg-emerald-500/10 text-emerald-600'
      : status === 'rejected'
        ? 'bg-muted text-muted-foreground'
        : 'bg-amber-500/10 text-amber-600';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>
  );
}

function Metrics({ metrics }: { metrics: Proposal['evidence']['metrics'] }) {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
      {entries.map(([key, value]) => (
        <div key={key} className="flex justify-between gap-2 border-b border-border/40 py-1">
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="font-medium">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A drafted revision and how it measured.
 *
 * The verdict carries the same visual weight as the draft text, for the
 * same reason the caveats do: a revision shown in a neat box with a small
 * note underneath invites the reader to take the artefact and skip the
 * assessment. An unmeasured draft is marked unproven rather than sitting
 * beside measured ones looking equally credible.
 */
function DraftSection({ draft }: { draft: NonNullable<Proposal['draft']> }) {
  const measured = draft.verdict !== undefined;
  const tone =
    !measured
      ? 'border-border bg-muted/30'
      : draft.verdict === 'improvement'
        ? 'border-emerald-500/50 bg-emerald-500/5'
        : draft.verdict === 'regression'
          ? 'border-red-500/50 bg-red-500/5'
          : 'border-amber-500/50 bg-amber-500/5';

  return (
    <div className={`mt-4 rounded-md border p-3 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Drafted revision</h4>
        <span className="text-sm font-semibold">
          {measured ? `measured: ${draft.verdict}` : 'not measured — unproven'}
        </span>
      </div>

      <p className="mt-2 text-sm">{draft.summary}</p>

      {measured ? (
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          {draft.meanScoreDelta !== undefined ? (
            <span>
              mean score {draft.meanScoreDelta >= 0 ? '+' : ''}
              {draft.meanScoreDelta.toFixed(2)}
            </span>
          ) : null}
          {draft.passRateDelta !== undefined ? (
            <span>
              pass rate {draft.passRateDelta >= 0 ? '+' : ''}
              {Math.round(draft.passRateDelta * 100)}%
            </span>
          ) : null}
        </div>
      ) : null}

      {draft.unavailable.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
          {draft.unavailable.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {draft.text ? (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs">
          {draft.text}
        </pre>
      ) : null}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      decideProposal(proposal.id, decision, note.trim() || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['eos', 'proposals'] });
    },
  });

  const decided = proposal.status !== 'pending';

  return (
    <article className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{proposal.title}</h3>
        <StatusBadge status={proposal.status} />
      </div>

      <p className="mt-2 text-sm">{proposal.problem}</p>

      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Evidence
        </h4>
        <div className="mt-2">
          <Metrics metrics={proposal.evidence.metrics} />
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <FileSearch className="h-4 w-4" />
          {proposal.evidence.affectedCaseIds.length > 0 ? (
            <span>
              {proposal.evidence.affectedCaseIds.length} captured failing case(s):{' '}
              <span className="font-mono text-xs">
                {proposal.evidence.affectedCaseIds.join(', ')}
              </span>
            </span>
          ) : (
            <span>No captured cases are attached to this proposal.</span>
          )}
        </div>
      </div>

      {/*
        Same type size and a full border, not a footnote. A reader who skims
        only the bold text should still hit this block.
      */}
      <div className="mt-4 rounded-md border border-amber-500/50 bg-amber-500/5 p-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <h4 className="text-sm font-semibold text-amber-600">
            What this evidence cannot tell you
          </h4>
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
          {proposal.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Suggested next step
        </h4>
        <p className="mt-1 text-sm">{proposal.suggestedAction}</p>
      </div>

      {proposal.draft ? <DraftSection draft={proposal.draft} /> : null}

      {decided ? (
        <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
          You {proposal.status} this
          {proposal.decidedAt ? ` on ${new Date(proposal.decidedAt).toLocaleString()}` : ''}.
          {proposal.decisionNote ? ` Note: “${proposal.decisionNote}”` : ''}
        </p>
      ) : (
        <div className="mt-4 border-t border-border pt-3">
          <label htmlFor={`note-${proposal.id}`} className="text-xs text-muted-foreground">
            Optional note (recorded with your decision)
          </label>
          <textarea
            id={`note-${proposal.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => decide.mutate('approved')}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => decide.mutate('rejected')}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              Reject
            </button>
            <span className="text-xs text-muted-foreground">
              Approving records your decision. Nothing is applied automatically.
            </span>
          </div>
          {decide.isError ? (
            <p className="mt-2 text-sm text-red-500">
              Could not record that decision: {(decide.error as Error).message}
            </p>
          ) : null}
        </div>
      )}
    </article>
  );
}

export function ProposalsPanel() {
  const proposals = useQuery({
    queryKey: ['eos', 'proposals'],
    queryFn: () => getProposals(),
    refetchInterval: REFRESH_MS,
  });

  const pending = proposals.data?.filter((p) => p.status === 'pending') ?? [];
  const decided = proposals.data?.filter((p) => p.status !== 'pending') ?? [];

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">
          Proposals{pending.length > 0 ? ` (${pending.length} awaiting you)` : ''}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The platform can detect problems and describe what it would do about them. It cannot act
          on any of it. Every proposal waits here for your decision.
        </p>
      </div>
      <div className="space-y-4 p-4">
        {proposals.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !proposals.data?.length ? (
          <p className="text-sm text-muted-foreground">
            No proposals. The platform raises one when it detects a problem it can describe with
            evidence — nothing has met that bar yet.
          </p>
        ) : (
          <>
            {pending.map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} />
            ))}
            {decided.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  {decided.length} already decided
                </summary>
                <div className="mt-4 space-y-4">
                  {decided.map((proposal) => (
                    <ProposalCard key={proposal.id} proposal={proposal} />
                  ))}
                </div>
              </details>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

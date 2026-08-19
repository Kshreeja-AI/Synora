import { assessLicence } from './licences';
import type {
  KnowledgeDocument,
  KnowledgePolicyDecision,
  KnowledgePolicyState,
  KnowledgeSource,
  LicenceId,
} from './types';

/**
 * The licence / usage policy gate.
 *
 * SOURCE → LICENCE CHECK → POLICY DECISION → INGEST
 *
 * ── THE ONE RULE ─────────────────────────────────────────────────────────
 *
 * `UNKNOWN` NEVER BECOMES `ALLOWED`. Not by default, not by fallback, not
 * when the collection looks open, not when the file was easy to download.
 * Absence of a stated licence means all rights reserved — that is the legal
 * default, not a formality — and the single most expensive mistake available
 * here is treating "we didn't find a licence" as "there isn't one".
 *
 * ── WHY FIVE STATES ──────────────────────────────────────────────────────
 *
 * A boolean would force two different situations into one answer:
 *
 *  - `REVIEW_REQUIRED` — the terms are source-specific (a government portal,
 *    a bespoke data agreement) and a person has to read them. Very likely
 *    usable. Not usable YET, and not the same as refused.
 *  - `UNKNOWN` — nobody knows. Also not usable, for a completely different
 *    reason, with a completely different remedy.
 *
 * Collapsing those two loses the information that decides what to do next.
 *
 * `ALLOWED_WITH_ATTRIBUTION` is separated from `ALLOWED` because the
 * obligation has to travel: every chunk indexed under it carries
 * `attributionRequired`, and retrieval refuses to hand back a passage whose
 * attribution it cannot reconstruct.
 *
 * ── PURE AND DATED ───────────────────────────────────────────────────────
 *
 * No I/O, no clock. `decidedAt` is supplied by the caller so the same inputs
 * always produce the same decision — a policy gate that cannot be replayed
 * cannot be audited.
 */

/** Two of the five states permit ingestion. The other three do not. */
const PERMITTING: ReadonlySet<KnowledgePolicyState> = new Set<KnowledgePolicyState>([
  'ALLOWED',
  'ALLOWED_WITH_ATTRIBUTION',
]);

export function permitsIngestion(state: KnowledgePolicyState): boolean {
  return PERMITTING.has(state);
}

function decision(
  state: KnowledgePolicyState,
  licence: LicenceId,
  reason: string,
  rule: string,
  decidedAt: string
): KnowledgePolicyDecision {
  const assessment = assessLicence(licence);
  return {
    state,
    licence,
    ...(assessment.url ? { licenceUrl: assessment.url } : {}),
    attributionRequired: assessment.attributionRequired,
    shareAlike: assessment.shareAlike,
    permitsIngestion: permitsIngestion(state),
    reason,
    decidedAt,
    rule,
  };
}

/**
 * Decide whether one document from one source may be ingested.
 *
 * The rules are applied in order and the FIRST match wins, so the ordering is
 * itself policy: operational refusals (disabled, blocked) come before licence
 * questions, because a switched-off source should not produce a licence
 * argument, and a blocked source should not produce a "review the terms"
 * suggestion when the terms are exactly the problem.
 */
export function decidePolicy(
  source: KnowledgeSource,
  document: Pick<KnowledgeDocument, 'itemLicence'>,
  decidedAt: string
): KnowledgePolicyDecision {
  // 1 ── Operationally switched off. Says nothing about the licence.
  if (!source.enabled) {
    return decision(
      'REFUSED',
      source.licence,
      `source "${source.name}" is disabled for ingestion. This is an operational setting, not a licence judgement.`,
      'source-disabled',
      decidedAt
    );
  }

  // 2 ── Assessed and refused, with the reason already on the record.
  if (source.status === 'blocked') {
    return decision(
      'REFUSED',
      source.licence,
      `source "${source.name}" is blocked: ${source.blockedReason ?? 'no reason recorded'}`,
      'source-blocked',
      decidedAt
    );
  }

  // 3 ── Per-item sources. The collection's licence does NOT transfer to its
  // items, and assuming it does is how a corpus nobody may use gets built.
  if (source.perItemLicenceCheckRequired) {
    if (!document.itemLicence) {
      return decision(
        'UNKNOWN',
        'UNKNOWN',
        `source "${source.name}" licenses items individually and this document declares no itemLicence. ` +
          "The collection's licence does not transfer to its items — arXiv's metadata is CC0 while its papers are not.",
        'per-item-licence-missing',
        decidedAt
      );
    }
    return licenceDecision(document.itemLicence, `item of "${source.name}"`, decidedAt);
  }

  // 4 ── The source's own licence.
  return licenceDecision(source.licence, `source "${source.name}"`, decidedAt);
}

function licenceDecision(
  licence: LicenceId,
  subject: string,
  decidedAt: string
): KnowledgePolicyDecision {
  const assessment = assessLicence(licence);

  if (licence === 'UNKNOWN') {
    return decision(
      'UNKNOWN',
      licence,
      `${subject} states no licence. Absence of a licence means all rights reserved by default — ` +
        'it does not mean the material is free. Nothing was ingested.',
      'licence-unknown',
      decidedAt
    );
  }

  if (assessment.requiresHumanReview) {
    return decision(
      'REVIEW_REQUIRED',
      licence,
      `${subject} is published under portal-specific terms (${assessment.name}). These usually permit ` +
        'commercial reuse with attribution and sometimes do not, so a person must read the actual terms ' +
        'for this source before ingestion proceeds.',
      'terms-require-human-review',
      decidedAt
    );
  }

  if (!assessment.ingestionPermitted) {
    return decision(
      'REFUSED',
      licence,
      `${subject} is licensed ${assessment.name}, which does not permit this use: ${assessment.note}`,
      'licence-forbids-use',
      decidedAt
    );
  }

  return decision(
    assessment.attributionRequired ? 'ALLOWED_WITH_ATTRIBUTION' : 'ALLOWED',
    licence,
    assessment.attributionRequired
      ? `${subject} is licensed ${assessment.name}; ingestion is permitted and every retrieved passage must carry its attribution.`
      : `${subject} is licensed ${assessment.name}; ingestion is permitted with no attribution obligation.`,
    'licence-permits-use',
    decidedAt
  );
}

/**
 * Whether a stored decision still permits SERVING the content.
 *
 * Separate from the ingestion decision because policy can change after the
 * fact: a source is withdrawn, a licence is discovered to be wrong, terms are
 * revised. Retrieval consults this on the stored decision rather than
 * assuming that anything already in the index is still allowed out of it.
 */
export function permitsRetrieval(state: KnowledgePolicyState | undefined): boolean {
  return state !== undefined && permitsIngestion(state);
}

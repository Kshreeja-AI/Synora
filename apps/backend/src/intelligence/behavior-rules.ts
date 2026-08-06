/**
 * SYNORA BEHAVIOR RULES — the platform's own conduct, as data rather than
 * as folklore.
 *
 * THE PROBLEM THIS SOLVES. Twenty slices of work produced a real and
 * consistent set of principles: never claim an action succeeded without
 * verifying it; never let a missing credential read as a missing
 * capability; re-check permission on the path that actually executes.
 * Every one of them lived ONLY as prose in code comments. Prose cannot be
 * queried, cannot be versioned, cannot be evaluated against, and cannot
 * tell you when it has quietly stopped being true. A principle that exists
 * only in a comment is a principle the system does not actually hold.
 *
 * This is the first component of the Intelligence Kernel, and it comes
 * first because the evaluation layer's central question — "did I violate
 * any Synora behavioral rule?" — cannot be asked until the rules are
 * something a program can read.
 *
 * WHAT THIS FILE IS NOT. It is NOT a runtime interceptor, and it does not
 * enforce anything by existing. Enforcement lives where it always did: in
 * the code paths and in the tests that pin them. What this adds is the
 * REGISTRY — a stable identity, a version, a scope and a provenance link
 * for each rule, so the behaviour can be reasoned about, reported on, and
 * later evaluated against.
 *
 * THE PROPERTY THAT MAKES THIS NON-FAKEABLE. A rule may only be marked
 * `enforced` if it names at least one test file that REALLY EXISTS on
 * disk, and a test asserts exactly that. Without it, this file would decay
 * into a wish list — the most comfortable possible lie, because every
 * entry would read like a guarantee. Writing this file, the very first
 * path I recorded from memory was wrong; the filesystem check caught it
 * before the rule was ever published. That is the mechanism working, and
 * it is why the check is not optional.
 *
 * `advisory` and `aspirational` exist so an unproven principle can be
 * recorded honestly instead of being either overstated or omitted. An
 * omitted principle gets forgotten; an overstated one gets relied upon.
 */

/** Where a rule applies. Scopes are areas of the system, not file paths. */
export type RuleScope =
  | 'command-layer'
  | 'authorization'
  | 'credentials'
  | 'execution'
  | 'output'
  | 'memory'
  | 'learning';

/**
 * How bad a violation is.
 *
 * `critical` means a violation would let the system act without authority
 * or report something untrue about what it did — the two failures a person
 * cannot detect from the outside and would therefore act on.
 */
export type RuleSeverity = 'critical' | 'high' | 'medium';

/**
 * How much of a claim this registry is making.
 *
 * enforced      A test proves the system upholds this. The test is named.
 * advisory      Followed by convention and visible in review, but nothing
 *               would fail if it were broken. An honest "we mean this but
 *               have not pinned it".
 * aspirational  A commitment for behaviour that does not exist yet. Named
 *               so it is not forgotten, and explicitly NOT a guarantee.
 */
export type RuleStatus = 'enforced' | 'advisory' | 'aspirational';

export interface BehaviorRule {
  /** Stable across renames and rewordings. Never reused, never renumbered. */
  id: string;
  title: string;
  /** The rule itself, in one sentence, stated as an obligation. */
  statement: string;
  /** Why it exists — the failure it prevents, in terms of a real person. */
  rationale: string;
  scope: RuleScope;
  severity: RuleSeverity;
  status: RuleStatus;
  /**
   * Repo-relative paths to tests that would FAIL if the system stopped
   * upholding this. Required for `enforced`; meaningless otherwise.
   *
   * Deliberately paths rather than test names: test titles get reworded
   * constantly, and a link that breaks on a rewording would be removed
   * rather than repaired.
   */
  enforcedBy: readonly string[];
  /** Which slice established it, so the reasoning can be found later. */
  since: string;
  /** Bumped when the STATEMENT changes meaning, not when wording improves. */
  version: number;
}

export const BEHAVIOR_RULES: readonly BehaviorRule[] = Object.freeze([
  {
    id: 'SB-001',
    title: 'Never claim an action succeeded without verifying it',
    statement:
      'A response may report that something was done only when a real capability actually ran; "executed" is a recorded fact, never an inference from a successful request.',
    rationale:
      'A person who is told something happened stops checking. Every later decision they make rests on it, and they discover the truth from the consequences.',
    scope: 'execution',
    severity: 'critical',
    status: 'enforced',
    enforcedBy: ['apps/backend/src/routes/__tests__/commandExecute.test.ts'],
    since: 'slice 3',
    version: 1,
  },
  {
    id: 'SB-002',
    title: 'A capability nobody wired up is not a failure',
    statement:
      'When Synora can do something but the command layer cannot yet drive it, the answer is `not-bound` — distinct from `failed` and from `not-implemented`.',
    rationale:
      '"It broke" sends someone hunting a bug that does not exist; "Synora cannot do this" slanders working code. Both waste the person and mislead the operator.',
    scope: 'command-layer',
    severity: 'high',
    status: 'enforced',
    enforcedBy: [
      'apps/backend/src/routes/__tests__/commandExecute.test.ts',
      'apps/web/src/components/command/__tests__/CommandOutcome.test.tsx',
    ],
    since: 'slice 3',
    version: 1,
  },
  {
    id: 'SB-003',
    title: 'A missing credential is not a missing capability',
    statement:
      'A capability that is implemented but unconfigured answers `unavailable`, never `not-implemented`; no amount of rephrasing fixes the first and no amount of configuration fixes the second.',
    rationale:
      'These send a person to completely different places — one to an administrator, one to a roadmap. Confusing them wastes whichever journey they take.',
    scope: 'credentials',
    severity: 'high',
    status: 'enforced',
    enforcedBy: [
      'apps/backend/src/routes/__tests__/commandExecute.test.ts',
      'apps/web/src/components/command/__tests__/CommandOutcome.test.tsx',
    ],
    since: 'slice 3',
    version: 1,
  },
  {
    id: 'SB-004',
    title: 'Permission is verified on the path that actually executes',
    statement:
      'Every capability re-checks authorization inside the service that performs the work; a catalogue answer or a middleware the code path never travels through is a courtesy, never a substitute.',
    rationale:
      'The command layer does not travel through HTTP middleware. A capability whose only check lives there is a capability with no check at all.',
    scope: 'authorization',
    severity: 'critical',
    status: 'enforced',
    enforcedBy: ['apps/backend/src/command/__tests__/declaredPermissions.test.ts'],
    since: 'slice 7',
    version: 1,
  },
  {
    id: 'SB-005',
    title: 'Undo re-checks authority at undo time',
    statement:
      'Reversing an action requires permission NOW, checked by the same services that govern the action itself — never inherited from having been allowed to perform it originally.',
    rationale:
      'Roles change. Undo must not become the one path that ignores a demotion.',
    scope: 'authorization',
    severity: 'critical',
    status: 'enforced',
    enforcedBy: ['apps/backend/src/routes/__tests__/commandUndo.test.ts'],
    since: 'slice 19',
    version: 1,
  },
  {
    id: 'SB-006',
    title: 'An approval authorizes exactly one step',
    statement:
      'Approving a step in a multi-step plan never carries authority to any other step; each remaining step re-derives its own capability, permission and approval requirement.',
    rationale:
      '"Approve once, act broadly" is how a harmless-looking first step carries a dangerous last one past the gate.',
    scope: 'authorization',
    severity: 'critical',
    status: 'enforced',
    enforcedBy: ['apps/backend/src/routes/__tests__/commandPlanResume.test.ts'],
    since: 'slice 16',
    version: 1,
  },
  {
    id: 'SB-007',
    title: 'A placeholder is not a credential',
    statement:
      'A secret resolving only to a placeholder value must report the provider as NOT configured, exactly as if the key were absent.',
    rationale:
      'A placeholder that reads as configured produces a provider that looks ready and fails on first real use — the failure lands on a user rather than on a startup check.',
    scope: 'credentials',
    severity: 'critical',
    status: 'enforced',
    enforcedBy: ['apps/backend/src/ai/__tests__/credentialHonesty.test.ts'],
    since: 'slice 13',
    version: 1,
  },
  {
    id: 'SB-008',
    title: 'Where existence is the secret, answer 404 and not 403',
    statement:
      'A resource belonging to another workspace must be indistinguishable from one that does not exist, including in refusal reasons and error codes.',
    rationale:
      'A distinguishable "forbidden" confirms the resource is real. The identifier then becomes a probe for what exists elsewhere.',
    scope: 'authorization',
    severity: 'critical',
    status: 'enforced',
    enforcedBy: ['apps/backend/src/routes/__tests__/commandUndo.test.ts'],
    since: 'Release 2',
    version: 1,
  },
  {
    id: 'SB-009',
    title: 'Accessible output carries the same truth as the visible one',
    statement:
      'Every outcome delivered visually must reach assistive technology with the same distinctions intact, using the same wording the server produced.',
    rationale:
      'Collapsing ten distinct outcomes into silence for one class of user is the same failure as collapsing them into a tick and a cross for everyone.',
    scope: 'output',
    severity: 'high',
    status: 'enforced',
    enforcedBy: ['apps/web/src/components/command/__tests__/CommandAnnouncer.test.tsx'],
    since: 'slice 20',
    version: 1,
  },
  {
    id: 'SB-010',
    title: 'Command text is data, never instruction',
    statement:
      'Text supplied by a person is classified and described; it can never redefine permissions, policy, approval requirements, provider restrictions or execution boundaries, and authority-override phrasing is reported rather than obeyed.',
    rationale:
      'The first thing standing between hostile text and real capabilities must not be something that can be argued with.',
    scope: 'command-layer',
    severity: 'critical',
    status: 'enforced',
    enforcedBy: ['apps/backend/src/command/__tests__/understand.test.ts'],
    since: 'slice 1',
    version: 1,
  },
  {
    id: 'SB-011',
    title: 'Never retry a side effect blindly',
    statement:
      'Where safe retry cannot be proven, the system stops and says so; `safeToRetry` is false the moment anything has completed.',
    rationale:
      'No capability here carries an idempotency key, so a silent retry can create a second schedule or a second conversation that nobody asked for.',
    scope: 'execution',
    severity: 'high',
    status: 'enforced',
    enforcedBy: ['apps/backend/src/routes/__tests__/commandPlanRun.test.ts'],
    since: 'slice 15',
    version: 1,
  },
  {
    id: 'SB-012',
    title: 'Ambiguity is resolved in proportion to consequence',
    statement:
      'A low-consequence ambiguity may be resolved conservatively; a high-consequence one must ask. Missing entities, recipients, dates, destinations and providers are never invented.',
    rationale:
      'A guess that turns out wrong is the one outcome worse than a question, and its cost scales with what the action does.',
    scope: 'command-layer',
    severity: 'critical',
    status: 'enforced',
    enforcedBy: ['apps/backend/src/command/__tests__/resolve.test.ts'],
    since: 'slice 10',
    version: 1,
  },

  // ---- Held to, but not pinned by a test. Stated rather than claimed. ----
  {
    id: 'SB-013',
    title: 'Never write a secret into a log or an audit record',
    statement:
      'Secrets, tokens and credential values never appear in logs, audit rows, error messages or observability output.',
    rationale:
      'Logs travel further than the systems that produce them, and a secret in a log is a secret in every downstream copy of it.',
    scope: 'credentials',
    severity: 'critical',
    // Honest: the discipline is real and visible in review, but there is no
    // test that would fail if someone logged a secret tomorrow. Marking this
    // `enforced` would be the exact overstatement this registry exists to
    // prevent. A scanning test is a candidate for a later slice.
    status: 'advisory',
    enforcedBy: [],
    since: 'Release 1',
    version: 1,
  },
  {
    id: 'SB-014',
    title: 'An interaction is not training data by default',
    statement:
      'No user interaction becomes training material without explicit consent, and consent is revocable.',
    rationale:
      'A person must never become training material by having used the product.',
    scope: 'learning',
    severity: 'critical',
    // The consent RECORD exists and defaults to false
    // (`privacyConsent.service.ts`, `canUseForTraining`). What does not exist
    // is any pipeline that consumes it, because no learning pipeline exists
    // yet. Enforced-in-part is not enforced, so this stays advisory until
    // something could actually violate it.
    status: 'advisory',
    enforcedBy: [],
    since: 'Release 3',
    version: 1,
  },
  {
    id: 'SB-015',
    title: 'Learning never silently changes production behaviour',
    statement:
      'Any change derived from accumulated experience must be versioned, evaluated against a baseline, approved where required, deployable, observable and reversible.',
    rationale:
      'A system that can quietly rewrite its own behaviour cannot be reasoned about, and a regression in it would be discovered by users rather than by operators.',
    scope: 'learning',
    severity: 'critical',
    // Aspirational, and precisely stated as such: there is no learning
    // pipeline at all today. This is recorded now so the constraint exists
    // BEFORE the thing it constrains, rather than being retrofitted onto a
    // pipeline that already shipped without it.
    status: 'aspirational',
    enforcedBy: [],
    since: 'Intelligence Kernel slice 1',
    version: 1,
  },
]);

export function getRule(id: string): BehaviorRule | undefined {
  return BEHAVIOR_RULES.find((rule) => rule.id === id);
}

export function rulesInScope(scope: RuleScope): readonly BehaviorRule[] {
  return BEHAVIOR_RULES.filter((rule) => rule.scope === scope);
}

/** The rules a test would catch a violation of. The rest are commitments. */
export function enforcedRules(): readonly BehaviorRule[] {
  return BEHAVIOR_RULES.filter((rule) => rule.status === 'enforced');
}

export interface RuleCoverage {
  total: number;
  enforced: number;
  advisory: number;
  aspirational: number;
}

/**
 * Counts, deliberately NOT a percentage or a score.
 *
 * A "behavioural compliance: 80%" number would be read as a grade and
 * would immediately start being optimised. These are three separate
 * populations that mean different things, and collapsing them into one
 * figure destroys the only information they carry.
 */
export function ruleCoverage(): RuleCoverage {
  return {
    total: BEHAVIOR_RULES.length,
    enforced: BEHAVIOR_RULES.filter((r) => r.status === 'enforced').length,
    advisory: BEHAVIOR_RULES.filter((r) => r.status === 'advisory').length,
    aspirational: BEHAVIOR_RULES.filter((r) => r.status === 'aspirational').length,
  };
}

import type { CommandIntent, CommandRoute } from './types';

/**
 * What Synora can actually do, expressed as the outcomes a person asks for.
 *
 * EVERY entry names a surface that exists in this repository today. That is
 * the whole discipline of this file: a command layer's characteristic
 * failure is confidently routing a request to a capability that was only
 * ever a plan. A test asserts each `surface` below resolves to a real route
 * or module, so this catalogue cannot drift into fiction unnoticed.
 *
 * `availability` is separate from existence on purpose. "Synora implements
 * image generation" and "this deployment can generate an image right now"
 * are different claims — the second needs a credential — and a person who
 * is told the first when they needed the second has been misled.
 */
const CATALOGUE: Record<Exclude<CommandIntent, 'not-yet-capable' | 'unrecognized'>, CommandRoute[]> = {
  find: [
    {
      capabilityId: 'search.workspace',
      riskClass: 'read-only',
      requiredPermission: null,
      summary: 'Search everything in a workspace — conversations and their messages.',
      availability: 'available',
      surface: 'GET /api/workspaces/:workspaceId/search',
      mayNeedApproval: false,
    },
  ],

  ask: [
    {
      capabilityId: 'ai.generate',
      riskClass: 'reversible',
      requiredPermission: null,
      summary: 'Answer a question or write something using a configured AI provider.',
      // Honest: the deterministic local planner can plan an agent run with no
      // credentials, but answering a question genuinely requires a model.
      availability: 'needs-credentials',
      surface: 'POST /api/ai/generate',
      mayNeedApproval: false,
    },
  ],

  create: [
    {
      capabilityId: 'conversation.create',
      riskClass: 'reversible',
      requiredPermission: 'conversation:create',
      summary: 'Start a new conversation to work in.',
      availability: 'available',
      surface: 'POST /api/workspaces/:workspaceId/conversations',
      mayNeedApproval: false,
    },
    {
      capabilityId: 'image.generate',
      riskClass: 'reversible',
      requiredPermission: null,
      summary: 'Generate an image from a description.',
      availability: 'needs-credentials',
      surface: 'POST /api/images/generate',
      mayNeedApproval: false,
    },
  ],

  automate: [
    {
      capabilityId: 'workflow.author',
      riskClass: 'reversible',
      requiredPermission: 'tool:manage',
      summary: 'Build a repeatable sequence of steps that Synora can run for you.',
      availability: 'available',
      surface: 'POST /api/workspaces/:workspaceId/workflows',
      mayNeedApproval: false,
    },
    {
      capabilityId: 'workflow.schedule',
      riskClass: 'reversible',
      requiredPermission: 'tool:manage',
      summary: 'Run something automatically on a schedule.',
      availability: 'available',
      surface: 'POST /api/workspaces/:workspaceId/workflows/:workflowId/schedules',
      mayNeedApproval: false,
    },
  ],

  plan: [
    {
      capabilityId: 'agent.preview',
      riskClass: 'read-only',
      requiredPermission: null,
      summary: 'Show the plan an agent would follow, without running any of it.',
      // Works with zero credentials: the deterministic local planner produces
      // a real, honestly-labelled plan (`agents/local-runtime.ts`).
      availability: 'available',
      surface: 'POST /api/workspaces/:workspaceId/agents/:agentId/runs/preview',
      mayNeedApproval: false,
    },
  ],

  decide: [
    {
      capabilityId: 'approvals.waiting',
      riskClass: 'read-only',
      requiredPermission: null,
      summary: 'Show everything that is waiting for your decision, and why.',
      availability: 'available',
      // CORRECTED. This previously claimed `.../agents/runs/waiting`, a
      // route that has never existed — the exact failure this file's
      // header says it exists to prevent, committed in this file. The
      // real surface lists runs and the caller selects the paused ones,
      // which is what the home page has always done.
      surface: 'GET /api/workspaces/:workspaceId/agents/runs',
      mayNeedApproval: false,
    },
  ],

  monitor: [
    {
      capabilityId: 'providers.metrics',
      riskClass: 'read-only',
      requiredPermission: null,
      // "monitor" covers two genuinely different questions. Without a hint
      // the first entry answers both, so someone asking what happened in
      // their workspace would get AI provider statistics — a confident
      // answer to a question they did not ask.
      hint: /\b(provider|model|ai|llm|api)\b/i,
      summary: 'Show how AI provider calls have been going — successes, failures, refusals.',
      availability: 'available',
      surface: 'GET /api/ai/provider-metrics',
      mayNeedApproval: false,
    },
    {
      capabilityId: 'activity.recent',
      riskClass: 'read-only',
      // CORRECTED from `audit:view`. The activity feed is deliberately
      // membership-only: it shows a curated ALLOWLIST of work events whose
      // outcomes any member could already see by clicking around.
      // `audit:view` gates the GOVERNANCE log — roles, billing,
      // invitations — which this feed excludes. Declaring the stricter
      // permission told ordinary members they lacked access to something
      // they could in fact use, which is a lie about a person's own
      // permissions even though it errs toward refusing.
      requiredPermission: null,
      hint: /\b(happen(ed|ing)|activity|recent|history|workspace|here|lately)\b/i,
      summary: 'Show what has recently happened in a workspace.',
      availability: 'available',
      surface: 'GET /api/workspaces/:workspaceId/activity',
      mayNeedApproval: false,
    },
  ],

  communicate: [
    {
      capabilityId: 'workspace.invite',
      riskClass: 'sensitive',
      requiredPermission: 'member:invite',
      summary: 'Invite someone to a workspace.',
      // The mail transport defaults to console; a real invitation email
      // needs SMTP configured. Saying "available" would promise a message
      // the recipient never receives.
      availability: 'needs-credentials',
      surface: 'POST /api/workspaces/:workspaceId/invitations',
      mayNeedApproval: false,
    },
  ],

  control: [
    {
      capabilityId: 'tool.execute',
      riskClass: 'sensitive',
      requiredPermission: 'tool:execute',
      summary: 'Run a configured tool — which may contact a system outside Synora.',
      availability: 'available',
      // The one route here that acts outside Synora. Flagged so a command
      // surface can show consequences BEFORE the click, consistent with the
      // tool execution preview that already exists.
      surface: 'POST /api/workspaces/:workspaceId/tools/:toolId/execute',
      mayNeedApproval: true,
    },
  ],
};

export function routesForIntent(intent: CommandIntent): CommandRoute[] {
  if (intent === 'not-yet-capable' || intent === 'unrecognized') return [];
  return CATALOGUE[intent];
}

/** Every surface this catalogue claims. Used by the test that keeps it honest. */
export function allClaimedSurfaces(): string[] {
  return Object.values(CATALOGUE)
    .flat()
    .map((route) => route.surface);
}

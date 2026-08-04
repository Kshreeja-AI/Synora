import type { PlannedStep } from './types.js';

/**
 * Starting configurations for agents and workflows.
 *
 * WHY A TEMPLATE CANNOT NAME A TOOL. Tool ids are per-workspace database
 * rows. A template that named one would produce an agent whose
 * `allowedTools` points at something that does not exist in the workspace
 * it was created in — an agent that looks ready and fails the first time
 * it matters, which is exactly the trap authoring-time validation exists
 * to prevent. So every template here creates a GENERATE-ONLY agent or
 * workflow, and lists the tools it would benefit from as `suggestedTools`:
 * plain capability names for a human to go and wire up, never ids the
 * system would pretend are already connected.
 *
 * WHAT THESE ARE DEFINED BY. Each template exists because of an outcome
 * someone wants — stated in `outcome`, in their words, not ours. They are
 * written for this platform; none is a copy of another product's prompt
 * library, and none claims a capability Synora does not have.
 *
 * WHY THIS IS A CONSTANT AND NOT A STORE. These ship with the platform and
 * are the same in every workspace, so there is nothing per-workspace to
 * persist. Workspace-authored templates ("save this agent as a template")
 * are a separate, genuinely stateful feature, and are named as missing
 * rather than half-built here.
 */

export type TemplateCategory = 'writing' | 'research' | 'analysis' | 'operations' | 'code';

interface TemplateBase {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** The user outcome this exists to serve, stated plainly. */
  outcome: string;
  instructions: string;
  /**
   * Capability names in plain language — NOT tool ids. A template never
   * claims a tool is already connected; it says which would help.
   */
  suggestedTools: string[];
}

export interface AgentTemplate extends TemplateBase {
  kind: 'agent';
}

export interface WorkflowTemplate extends TemplateBase {
  kind: 'workflow';
  /** Generate-only, for the reason in the file comment. */
  steps: PlannedStep[];
}

export type Template = AgentTemplate | WorkflowTemplate;

const step = (id: string, description: string, input: string): PlannedStep => ({
  id,
  kind: 'generate',
  description,
  input,
});

export const TEMPLATES: readonly Template[] = [
  {
    kind: 'agent',
    id: 'tpl_editor',
    name: 'Draft editor',
    description: 'Improves a piece of writing without changing what it says.',
    category: 'writing',
    outcome: 'I wrote something and I want it tightened, not rewritten.',
    instructions:
      'You edit drafts. Preserve the author\'s meaning, argument and voice exactly; ' +
      'improve clarity, structure and concision. Cut what repeats. Do not add claims ' +
      'the draft does not make. When a sentence is ambiguous, say so rather than ' +
      'guessing which reading was meant.',
    suggestedTools: [],
  },
  {
    kind: 'agent',
    id: 'tpl_explainer',
    name: 'Plain-language explainer',
    description: 'Explains something technical to someone who is not technical.',
    category: 'writing',
    outcome: 'I need to explain this to someone without the background I have.',
    instructions:
      'You explain technical material to an intelligent reader who lacks the ' +
      'specialist background. Define a term the first time it appears. Use concrete ' +
      'examples over abstractions. Never simplify to the point of being wrong — where ' +
      'the accurate answer is genuinely complicated, say that, then give the useful ' +
      'approximation and name what it leaves out.',
    suggestedTools: [],
  },
  {
    kind: 'agent',
    id: 'tpl_reviewer',
    name: 'Code reviewer',
    description: 'Reviews a change for defects, not for style preferences.',
    category: 'code',
    outcome: 'I want a second pair of eyes before this goes out.',
    instructions:
      'You review code changes. Prioritise correctness, then failure modes, then ' +
      'maintainability. For each finding, state the concrete input or state that ' +
      'produces the wrong result — a review comment that cannot name a failure is a ' +
      'style preference, and should be marked as one. Do not restate what the code ' +
      'does. Say plainly when you find nothing.',
    suggestedTools: ['a repository or file reader'],
  },
  {
    kind: 'agent',
    id: 'tpl_researcher',
    name: 'Question researcher',
    description: 'Works through an open question and reports what is known and unknown.',
    category: 'research',
    outcome: 'I have a question and want the landscape, not just an answer.',
    instructions:
      'You research open questions. Separate what is established from what is ' +
      'contested from what you do not know — the third category is the one most often ' +
      'omitted and the most useful. Attribute claims to their source when you have ' +
      'one. Never present a plausible-sounding guess with the same confidence as a ' +
      'sourced fact.',
    suggestedTools: ['a web search tool', 'a document or knowledge-base reader'],
  },
  {
    kind: 'workflow',
    id: 'tpl_wf_summarise_decide',
    name: 'Summarise, then extract decisions',
    description: 'Two passes over a document: what it says, then what was decided.',
    category: 'analysis',
    outcome: 'I have a long document and need the decisions out of it.',
    instructions:
      'You process documents in fixed passes. Be literal and complete; do not ' +
      'editorialise or infer intent that is not stated.',
    steps: [
      step('s1', 'Summarise the source material', 'Summarise the material provided, faithfully and without adding anything.'),
      step(
        's2',
        'Extract the decisions from that summary',
        'From {{s1}}, list every decision that was actually made, each with who made it if stated. Say explicitly if no decision was made.',
      ),
    ],
    suggestedTools: ['a document reader'],
  },
  {
    kind: 'workflow',
    id: 'tpl_wf_draft_review',
    name: 'Draft, then self-review',
    description: 'Writes a first draft, then critiques it as a separate step.',
    category: 'writing',
    outcome: 'I want a draft that has already had its obvious problems found.',
    instructions:
      'You draft and then critique. The critique pass is adversarial: its job is to ' +
      'find what is wrong with the draft, not to praise it.',
    steps: [
      step('s1', 'Write the first draft', 'Write a first draft addressing the request.'),
      step(
        's2',
        'Critique the draft',
        'Critique {{s1}}: what is unclear, unsupported, or missing? Be specific and do not soften.',
      ),
      step(
        's3',
        'Revise using the critique',
        'Rewrite {{s1}} addressing every point in {{s2}}. Where a point cannot be addressed, say why.',
      ),
    ],
    suggestedTools: [],
  },
  {
    kind: 'workflow',
    id: 'tpl_wf_weekly_digest',
    name: 'Weekly digest',
    description: 'A repeatable summary pass, suited to running on a schedule.',
    category: 'operations',
    outcome: 'I want the same summary produced every week without me asking.',
    instructions:
      'You produce a recurring digest. The same structure every time, so two weeks ' +
      'can be compared side by side.',
    steps: [
      step('s1', 'Summarise the period', 'Summarise what happened in the period described.'),
      step(
        's2',
        'Pull out what changed and what needs attention',
        'From {{s1}}, list what changed since last time and what needs a decision. If nothing needs attention, say so rather than inventing an item.',
      ),
    ],
    suggestedTools: ['a document reader', 'an email or messaging tool for delivery'],
  },
] as const;

export function listTemplates(kind?: 'agent' | 'workflow'): readonly Template[] {
  return kind ? TEMPLATES.filter((t) => t.kind === kind) : TEMPLATES;
}

export function getTemplate(id: string): Template | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

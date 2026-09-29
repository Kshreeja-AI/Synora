/**
 * Template catalogue tests.
 *
 * The property under test is that a template cannot produce something
 * broken. The specific trap it must never fall into is naming a tool: tool
 * ids are per-workspace database rows, so a template that named one would
 * create a definition pointing at something that may not exist in the
 * workspace it was used in — ready-looking and unrunnable. The catalogue is
 * also checked for the things a user actually reads (an outcome, a
 * description) rather than only for shape.
 */

import { describe, it, expect } from 'vitest';
import { getTemplate, listTemplates, TEMPLATES } from '../templates';
import { validatePlan } from '../run-engine';

describe('the template catalogue', () => {
  it('offers both agent and workflow templates', () => {
    expect(listTemplates('agent').length).toBeGreaterThan(0);
    expect(listTemplates('workflow').length).toBeGreaterThan(0);
    expect(listTemplates()).toHaveLength(TEMPLATES.length);
  });

  it('has unique ids', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names no tool ids anywhere', () => {
    for (const template of TEMPLATES) {
      for (const suggestion of template.suggestedTools) {
        // Suggestions are plain capability names for a human to wire up.
        // Anything that looks like an id would be a promise the system
        // cannot keep in a workspace that does not have that tool.
        expect(suggestion).not.toMatch(/^tool_/);
        expect(suggestion).toMatch(/ /);
      }
    }
  });

  it('gives every template an outcome stated in the user\'s terms', () => {
    for (const template of TEMPLATES) {
      expect(template.outcome.length).toBeGreaterThan(10);
      expect(template.description.length).toBeGreaterThan(10);
      expect(template.instructions.length).toBeGreaterThan(50);
    }
  });

  it('produces workflow steps the run engine would accept', () => {
    for (const template of TEMPLATES) {
      if (template.kind !== 'workflow') continue;
      // The same validation a workflow faces when saved. A template that
      // failed here would be a trap shipped in the product.
      const rejection = validatePlan(
        { steps: template.steps, origin: 'authored' },
        { allowedTools: [], limits: { maxSteps: 20 } },
      );
      expect(rejection).toBeNull();
    }
  });

  it('uses only generate steps, since no tool can be named', () => {
    for (const template of TEMPLATES) {
      if (template.kind !== 'workflow') continue;
      expect(template.steps.every((s) => s.kind === 'generate')).toBe(true);
    }
  });

  it('only references steps that precede the one referencing them', () => {
    for (const template of TEMPLATES) {
      if (template.kind !== 'workflow') continue;
      const seen: string[] = [];
      for (const s of template.steps) {
        for (const [, ref] of s.input.matchAll(/\{\{([^}]+)\}\}/g)) {
          expect(seen).toContain(ref.trim());
        }
        seen.push(s.id);
      }
    }
  });

  it('resolves a template by id and answers null for an unknown one', () => {
    expect(getTemplate(TEMPLATES[0].id)?.id).toBe(TEMPLATES[0].id);
    expect(getTemplate('tpl_nope')).toBeNull();
  });
});

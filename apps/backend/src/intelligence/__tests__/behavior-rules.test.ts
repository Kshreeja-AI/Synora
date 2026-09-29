/**
 * The registry's own integrity.
 *
 * A catalogue of principles is the easiest thing in engineering to write
 * and the easiest to let rot. Every entry reads like a guarantee, and
 * nothing anywhere fails when one stops being true. These tests exist so
 * this file cannot become that.
 *
 * The load-bearing one is `enforced` requiring a test file that REALLY
 * EXISTS. Writing the registry, the first path recorded from memory was
 * wrong — `secrets/__tests__/credentialHonesty.test.ts` instead of
 * `ai/__tests__/`. Nothing but the filesystem would have caught it, and a
 * broken provenance link is worse than no link: it looks like evidence.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BEHAVIOR_RULES,
  enforcedRules,
  getRule,
  ruleCoverage,
  rulesInScope,
} from '../behavior-rules';

// apps/backend/src/intelligence/__tests__ → up five to the repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('behavior rule registry', () => {
  it('gives every enforced rule a test file that actually exists', () => {
    // THE RULE THIS FILE EXISTS FOR. Without it, `enforced` is a word
    // anyone can type, and the registry becomes a wish list wearing the
    // costume of a guarantee.
    const broken: string[] = [];
    for (const rule of enforcedRules()) {
      expect(rule.enforcedBy.length, `${rule.id} is enforced but names no test`).toBeGreaterThan(0);
      for (const path of rule.enforcedBy) {
        if (!existsSync(resolve(REPO_ROOT, path))) broken.push(`${rule.id} → ${path}`);
      }
    }
    expect(broken, `enforced rules pointing at files that do not exist:\n${broken.join('\n')}`).toEqual([]);
  });

  it('does not let an unproven rule claim to be enforced', () => {
    // The inverse, and just as important. A rule with no test must say so
    // rather than quietly borrowing another rule's credibility.
    for (const rule of BEHAVIOR_RULES) {
      if (rule.status !== 'enforced') {
        expect(rule.enforcedBy, `${rule.id} is ${rule.status} but names tests`).toEqual([]);
      }
    }
  });

  it('keeps identifiers unique and stable in shape', () => {
    // Ids are referenced from evaluation results and audit records, so a
    // duplicate would silently merge two different rules' histories.
    const ids = BEHAVIOR_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^SB-\d{3}$/);
  });

  it('states every rule as an obligation with a reason', () => {
    // A rule without a rationale gets deleted by the next person who finds
    // it inconvenient, because nothing records what it was protecting.
    for (const rule of BEHAVIOR_RULES) {
      expect(rule.statement.length, `${rule.id} statement too thin`).toBeGreaterThan(40);
      expect(rule.rationale.length, `${rule.id} rationale too thin`).toBeGreaterThan(40);
      expect(rule.since.length).toBeGreaterThan(0);
      expect(rule.version).toBeGreaterThanOrEqual(1);
    }
  });

  it('reports coverage as counts, never as a score', () => {
    const coverage = ruleCoverage();
    expect(coverage.total).toBe(BEHAVIOR_RULES.length);
    expect(coverage.enforced + coverage.advisory + coverage.aspirational).toBe(coverage.total);
    // A single percentage would be read as a grade and optimised. The three
    // populations mean different things and must stay separable.
    expect(coverage).not.toHaveProperty('score');
    expect(coverage).not.toHaveProperty('percentage');
  });

  it('records the principles the platform actually established', () => {
    // Spot-checks, not an exhaustive list: these are the ones whose absence
    // would mean the registry had drifted away from the real system.
    expect(getRule('SB-001')?.scope).toBe('execution');
    expect(getRule('SB-004')?.severity).toBe('critical');
    expect(getRule('SB-007')?.status).toBe('enforced');
    expect(getRule('SB-999')).toBeUndefined();
    expect(rulesInScope('authorization').map((r) => r.id)).toContain('SB-005');
  });

  it('has not yet claimed any learning rule as enforced', () => {
    // Honesty pin. No learning pipeline exists, so nothing about learning
    // can be enforced — and the day one does exist, this test failing is
    // the reminder to come back and prove it rather than assume it.
    for (const rule of rulesInScope('learning')) {
      expect(rule.status, `${rule.id} claims enforcement without a learning pipeline`).not.toBe(
        'enforced',
      );
    }
  });

  it('is frozen, so nothing can rewrite the rules at runtime', () => {
    // A registry a running process can edit is not a registry. This also
    // forecloses the obvious future mistake: "temporarily" relaxing a rule
    // from inside the code it governs.
    expect(Object.isFrozen(BEHAVIOR_RULES)).toBe(true);
  });
});

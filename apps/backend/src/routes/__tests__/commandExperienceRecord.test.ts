/**
 * The experience record — closing checkpoint 651ece1, which shipped the
 * four columns and their producers with the tests still owed.
 *
 * DB-DEPENDENT: this file needs real PostgreSQL and is part of the
 * deferred set on machines without one. It must never be weakened to pass
 * without a database.
 *
 * The heart of the file is consent semantics: `trainingEligibleAtCapture`
 * is consent AT THE MOMENT of the interaction — captured then, never
 * recomputed. Consent looked up at training time would apply today's
 * answer to last year's words.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../ai/resolver', () => ({
  resolveTextGenerationProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
  resolveProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
}));
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';
import { privacyConsentService } from '../../services/privacyConsent.service';

describe('command execution experience fields', () => {
  let app: Express;
  let ownerCookie: string;
  let ownerId: string;
  let workspaceId: string;
  const testEmails: string[] = [];
  const testWorkspaceIds: string[] = [];

  async function register(prefix: string): Promise<string> {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    testEmails.push(email);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  function execute(command: string) {
    return request(app)
      .post(`/api/command/${workspaceId}/execute`)
      .set('Cookie', ownerCookie)
      .send({ command });
  }

  async function row(executionId: string) {
    return prisma.commandExecution.findUnique({ where: { id: executionId } });
  }

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
    ownerCookie = await register('exp-owner');
    const me = await request(app).get('/api/users/me').set('Cookie', ownerCookie);
    ownerId = me.body.data.id;
    const workspace = await request(app)
      .post('/api/workspaces')
      .set('Cookie', ownerCookie)
      .send({ name: `Experience ${Date.now()}` });
    workspaceId = workspace.body.data.id;
    testWorkspaceIds.push(workspaceId);
  });

  afterAll(async () => {
    await prisma.commandPlan.deleteMany({ where: { workspaceId: { in: testWorkspaceIds } } });
    await prisma.commandExecution.deleteMany({ where: { workspaceId: { in: testWorkspaceIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: testWorkspaceIds } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
  });

  it('records the understander own confidence, differing where it differs', async () => {
    const clear = await execute('Find my notes about onboarding').expect(200);
    const vague = await execute('Find').expect(200);
    const clearRow = await row(clear.body.data.executionId);
    const vagueRow = await row(vague.body.data.executionId);
    // Two phrasings, two confidences — an identical value for both would
    // mean the column records a constant, not the understander.
    expect(clearRow!.confidence).toBe('high');
    expect(vagueRow!.confidence).not.toBe('high');
  });

  it('records latency for an attempted execution, and null for one never attempted', async () => {
    const ran = await execute('Find my notes about latency').expect(200);
    expect((await row(ran.body.data.executionId))!.latencyMs).toBeGreaterThanOrEqual(0);

    const refused = await execute('Email the report to the board').expect(200);
    expect(refused.body.data.state).not.toBe('completed');
    // Nothing ran, so there is no latency to report — null, never a fake 0.
    expect((await row(refused.body.data.executionId))!.latencyMs).toBeNull();
  });

  it('stores the clarification question EXACTLY as the person received it', async () => {
    const res = await execute('Run the tool').expect(200);
    if (res.body.data.state === 'needs-input') {
      const stored = (await row(res.body.data.executionId))!.clarificationQuestion;
      expect(stored).toBe(res.body.data.message);
    } else {
      // No tools exist in this workspace, so the honest state may differ;
      // the completed path must then store null, not an empty string.
      expect((await row(res.body.data.executionId))!.clarificationQuestion).toBeNull();
    }
  });

  it('captures training eligibility at interaction time and NEVER recomputes it', async () => {
    // Default-deny: no consent, not eligible.
    const before = await execute('Find my notes about consent').expect(200);
    expect((await row(before.body.data.executionId))!.trainingEligibleAtCapture).toBe(false);

    // Grant consent, interact: eligible AT CAPTURE.
    await privacyConsentService.setUserConsent(ownerId, workspaceId, { useForTraining: true });
    const during = await execute('Find my notes about consent again').expect(200);
    const duringId = during.body.data.executionId;
    expect((await row(duringId))!.trainingEligibleAtCapture).toBe(true);

    // Revoke consent AFTER: the old row must not change. Consent looked up
    // later would apply today's answer to yesterday's words.
    await privacyConsentService.setUserConsent(ownerId, workspaceId, { useForTraining: false });
    expect((await row(duringId))!.trainingEligibleAtCapture).toBe(true);

    // And the old pre-consent row stayed false throughout.
    expect((await row(before.body.data.executionId))!.trainingEligibleAtCapture).toBe(false);
  });

  it('fails closed: a broken consent lookup records false and the command still works', async () => {
    const spy = vi
      .spyOn(privacyConsentService, 'canUseForTraining')
      .mockRejectedValueOnce(new Error('consent store down'));
    const res = await execute('Find my notes about resilience').expect(200);
    expect(res.body.data.state).toBe('completed');
    expect((await row(res.body.data.executionId))!.trainingEligibleAtCapture).toBe(false);
    spy.mockRestore();
  });
});

/**
 * EOS HTTP surface tests.
 *
 * These exist because of a specific defect: every EOS route once returned a
 * bare `{ data }` body, while the web client requires the platform envelope
 * `{ success: true, data }` and throws on anything else. Every endpoint
 * would have failed on its first call from the dashboard, and nothing in
 * the suite would have noticed, because the engines behind the routes were
 * tested and the routes themselves were not.
 *
 * So the contract under test here is the wire format, the admin gate, and
 * the error shapes — not the engines, which have their own tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Replaced wholesale so the real middleware's database import never loads;
// `allow` lets a single test assert the gate is actually mounted.
const gate = vi.hoisted(() => ({ allow: true }));

vi.mock('../../middleware/requireAdminRole.js', () => ({
  requireAdminRole: (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (!gate.allow) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
      return;
    }
    next();
  },
}));

// vi.mock is hoisted above these by the test transform, so the router
// below is constructed against the stubbed gate, not the real one.
import { eosRouter } from '../routes';
import { startProposalEngine, stopProposalEngine, listProposals } from '../proposal-engine';
import {
  startPromptIntelligence,
  stopPromptIntelligence,
  recordPromptOutcome,
} from '../prompt-intelligence';
import { stopProviderObservatory } from '../provider-observatory';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/eos', eosRouter);
  return app;
}

/** Drives prompt intelligence into a regression, which the engine turns into a proposal. */
function provokeProposal(promptId = 'chat.generate') {
  startPromptIntelligence({ windowSize: 4, dropThreshold: 0.3 });
  startProposalEngine();
  for (let i = 0; i < 16; i++) recordPromptOutcome({ promptId, success: true, latencyMs: 10 });
  for (let i = 0; i < 4; i++) recordPromptOutcome({ promptId, success: false, latencyMs: 10 });
  return listProposals()[0];
}

describe('eos routes', () => {
  beforeEach(() => {
    gate.allow = true;
    stopProposalEngine();
    stopPromptIntelligence();
    stopProviderObservatory();
  });

  describe('response envelope', () => {
    const readEndpoints = [
      '/api/eos/events/stats',
      '/api/eos/events/recent',
      '/api/eos/boot',
      '/api/eos/error-rate',
      '/api/eos/latency',
      '/api/eos/prompt-report',
      '/api/eos/cost-report',
      '/api/eos/latency-drift',
      '/api/eos/degradation',
      '/api/eos/provider-matrix',
      '/api/eos/coverage',
      '/api/eos/runtime-check',
      '/api/eos/launch-readiness',
      '/api/eos/privacy-coverage',
      '/api/eos/evaluation/datasets',
      '/api/eos/evaluation/graders',
      '/api/eos/evaluation/runs',
      '/api/eos/evaluation/capture',
      '/api/eos/proposals',
    ];

    it.each(readEndpoints)('%s returns the platform envelope', async (path) => {
      const res = await request(makeApp()).get(path).expect(200);

      // The web client reads `success` before anything else and throws if it
      // is missing, so this single assertion is what keeps the page working.
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('data');
    });

    it('memory sampling returns the envelope on POST as well', async () => {
      const res = await request(makeApp()).post('/api/eos/memory').expect(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('admin gate', () => {
    it('rejects a caller the gate refuses, before reaching any handler', async () => {
      gate.allow = false;
      const res = await request(makeApp()).get('/api/eos/proposals').expect(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('proposals', () => {
    it('lists proposals with their evidence and caveats intact', async () => {
      const created = provokeProposal();

      const res = await request(makeApp()).get('/api/eos/proposals').expect(200);

      expect(res.body.data).toHaveLength(1);
      const [proposal] = res.body.data;
      expect(proposal.id).toBe(created.id);
      // Caveats and evidence must survive serialisation — they are the
      // reason the proposal can be judged rather than merely obeyed.
      expect(proposal.caveats.length).toBeGreaterThan(0);
      expect(proposal.evidence.metrics).toBeTruthy();
      expect(proposal.status).toBe('pending');
    });

    it('filters by status', async () => {
      provokeProposal();

      const pending = await request(makeApp()).get('/api/eos/proposals?status=pending').expect(200);
      const approved = await request(makeApp()).get('/api/eos/proposals?status=approved').expect(200);

      expect(pending.body.data).toHaveLength(1);
      expect(approved.body.data).toHaveLength(0);
    });

    it('fetches one proposal by id', async () => {
      const created = provokeProposal();

      const res = await request(makeApp()).get(`/api/eos/proposals/${created.id}`).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toContain('chat.generate');
    });

    it('returns a readable error body for an unknown id', async () => {
      const res = await request(makeApp()).get('/api/eos/proposals/nope').expect(404);

      // A bare `{ error: '...' }` would surface in the UI as "undefined",
      // because the client reads `error.message`.
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Proposal not found');
    });
  });

  describe('proposal decisions', () => {
    it('records an approval with a note', async () => {
      const created = provokeProposal();

      const res = await request(makeApp())
        .post(`/api/eos/proposals/${created.id}/decide`)
        .send({ decision: 'approved', note: 'agreed, run the evaluation' })
        .expect(200);

      expect(res.body.data.status).toBe('approved');
      expect(res.body.data.decisionNote).toBe('agreed, run the evaluation');
      expect(res.body.data.decidedAt).toBeGreaterThan(0);
    });

    it('records a rejection', async () => {
      const created = provokeProposal();

      const res = await request(makeApp())
        .post(`/api/eos/proposals/${created.id}/decide`)
        .send({ decision: 'rejected' })
        .expect(200);

      expect(res.body.data.status).toBe('rejected');
    });

    it('approving executes nothing — the decision is a record, not a trigger', async () => {
      const created = provokeProposal();
      const before = JSON.stringify(created.suggestedAction);

      await request(makeApp())
        .post(`/api/eos/proposals/${created.id}/decide`)
        .send({ decision: 'approved' })
        .expect(200);

      const after = await request(makeApp()).get(`/api/eos/proposals/${created.id}`).expect(200);
      // The suggested action is unchanged and unperformed: there is no
      // execution path in the engine for approval to have invoked.
      expect(JSON.stringify(after.body.data.suggestedAction)).toBe(before);
      expect(after.body.data).not.toHaveProperty('applied');
    });

    it('rejects a decision value it does not recognise', async () => {
      const created = provokeProposal();

      const res = await request(makeApp())
        .post(`/api/eos/proposals/${created.id}/decide`)
        .send({ decision: 'maybe' })
        .expect(400);

      expect(res.body.error.message).toMatch(/approved.*rejected/);
    });

    it('rejects a decision with no body at all', async () => {
      const created = provokeProposal();

      await request(makeApp()).post(`/api/eos/proposals/${created.id}/decide`).expect(400);
    });

    it('ignores a non-string note rather than storing it', async () => {
      const created = provokeProposal();

      const res = await request(makeApp())
        .post(`/api/eos/proposals/${created.id}/decide`)
        .send({ decision: 'approved', note: { injected: true } })
        .expect(200);

      expect(res.body.data.decisionNote).toBeUndefined();
    });

    it('returns 404 when deciding on an unknown proposal', async () => {
      const res = await request(makeApp())
        .post('/api/eos/proposals/nope/decide')
        .send({ decision: 'approved' })
        .expect(404);

      expect(res.body.error.message).toBe('Proposal not found');
    });
  });

  describe('evaluation datasets', () => {
    it('returns a readable error body for an unknown dataset', async () => {
      const res = await request(makeApp()).get('/api/eos/evaluation/datasets/nope').expect(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Dataset not found');
    });
  });
});

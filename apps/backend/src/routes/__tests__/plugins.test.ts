import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';
import { resetAgents } from '../../agents/agent-registry';
import { resetRuns } from '../../agents/run-engine';
import {
  InMemoryKeyedStore,
  setAgentDefinitionStore,
  setAgentRunStore,
} from '../../agents/agent-stores';
import { resetWorkflows, setWorkflowStore } from '../../workflows/workflow-registry';
import { resetPlugins, setPluginStore } from '../../plugins/plugin-registry';
import type { AgentDefinition, AgentRun } from '../../agents/types';
import type { WorkflowDefinition } from '../../workflows/types';
import type { InstalledPlugin, PluginManifest } from '../../plugins/types';

vi.mock('../../ai/resolver', () => ({
  resolveTextGenerationProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
  resolveProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
}));

/**
 * Plugin HTTP surface.
 *
 * Two things are proved here. That the refusal to run third-party code
 * reaches the caller as a 400 explaining itself, rather than as a generic
 * failure they would work around by guessing. And that a contribution is
 * real: a plugin's template appears in the workspace's template list and
 * can be instantiated into an actual agent — with disabling the plugin
 * taking it away again immediately.
 */
describe('plugin routes', () => {
  let app: Express;
  const testEmails: string[] = [];
  const testWorkspaceIds: string[] = [];

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
  });

  beforeEach(() => {
    resetAgents();
    resetRuns();
    resetWorkflows();
    resetPlugins();
    setAgentDefinitionStore(new InMemoryKeyedStore<AgentDefinition>());
    setAgentRunStore(new InMemoryKeyedStore<AgentRun>());
    setWorkflowStore(new InMemoryKeyedStore<WorkflowDefinition>());
    setPluginStore(new InMemoryKeyedStore<InstalledPlugin>());
  });

  afterEach(async () => {
    if (testWorkspaceIds.length > 0) {
      await prisma.workspace.deleteMany({ where: { id: { in: testWorkspaceIds } } });
      testWorkspaceIds.length = 0;
    }
    if (testEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
      testEmails.length = 0;
    }
  });

  function cookieHeader(setCookieHeaders: string | string[] | undefined): string {
    const cookies = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : setCookieHeaders
        ? [setCookieHeaders]
        : [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  async function register(prefix: string) {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    testEmails.push(email);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    return { cookie: cookieHeader(res.headers['set-cookie']), userId: res.body.data.user.id as string };
  }

  async function createWorkspace(cookie: string, name: string) {
    const res = await request(app).post('/api/workspaces').set('Cookie', cookie).send({ name });
    testWorkspaceIds.push(res.body.data.id);
    return res.body.data as { id: string };
  }

  const contributedTemplate = {
    kind: 'agent' as const,
    id: 'tpl_acme_sum',
    name: 'Acme summariser',
    description: 'Summarises things.',
    category: 'analysis' as const,
    outcome: 'I want the short version.',
    instructions: 'Summarise faithfully and add nothing at all to the source material.',
    suggestedTools: [],
  };

  function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
      id: 'acme.summariser',
      name: 'Summariser',
      version: '1.0.0',
      description: 'Adds a summarising template.',
      publisher: 'acme',
      permissions: ['templates:contribute'],
      contributions: { templates: [contributedTemplate] },
      ...overrides,
    };
  }

  async function install(cookie: string, workspaceId: string, m: PluginManifest = manifest()) {
    return request(app)
      .post(`/api/workspaces/${workspaceId}/plugins`)
      .set('Cookie', cookie)
      .send({ manifest: m });
  }

  it('installs a declarative plugin and lists it', async () => {
    const owner = await register('plg-install');
    const ws = await createWorkspace(owner.cookie, 'Plugin Co');

    const res = await install(owner.cookie, ws.id);
    expect(res.status).toBe(201);
    expect(res.body.data.state).toBe('enabled');
    expect(res.body.data.grantedPermissions).toEqual(['templates:contribute']);

    const listed = await request(app)
      .get(`/api/workspaces/${ws.id}/plugins`)
      .set('Cookie', owner.cookie);
    expect(listed.body.data.installed).toHaveLength(1);
    // Surfaced so an admin can see what is grantable and what is not,
    // without reading the source.
    expect(listed.body.data.unavailablePermissions).toContain('code:execute');
  });

  it('refuses a plugin that wants to run code, explaining why', async () => {
    const owner = await register('plg-code');
    const ws = await createWorkspace(owner.cookie, 'Plugin Co');

    const res = await install(owner.cookie, ws.id, manifest({ entryPoint: 'index.js' }));

    expect(res.status).toBe(400);
    // A publisher needs to know what to change; "invalid manifest" tells
    // them to guess.
    expect(JSON.stringify(res.body)).toMatch(/cannot do safely yet/);
  });

  it('refuses contributions the plugin did not ask permission for', async () => {
    const owner = await register('plg-perm');
    const ws = await createWorkspace(owner.cookie, 'Plugin Co');

    const res = await install(owner.cookie, ws.id, manifest({ permissions: [] }));

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/without asking for/);
  });

  it('makes a contributed template real: it lists and instantiates', async () => {
    const owner = await register('plg-contrib');
    const ws = await createWorkspace(owner.cookie, 'Plugin Co');
    await install(owner.cookie, ws.id);

    const templates = await request(app)
      .get(`/api/workspaces/${ws.id}/agent-templates`)
      .set('Cookie', owner.cookie);
    expect(templates.body.data.map((t: { id: string }) => t.id)).toContain('tpl_acme_sum');

    const created = await request(app)
      .post(`/api/workspaces/${ws.id}/agent-templates/tpl_acme_sum/instantiate`)
      .set('Cookie', owner.cookie)
      .send({});

    // Not a listing entry that does nothing: it produces a real agent.
    expect(created.status).toBe(201);
    expect(created.body.data.agent.instructions).toBe(contributedTemplate.instructions);
  });

  it('disabling a plugin removes its contributions immediately', async () => {
    const owner = await register('plg-disable');
    const ws = await createWorkspace(owner.cookie, 'Plugin Co');
    await install(owner.cookie, ws.id);

    const disabled = await request(app)
      .patch(`/api/workspaces/${ws.id}/plugins/acme.summariser`)
      .set('Cookie', owner.cookie)
      .send({ enabled: false });
    expect(disabled.body.data.state).toBe('disabled');

    const templates = await request(app)
      .get(`/api/workspaces/${ws.id}/agent-templates`)
      .set('Cookie', owner.cookie);
    expect(templates.body.data.map((t: { id: string }) => t.id)).not.toContain('tpl_acme_sum');

    // And the template can no longer be used, not merely hidden.
    const attempted = await request(app)
      .post(`/api/workspaces/${ws.id}/agent-templates/tpl_acme_sum/instantiate`)
      .set('Cookie', owner.cookie)
      .send({});
    expect(attempted.status).toBe(404);
  });

  it('uninstalls', async () => {
    const owner = await register('plg-uninstall');
    const ws = await createWorkspace(owner.cookie, 'Plugin Co');
    await install(owner.cookie, ws.id);

    const removed = await request(app)
      .delete(`/api/workspaces/${ws.id}/plugins/acme.summariser`)
      .set('Cookie', owner.cookie);
    expect(removed.status).toBe(200);

    const again = await request(app)
      .delete(`/api/workspaces/${ws.id}/plugins/acme.summariser`)
      .set('Cookie', owner.cookie);
    expect(again.status).toBe(404);
  });

  it('requires authentication and hides other workspaces', async () => {
    const owner = await register('plg-auth');
    const stranger = await register('plg-stranger');
    const ws = await createWorkspace(owner.cookie, 'Plugin Co');
    await install(owner.cookie, ws.id);

    expect((await request(app).get(`/api/workspaces/${ws.id}/plugins`)).status).toBe(401);

    const strangerWs = await createWorkspace(stranger.cookie, 'Other Co');
    const crossList = await request(app)
      .get(`/api/workspaces/${strangerWs.id}/plugins`)
      .set('Cookie', stranger.cookie);
    expect(crossList.body.data.installed).toEqual([]);

    const crossDelete = await request(app)
      .delete(`/api/workspaces/${strangerWs.id}/plugins/acme.summariser`)
      .set('Cookie', stranger.cookie);
    expect(crossDelete.status).toBe(404);
  });
});

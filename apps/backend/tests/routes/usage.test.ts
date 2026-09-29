import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@synora/database'
import { initializeApp } from '../../src/index'

/**
 * Workspace usage analytics routes. Seeds assistant messages across
 * two providers with known token/cost values and asserts the
 * aggregation math, range filtering, ledger pagination, and access
 * control.
 */
describe('Usage Analytics Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let token: string
  let conversationId: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: { email: `test-usage-${Date.now()}@example.com`, name: 'Test User' },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: { name: 'Usage WS', slug: `test-ws-usage-${Date.now()}` },
    })
    workspaceId = workspace.id

    await prisma.workspaceMember.create({ data: { userId, workspaceId, role: 'OWNER' } })

    const conversation = await prisma.conversation.create({
      data: { workspaceId, title: 'Usage Chat', provider: 'anthropic', model: 'claude-sonnet-5' },
    })
    conversationId = conversation.id

    // Two anthropic generations + one openai generation with known
    // numbers, plus a user turn (no cost) and an out-of-range
    // generation that must not be counted.
    await prisma.message.createMany({
      data: [
        { conversationId, role: 'USER', content: 'q1' },
        {
          conversationId,
          role: 'ASSISTANT',
          content: 'a1',
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          inputTokens: 100,
          outputTokens: 50,
          costCents: 3,
        },
        {
          conversationId,
          role: 'ASSISTANT',
          content: 'a2',
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          inputTokens: 200,
          outputTokens: 100,
          costCents: 6,
        },
        {
          conversationId,
          role: 'ASSISTANT',
          content: 'a3',
          provider: 'openai',
          model: 'gpt-4o',
          inputTokens: 50,
          outputTokens: 25,
          costCents: 1,
        },
        {
          conversationId,
          role: 'ASSISTANT',
          content: 'ancient',
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          inputTokens: 999,
          outputTokens: 999,
          costCents: 99,
          createdAt: new Date('2020-01-01T00:00:00Z'),
        },
      ],
    })

    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.message.deleteMany({ where: { conversation: { workspaceId } } })
    await prisma.conversation.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('GET /usage/summary', () => {
    it('aggregates tokens and cost across providers for the default range', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/usage/summary`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      const summary = response.body.data
      // The 2020 message is outside the default 30-day window.
      expect(summary.totalInputTokens).toBe(350)
      expect(summary.totalOutputTokens).toBe(175)
      expect(summary.totalCostCents).toBe(10)
      expect(summary.totalMessages).toBe(4) // user turn counts as a message
      expect(summary.totalConversations).toBe(1)
      expect(summary.costByProvider).toEqual({ anthropic: 9, openai: 1 })
      expect(summary.costByModel).toEqual({ 'claude-sonnet-5': 9, 'gpt-4o': 1 })

      // topProviders sorted by cost with percentages of total.
      expect(summary.topProviders[0]).toMatchObject({
        provider: 'anthropic',
        inputTokens: 300,
        outputTokens: 150,
        costCents: 9,
        percentOfTotal: 90,
      })
      expect(summary.topProviders[1]).toMatchObject({ provider: 'openai', percentOfTotal: 10 })
    })

    it('respects an explicit date range', async () => {
      const response = await request(app)
        .get(
          `/api/workspaces/${workspaceId}/usage/summary?from=2019-12-01T00:00:00Z&to=2020-02-01T00:00:00Z`
        )
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.totalCostCents).toBe(99)
      expect(response.body.data.totalInputTokens).toBe(999)
    })

    it('rejects a malformed date', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/usage/summary?from=yesterday`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(400)
    })

    it('requires authentication', async () => {
      await request(app).get(`/api/workspaces/${workspaceId}/usage/summary`).expect(401)
    })

    it('rejects a non-member', async () => {
      const outsider = await prisma.user.create({
        data: { email: `outsider-usage-${Date.now()}@example.com`, name: 'Outsider' },
      })
      const outsiderToken = jwt.sign(
        { userId: outsider.id, workspaceId },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '24h' }
      )

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/usage/summary`)
        .set('Authorization', `Bearer ${outsiderToken}`)

      expect([403, 404]).toContain(response.status)
      await prisma.user.delete({ where: { id: outsider.id } })
    })
  })

  describe('GET /usage/ledger', () => {
    it('lists generation entries newest-first with pagination', async () => {
      const first = await request(app)
        .get(`/api/workspaces/${workspaceId}/usage/ledger?take=2`)
        .set('Authorization', `Bearer ${token}`)

      expect(first.status).toBe(200)
      expect(first.body.data.items).toHaveLength(2)
      expect(first.body.data.total).toBe(3)
      expect(first.body.data.hasMore).toBe(true)
      // Only generations appear — never user turns.
      for (const item of first.body.data.items) {
        expect(item.providerId).toBeDefined()
        expect(item.inputTokens).toBeGreaterThan(0)
      }

      const rest = await request(app)
        .get(`/api/workspaces/${workspaceId}/usage/ledger?skip=2&take=2`)
        .set('Authorization', `Bearer ${token}`)

      expect(rest.body.data.items).toHaveLength(1)
      expect(rest.body.data.hasMore).toBe(false)
    })

    it('caps take at 100', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/usage/ledger?take=5000`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(400)
    })
  })
})

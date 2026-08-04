import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@synora/database'
import { initializeApp } from '../../src/index'

/**
 * Document routes — previously mounted with zero tests, which meant the
 * surface "Save as document" now writes to was entirely unpinned.
 *
 * Two contracts matter here:
 *
 * 1. Documents are USER-scoped. Another user's document 404s (never 403),
 *    even for members of the same workspace.
 *
 * 2. `projectId` is a claim of access, not just a foreign key. The
 *    project timeline is read by bare projectId, so filing into an
 *    inaccessible project would plant this document in another
 *    workspace's project view. Personal projects admit only their owner;
 *    workspace projects admit members; everything else 404s and creates
 *    nothing.
 */
describe('Document Routes', () => {
  let app: any
  let userId: string
  let otherUserId: string
  let workspaceId: string
  let token: string
  let otherToken: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: { email: `test-docs-${Date.now()}@example.com`, name: 'Doc Author' },
    })
    userId = user.id

    const other = await prisma.user.create({
      data: { email: `test-docs-other-${Date.now()}@example.com`, name: 'Someone Else' },
    })
    otherUserId = other.id

    const workspace = await prisma.workspace.create({
      data: { name: 'Docs Workspace', slug: `test-ws-docs-${Date.now()}` },
    })
    workspaceId = workspace.id
    await prisma.workspaceMember.create({ data: { userId, workspaceId, role: 'OWNER' } })

    const secret = process.env.JWT_SECRET || 'test-secret'
    token = jwt.sign({ userId, workspaceId }, secret, { expiresIn: '24h' })
    otherToken = jwt.sign({ userId: otherUserId, workspaceId }, secret, { expiresIn: '24h' })
  })

  afterEach(async () => {
    await prisma.document.deleteMany({ where: { userId: { in: [userId, otherUserId] } } })
    await prisma.project.deleteMany({ where: { userId: { in: [userId, otherUserId] } } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } })
  })

  it('requires authentication', async () => {
    await request(app).get('/api/documents').expect(401)
    await request(app).post('/api/documents').send({ title: 'T', content: 'C' }).expect(401)
  })

  it('creates a document and reads it back', async () => {
    const created = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Meeting notes', content: '# Notes\n\nHello.' })
      .expect(201)

    expect(created.body.data.title).toBe('Meeting notes')
    expect(created.body.data.format).toBe('MARKDOWN')
    expect(created.body.data.projectId).toBeNull()

    const fetched = await request(app)
      .get(`/api/documents/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(fetched.body.data.content).toBe('# Notes\n\nHello.')
  })

  it('lists only the caller\'s documents, most recently touched first', async () => {
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'First', content: 'a' })
      .expect(201)
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Second', content: 'b' })
      .expect(201)
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Not yours', content: 'c' })
      .expect(201)

    const list = await request(app)
      .get('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(list.body.data.map((d: { title: string }) => d.title)).toEqual(['Second', 'First'])
  })

  it("404s another user's document — user-scoped, never shared by accident", async () => {
    const created = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Private', content: 'secret' })
      .expect(201)

    await request(app)
      .get(`/api/documents/${created.body.data.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404)
  })

  it('files a document into an owned personal project', async () => {
    const project = await prisma.project.create({
      data: { userId, name: 'Personal project' },
    })

    const created = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Draft', content: 'body', projectId: project.id })
      .expect(201)

    expect(created.body.data.projectId).toBe(project.id)
  })

  it('files a document into a workspace project the caller is a member of', async () => {
    const project = await prisma.project.create({
      data: { userId, name: 'Team project', workspaceId },
    })

    const created = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Draft', content: 'body', projectId: project.id })
      .expect(201)

    expect(created.body.data.projectId).toBe(project.id)
  })

  it("404s filing into someone else's personal project, and creates nothing", async () => {
    const foreign = await prisma.project.create({
      data: { userId: otherUserId, name: 'Not your project' },
    })

    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Intruder', content: 'body', projectId: foreign.id })
      .expect(404)

    // The failed claim must not leave a half-created document behind.
    const docs = await prisma.document.findMany({ where: { userId } })
    expect(docs).toHaveLength(0)
  })

  it('404s filing into a workspace project of a workspace the caller is not in', async () => {
    const project = await prisma.project.create({
      data: { userId, name: 'Members only', workspaceId },
    })

    // otherUser is not a member of workspaceId.
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Intruder', content: 'body', projectId: project.id })
      .expect(404)
  })

  it('404s a projectId that does not exist', async () => {
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Orphan', content: 'body', projectId: 'proj_does_not_exist' })
      .expect(404)
  })
})

/**
 * The same projectId claim, enforced at the media-generation routes.
 * These previously stored any projectId unchecked — which would have
 * let a caller plant generated media in a project (and therefore a
 * workspace's project timeline) they cannot see.
 */
describe('Media generation projectId isolation', () => {
  let app: any
  let userId: string
  let intruderId: string
  let token: string
  let foreignProjectId: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const owner = await prisma.user.create({
      data: { email: `test-media-owner-${Date.now()}@example.com`, name: 'Owner' },
    })
    userId = owner.id

    const intruder = await prisma.user.create({
      data: { email: `test-media-intruder-${Date.now()}@example.com`, name: 'Intruder' },
    })
    intruderId = intruder.id

    const project = await prisma.project.create({
      data: { userId, name: 'Owner personal project' },
    })
    foreignProjectId = project.id

    token = jwt.sign({ userId: intruderId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.project.deleteMany({ where: { userId: { in: [userId, intruderId] } } })
    await prisma.user.deleteMany({ where: { id: { in: [userId, intruderId] } } })
  })

  it("404s image generation into someone else's project", async () => {
    // 404 must win over 503-no-provider: the access check runs before
    // any provider is consulted, so the response is identical whether or
    // not a provider is configured — no oracle for project existence.
    await request(app)
      .post('/api/images/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'a fox', projectId: foreignProjectId })
      .expect(404)
  })

  it("404s audio generation into someone else's project", async () => {
    await request(app)
      .post('/api/audio/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'hello', projectId: foreignProjectId })
      .expect(404)
  })

  it("404s video generation into someone else's project", async () => {
    await request(app)
      .post('/api/videos/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'a fox running', projectId: foreignProjectId })
      .expect(404)
  })
})

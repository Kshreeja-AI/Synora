import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@synora/database'
import { toolSecretService } from '../../src/services/toolSecret.service'
import { ForbiddenException, NotFoundException, ValidationException } from '@synora/shared'

describe('ToolSecretService', () => {
  let workspaceId: string
  let userId: string
  let toolId: string

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-workspace-${Date.now()}`,
      },
    })
    workspaceId = workspace.id

    await prisma.workspaceMember.create({
      data: {
        userId,
        workspaceId,
        role: 'OWNER',
      },
    })

    const tool = await prisma.toolDefinition.create({
      data: {
        workspaceId,
        name: 'Test Tool',
        displayName: 'Test Tool',
        description: 'A test tool',
        category: 'http',
        type: 'HTTP',
        inputSchema: { type: 'object' },
        config: { apiKey: 'test' },
        createdBy: userId,
      },
    })
    toolId = tool.id
  })

  afterEach(async () => {
    await prisma.toolSecretAuditLog.deleteMany({ where: { workspaceId } })
    await prisma.toolSecret.deleteMany({ where: { workspaceId } })
    await prisma.toolDefinition.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('createSecret', () => {
    it('should create encrypted secret', async () => {
      const result = await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'api-key',
        description: 'OpenAI API Key',
        secretType: 'api_key',
        plaintext: 'sk-1234567890abcdef',
      })

      expect(result.id).toBeDefined()
      expect(result.name).toBe('api-key')
      expect(result.secretType).toBe('api_key')
      expect(result.description).toBe('OpenAI API Key')
      expect(result.toolId).toBe(toolId)
      expect(result.workspaceId).toBe(workspaceId)

      // Plaintext should never be in response
      expect((result as any).plaintext).toBeUndefined()
      expect((result as any).encryptedValue).toBeUndefined()
    })

    it('should reject if user not workspace member', async () => {
      const otherUser = await prisma.user.create({
        data: {
          email: `other-${Date.now()}@example.com`,
          name: 'Other User',
        },
      })

      await expect(
        toolSecretService.createSecret(otherUser.id, {
          toolId,
          workspaceId,
          name: 'api-key',
          secretType: 'api_key',
          plaintext: 'secret',
        })
      ).rejects.toThrow(ForbiddenException)

      await prisma.user.delete({ where: { id: otherUser.id } })
    })

    it('should reject if tool not in workspace', async () => {
      const otherWorkspace = await prisma.workspace.create({
        data: {
          name: 'Other Workspace',
          slug: `other-workspace-${Date.now()}`,
        },
      })
      await prisma.workspaceMember.create({
        data: { userId, workspaceId: otherWorkspace.id, role: 'OWNER' },
      })

      await expect(
        toolSecretService.createSecret(userId, {
          toolId,
          workspaceId: otherWorkspace.id,
          name: 'api-key',
          secretType: 'api_key',
          plaintext: 'secret',
        })
      ).rejects.toThrow(NotFoundException)

      await prisma.workspaceMember.deleteMany({ where: { workspaceId: otherWorkspace.id } })
      await prisma.workspace.delete({ where: { id: otherWorkspace.id } })
    })

    it('should reject duplicate secret names for same tool', async () => {
      await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'api-key',
        secretType: 'api_key',
        plaintext: 'secret1',
      })

      await expect(
        toolSecretService.createSecret(userId, {
          toolId,
          workspaceId,
          name: 'api-key',
          secretType: 'api_key',
          plaintext: 'secret2',
        })
      ).rejects.toThrow(ValidationException)
    })

    it('should support optional expiration', async () => {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      const result = await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'api-key',
        secretType: 'api_key',
        plaintext: 'secret',
        expiresAt,
      })

      expect(result.expiresAt).toEqual(expiresAt)
    })

    it('should audit log creation', async () => {
      const result = await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'api-key',
        secretType: 'api_key',
        plaintext: 'secret',
      })

      const auditLogs = await prisma.toolSecretAuditLog.findMany({
        where: { secretId: result.id },
      })

      expect(auditLogs).toHaveLength(1)
      expect(auditLogs[0].action).toBe('CREATED')
      expect(auditLogs[0].accessedBy).toBe(userId)
    })
  })

  describe('getSecret', () => {
    let secretId: string

    beforeEach(async () => {
      const secret = await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'api-key',
        secretType: 'api_key',
        plaintext: 'sk-1234567890abcdef',
      })
      secretId = secret.id
    })

    it('should decrypt and return plaintext', async () => {
      const result = await toolSecretService.getSecret(userId, secretId, workspaceId)
      expect(result).toBe('sk-1234567890abcdef')
    })

    it('should reject if user not workspace member', async () => {
      const otherUser = await prisma.user.create({
        data: {
          email: `other-${Date.now()}@example.com`,
          name: 'Other User',
        },
      })

      await expect(toolSecretService.getSecret(otherUser.id, secretId, workspaceId)).rejects.toThrow(
        ForbiddenException
      )

      await prisma.user.delete({ where: { id: otherUser.id } })
    })

    it('should reject if secret not in workspace', async () => {
      const otherWorkspace = await prisma.workspace.create({
        data: {
          name: 'Other Workspace',
          slug: `other-workspace-${Date.now()}`,
        },
      })
      await prisma.workspaceMember.create({
        data: { userId, workspaceId: otherWorkspace.id, role: 'OWNER' },
      })

      await expect(toolSecretService.getSecret(userId, secretId, otherWorkspace.id)).rejects.toThrow(
        NotFoundException
      )

      await prisma.workspaceMember.deleteMany({ where: { workspaceId: otherWorkspace.id } })
      await prisma.workspace.delete({ where: { id: otherWorkspace.id } })
    })

    it('should reject if secret expired', async () => {
      const expiredSecret = await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'expired-key',
        secretType: 'api_key',
        plaintext: 'secret',
        expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      })

      await expect(
        toolSecretService.getSecret(userId, expiredSecret.id, workspaceId)
      ).rejects.toThrow(ValidationException)
    })

    it('should audit log access', async () => {
      await toolSecretService.getSecret(userId, secretId, workspaceId)

      const auditLogs = await prisma.toolSecretAuditLog.findMany({
        where: { secretId },
      })

      const accessedLog = auditLogs.find((log) => log.action === 'ACCESSED')
      expect(accessedLog).toBeDefined()
      expect(accessedLog?.accessedBy).toBe(userId)
    })
  })

  describe('getSecretMetadata', () => {
    let secretId: string

    beforeEach(async () => {
      const secret = await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'api-key',
        secretType: 'api_key',
        description: 'Test key',
        plaintext: 'sk-1234567890abcdef',
      })
      secretId = secret.id
    })

    it('should return metadata without plaintext', async () => {
      const result = await toolSecretService.getSecretMetadata(userId, secretId, workspaceId)

      expect(result.id).toBe(secretId)
      expect(result.name).toBe('api-key')
      expect(result.description).toBe('Test key')

      // Plaintext should never be in response
      expect((result as any).plaintext).toBeUndefined()
      expect((result as any).encryptedValue).toBeUndefined()
    })

    it('should reject if user not workspace member', async () => {
      const otherUser = await prisma.user.create({
        data: {
          email: `other-${Date.now()}@example.com`,
          name: 'Other User',
        },
      })

      await expect(
        toolSecretService.getSecretMetadata(otherUser.id, secretId, workspaceId)
      ).rejects.toThrow(ForbiddenException)

      await prisma.user.delete({ where: { id: otherUser.id } })
    })
  })

  describe('listSecrets', () => {
    beforeEach(async () => {
      await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'key-1',
        secretType: 'api_key',
        plaintext: 'secret1',
      })

      await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'key-2',
        secretType: 'api_key',
        plaintext: 'secret2',
      })
    })

    it('should list all secrets for tool', async () => {
      const result = await toolSecretService.listSecrets(userId, toolId, workspaceId)

      expect(result).toHaveLength(2)
      expect(result.map((s) => s.name)).toContain('key-1')
      expect(result.map((s) => s.name)).toContain('key-2')
    })

    it('should reject if user not workspace member', async () => {
      const otherUser = await prisma.user.create({
        data: {
          email: `other-${Date.now()}@example.com`,
          name: 'Other User',
        },
      })

      await expect(toolSecretService.listSecrets(otherUser.id, toolId, workspaceId)).rejects.toThrow(
        ForbiddenException
      )

      await prisma.user.delete({ where: { id: otherUser.id } })
    })

    it('should not expose plaintext in list', async () => {
      const result = await toolSecretService.listSecrets(userId, toolId, workspaceId)

      for (const secret of result) {
        expect((secret as any).plaintext).toBeUndefined()
        expect((secret as any).encryptedValue).toBeUndefined()
      }
    })
  })

  describe('updateSecret', () => {
    let secretId: string

    beforeEach(async () => {
      const secret = await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'api-key',
        secretType: 'api_key',
        description: 'Old description',
        plaintext: 'old-secret',
      })
      secretId = secret.id
    })

    it('should update description', async () => {
      const result = await toolSecretService.updateSecret(userId, secretId, workspaceId, {
        description: 'New description',
      })

      expect(result.description).toBe('New description')
    })

    it('should rotate plaintext', async () => {
      const result = await toolSecretService.updateSecret(userId, secretId, workspaceId, {
        plaintext: 'new-secret',
      })

      const decrypted = await toolSecretService.getSecret(userId, secretId, workspaceId)
      expect(decrypted).toBe('new-secret')
      expect(result.lastRotatedAt).toBeDefined()
      expect(result.isRotationPending).toBe(false)
    })

    it('should reject if user not workspace member', async () => {
      const otherUser = await prisma.user.create({
        data: {
          email: `other-${Date.now()}@example.com`,
          name: 'Other User',
        },
      })

      await expect(
        toolSecretService.updateSecret(otherUser.id, secretId, workspaceId, {
          description: 'New',
        })
      ).rejects.toThrow(ForbiddenException)

      await prisma.user.delete({ where: { id: otherUser.id } })
    })

    it('should audit log rotation', async () => {
      await toolSecretService.updateSecret(userId, secretId, workspaceId, {
        plaintext: 'new-secret',
      })

      const auditLogs = await prisma.toolSecretAuditLog.findMany({
        where: { secretId },
      })

      const rotatedLog = auditLogs.find((log) => log.action === 'ROTATED')
      expect(rotatedLog).toBeDefined()
    })
  })

  describe('deleteSecret', () => {
    let secretId: string

    beforeEach(async () => {
      const secret = await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'api-key',
        secretType: 'api_key',
        plaintext: 'secret',
      })
      secretId = secret.id
    })

    it('should delete secret', async () => {
      await toolSecretService.deleteSecret(userId, secretId, workspaceId)

      const secret = await prisma.toolSecret.findUnique({
        where: { id: secretId },
      })
      expect(secret).toBeNull()
    })

    it('should reject if user not workspace member', async () => {
      const otherUser = await prisma.user.create({
        data: {
          email: `other-${Date.now()}@example.com`,
          name: 'Other User',
        },
      })

      await expect(toolSecretService.deleteSecret(otherUser.id, secretId, workspaceId)).rejects.toThrow(
        ForbiddenException
      )

      await prisma.user.delete({ where: { id: otherUser.id } })
    })

    it('should audit log deletion, surviving the secret it describes', async () => {
      await toolSecretService.deleteSecret(userId, secretId, workspaceId)

      // secretId is set to null by the SetNull FK once the secret is gone,
      // so the surviving record must be found by workspaceId instead.
      const auditLogs = await prisma.toolSecretAuditLog.findMany({
        where: { workspaceId, action: 'DELETED' },
      })

      const deletedLog = auditLogs.find((log) => log.reason?.includes('api-key'))
      expect(deletedLog).toBeDefined()
      expect(deletedLog?.secretId).toBeNull()
    })
  })

  describe('getEncryptedSecretByToolAndName', () => {
    let secretId: string

    beforeEach(async () => {
      const secret = await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'api-key',
        secretType: 'api_key',
        plaintext: 'sk-1234567890abcdef',
      })
      secretId = secret.id
    })

    it('should return decrypted secret', async () => {
      const result = await toolSecretService.getEncryptedSecretByToolAndName(toolId, 'api-key')

      expect(result).not.toBeNull()
      expect(result?.decrypted).toBe('sk-1234567890abcdef')
    })

    it('should return null if secret not found', async () => {
      const result = await toolSecretService.getEncryptedSecretByToolAndName(toolId, 'nonexistent')
      expect(result).toBeNull()
    })

    it('should return null if secret expired', async () => {
      await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'expired-key',
        secretType: 'api_key',
        plaintext: 'secret',
        expiresAt: new Date(Date.now() - 1000),
      })

      const result = await toolSecretService.getEncryptedSecretByToolAndName(toolId, 'expired-key')
      expect(result).toBeNull()
    })
  })

  describe('markForRotation', () => {
    let secretId: string

    beforeEach(async () => {
      const secret = await toolSecretService.createSecret(userId, {
        toolId,
        workspaceId,
        name: 'api-key',
        secretType: 'api_key',
        plaintext: 'secret',
      })
      secretId = secret.id
    })

    it('should mark secret for rotation', async () => {
      const result = await toolSecretService.markForRotation(userId, secretId, workspaceId)

      expect(result.isRotationPending).toBe(true)
    })

    it('should reject if user not workspace member', async () => {
      const otherUser = await prisma.user.create({
        data: {
          email: `other-${Date.now()}@example.com`,
          name: 'Other User',
        },
      })

      await expect(
        toolSecretService.markForRotation(otherUser.id, secretId, workspaceId)
      ).rejects.toThrow(ForbiddenException)

      await prisma.user.delete({ where: { id: otherUser.id } })
    })

    it('should audit log rotation flag', async () => {
      await toolSecretService.markForRotation(userId, secretId, workspaceId)

      const auditLogs = await prisma.toolSecretAuditLog.findMany({
        where: { secretId },
      })

      const rotatedLog = auditLogs.find((log) => log.action === 'ROTATED')
      expect(rotatedLog).toBeDefined()
    })
  })
})

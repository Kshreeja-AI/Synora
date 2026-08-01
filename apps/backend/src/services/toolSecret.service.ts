import { prisma } from '@synora/database'
import { ToolSecret } from '@prisma/client'
import { NotFoundException, ForbiddenException, ValidationException } from '@synora/shared'
import { logger } from '../utils/logger'
import { encryptionService } from '../crypto/encryption.service'

export interface CreateToolSecretInput {
  toolId: string
  workspaceId: string
  name: string
  description?: string
  secretType: string
  plaintext: string
  expiresAt?: Date
}

export interface UpdateToolSecretInput {
  plaintext?: string
  description?: string
  expiresAt?: Date
}

export interface ToolSecretResponse {
  id: string
  toolId: string
  workspaceId: string
  name: string
  description?: string
  secretType: string
  expiresAt?: Date
  isRotationPending: boolean
  lastRotatedAt?: Date
  createdAt: Date
  updatedAt: Date
}

/**
 * Tool Secret Service
 * Manages encrypted secrets for tool execution
 * Handles encryption/decryption, audit logging, and secret lifecycle
 */
export class ToolSecretService {
  /**
   * Create a new encrypted secret
   */
  async createSecret(userId: string, input: CreateToolSecretInput): Promise<ToolSecretResponse> {
    logger.info(`[createSecret] Creating secret for tool ${input.toolId}`, {
      workspaceId: input.workspaceId,
      secretName: input.name,
    })

    // Validate workspace membership
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: input.workspaceId } },
    })
    if (!member) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    // Validate tool exists and belongs to workspace
    const tool = await prisma.toolDefinition.findUnique({
      where: { id: input.toolId },
    })
    if (!tool || tool.workspaceId !== input.workspaceId) {
      throw new NotFoundException('Tool not found')
    }

    // Validate secret name is unique for this tool
    const existing = await prisma.toolSecret.findUnique({
      where: { toolId_name: { toolId: input.toolId, name: input.name } },
    })
    if (existing) {
      throw new ValidationException('Secret with this name already exists for this tool')
    }

    // Encrypt the secret
    const encrypted = encryptionService.encrypt(input.plaintext)

    // Store encrypted secret
    const secret = await prisma.toolSecret.create({
      data: {
        toolId: input.toolId,
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description,
        secretType: input.secretType,
        encryptedValue: encrypted.encryptedValue,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        algorithm: encrypted.algorithm,
        expiresAt: input.expiresAt,
        createdBy: userId,
      },
    })

    // Audit log
    await this.auditLog(
      secret.id,
      input.workspaceId,
      userId,
      'CREATED',
      `Created secret: ${input.name}`
    )

    return this.toResponse(secret)
  }

  /**
   * Get a secret and decrypt it
   * Requires workspace membership and logs access
   */
  async getSecret(userId: string, secretId: string, workspaceId: string): Promise<string> {
    logger.info(`[getSecret] Retrieving secret ${secretId}`, { workspaceId })

    // Validate workspace membership
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })
    if (!member) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    // Fetch encrypted secret
    const secret = await prisma.toolSecret.findUnique({
      where: { id: secretId },
    })
    if (!secret || secret.workspaceId !== workspaceId) {
      throw new NotFoundException('Secret not found')
    }

    // Check expiration
    if (secret.expiresAt && secret.expiresAt < new Date()) {
      throw new ValidationException('Secret has expired')
    }

    // Decrypt
    const decrypted = encryptionService.decrypt({
      encryptedValue: secret.encryptedValue,
      iv: secret.iv,
      authTag: secret.authTag,
      algorithm: secret.algorithm,
    })

    // Audit log access
    await this.auditLog(
      secret.id,
      workspaceId,
      userId,
      'ACCESSED',
      `Retrieved secret: ${secret.name}`
    )

    return decrypted.value
  }

  /**
   * Get secret metadata (without plaintext value)
   */
  async getSecretMetadata(userId: string, secretId: string, workspaceId: string): Promise<ToolSecretResponse> {
    logger.info(`[getSecretMetadata] Retrieving secret metadata ${secretId}`, { workspaceId })

    // Validate workspace membership
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })
    if (!member) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    const secret = await prisma.toolSecret.findUnique({
      where: { id: secretId },
    })
    if (!secret || secret.workspaceId !== workspaceId) {
      throw new NotFoundException('Secret not found')
    }

    return this.toResponse(secret)
  }

  /**
   * List all secrets for a tool (metadata only)
   */
  async listSecrets(userId: string, toolId: string, workspaceId: string): Promise<ToolSecretResponse[]> {
    logger.info(`[listSecrets] Listing secrets for tool ${toolId}`, { workspaceId })

    // Validate workspace membership
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })
    if (!member) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    // Validate tool exists
    const tool = await prisma.toolDefinition.findUnique({
      where: { id: toolId },
    })
    if (!tool || tool.workspaceId !== workspaceId) {
      throw new NotFoundException('Tool not found')
    }

    const secrets = await prisma.toolSecret.findMany({
      where: { toolId, workspaceId },
      orderBy: { createdAt: 'desc' },
    })

    return secrets.map((s) => this.toResponse(s))
  }

  /**
   * Update a secret (plaintext)
   */
  async updateSecret(
    userId: string,
    secretId: string,
    workspaceId: string,
    input: UpdateToolSecretInput
  ): Promise<ToolSecretResponse> {
    logger.info(`[updateSecret] Updating secret ${secretId}`, { workspaceId })

    // Validate workspace membership
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })
    if (!member) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    const secret = await prisma.toolSecret.findUnique({
      where: { id: secretId },
    })
    if (!secret || secret.workspaceId !== workspaceId) {
      throw new NotFoundException('Secret not found')
    }

    const updateData: any = {}

    if (input.description !== undefined) {
      updateData.description = input.description
    }

    if (input.expiresAt !== undefined) {
      updateData.expiresAt = input.expiresAt
    }

    if (input.plaintext !== undefined) {
      const encrypted = encryptionService.encrypt(input.plaintext)
      updateData.encryptedValue = encrypted.encryptedValue
      updateData.iv = encrypted.iv
      updateData.authTag = encrypted.authTag
      updateData.lastRotatedAt = new Date()
      updateData.isRotationPending = false
    }

    const updated = await prisma.toolSecret.update({
      where: { id: secretId },
      data: updateData,
    })

    // Audit log
    await this.auditLog(
      secret.id,
      workspaceId,
      userId,
      input.plaintext ? 'ROTATED' : 'UPDATED',
      `Updated secret: ${secret.name}`
    )

    return this.toResponse(updated)
  }

  /**
   * Delete a secret
   */
  async deleteSecret(userId: string, secretId: string, workspaceId: string): Promise<void> {
    logger.info(`[deleteSecret] Deleting secret ${secretId}`, { workspaceId })

    // Validate workspace membership
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })
    if (!member) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    const secret = await prisma.toolSecret.findUnique({
      where: { id: secretId },
    })
    if (!secret || secret.workspaceId !== workspaceId) {
      throw new NotFoundException('Secret not found')
    }

    // Audit log before deletion
    await this.auditLog(
      secret.id,
      workspaceId,
      userId,
      'DELETED',
      `Deleted secret: ${secret.name}`
    )

    // Delete secret (cascades to audit logs)
    await prisma.toolSecret.delete({
      where: { id: secretId },
    })
  }

  /**
   * Internal: Get encrypted secret by tool and name (for tool execution)
   */
  async getEncryptedSecretByToolAndName(
    toolId: string,
    secretName: string
  ): Promise<{ decrypted: string } | null> {
    const secret = await prisma.toolSecret.findUnique({
      where: { toolId_name: { toolId, name: secretName } },
    })

    if (!secret) {
      return null
    }

    // Check expiration
    if (secret.expiresAt && secret.expiresAt < new Date()) {
      logger.warn('[getEncryptedSecretByToolAndName] Secret has expired', {
        toolId,
        secretName,
      })
      return null
    }

    // Decrypt
    const decrypted = encryptionService.decrypt({
      encryptedValue: secret.encryptedValue,
      iv: secret.iv,
      authTag: secret.authTag,
      algorithm: secret.algorithm,
    })

    return { decrypted: decrypted.value }
  }

  /**
   * Rotate a secret (mark for rotation and update expiration)
   */
  async markForRotation(userId: string, secretId: string, workspaceId: string): Promise<ToolSecretResponse> {
    logger.info(`[markForRotation] Marking secret for rotation ${secretId}`, { workspaceId })

    // Validate workspace membership
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })
    if (!member) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    const secret = await prisma.toolSecret.findUnique({
      where: { id: secretId },
    })
    if (!secret || secret.workspaceId !== workspaceId) {
      throw new NotFoundException('Secret not found')
    }

    const updated = await prisma.toolSecret.update({
      where: { id: secretId },
      data: {
        isRotationPending: true,
      },
    })

    // Audit log
    await this.auditLog(
      secret.id,
      workspaceId,
      userId,
      'ROTATED',
      `Marked for rotation: ${secret.name}`
    )

    return this.toResponse(updated)
  }

  /**
   * Internal: Record audit log entry
   */
  private async auditLog(
    secretId: string,
    workspaceId: string,
    userId: string,
    action: string,
    reason?: string
  ): Promise<void> {
    try {
      await prisma.toolSecretAuditLog.create({
        data: {
          secretId,
          workspaceId,
          action,
          reason,
          accessedBy: userId,
          // requestId and ipAddress would come from request middleware in routes
        },
      })
    } catch (error) {
      logger.error('[auditLog] Failed to create audit log', { error, secretId })
      // Don't throw - audit log failure shouldn't break the operation
    }
  }

  /**
   * Convert database model to response DTO (never exposes plaintext)
   */
  private toResponse(secret: ToolSecret): ToolSecretResponse {
    return {
      id: secret.id,
      toolId: secret.toolId,
      workspaceId: secret.workspaceId,
      name: secret.name,
      description: secret.description ?? undefined,
      secretType: secret.secretType,
      expiresAt: secret.expiresAt ?? undefined,
      isRotationPending: secret.isRotationPending,
      lastRotatedAt: secret.lastRotatedAt ?? undefined,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
    }
  }
}

export const toolSecretService = new ToolSecretService()

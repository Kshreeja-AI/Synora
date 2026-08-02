import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import { evaluationService } from '../evaluation.service';
import { NotFoundException, ValidationException } from '@synora/shared';

describe('evaluation.service', () => {
  const testWorkspaceIds: string[] = [];
  const testDatasetIds: string[] = [];
  const testModelIds: string[] = [];
  let workspaceId: string;
  let datasetId: string;
  let modelId: string;
  let ownerId: string;

  beforeAll(async () => {
    await initConfig();
  });

  beforeEach(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: 'Test Workspace', slug: `test-${Date.now()}-${Math.random()}` },
    });
    workspaceId = workspace.id;
    testWorkspaceIds.push(workspaceId);

    const owner = await prisma.user.create({
      data: { email: `owner-${Date.now()}-${Math.random()}@test.com`, password: 'hashed' },
    });
    ownerId = owner.id;

    await prisma.workspaceMember.create({
      data: { workspaceId, userId: ownerId, role: 'OWNER' },
    });

    const dataset = await prisma.dataset.create({
      data: { workspaceId, name: 'Test Dataset', datasetType: 'SFT', createdBy: ownerId },
    });
    datasetId = dataset.id;
    testDatasetIds.push(datasetId);

    const model = await prisma.modelRegistry.create({
      data: { workspaceId, providerId: 'anthropic', modelName: 'claude-test' },
    });
    modelId = model.id;
    testModelIds.push(modelId);
  });

  afterEach(async () => {
    if (testDatasetIds.length > 0) {
      await prisma.evaluationRun.deleteMany({ where: { datasetId: { in: testDatasetIds } } });
      await prisma.dataset.deleteMany({ where: { id: { in: testDatasetIds } } });
      testDatasetIds.length = 0;
    }
    if (testModelIds.length > 0) {
      await prisma.modelRegistry.deleteMany({ where: { id: { in: testModelIds } } });
      testModelIds.length = 0;
    }
    if (testWorkspaceIds.length > 0) {
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: testWorkspaceIds } } });
      await prisma.workspace.deleteMany({ where: { id: { in: testWorkspaceIds } } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      testWorkspaceIds.length = 0;
    }
  });

  describe('createEvaluationRun', () => {
    it('creates a run for supported metrics', async () => {
      const result = await evaluationService.createEvaluationRun(ownerId, workspaceId, {
        datasetId,
        modelId,
        metrics: ['ACCURACY', 'BLEU'],
      });

      expect(result.status).toBe('PENDING');
    });

    it('rejects PERPLEXITY rather than silently computing a random value', async () => {
      await expect(
        evaluationService.createEvaluationRun(ownerId, workspaceId, {
          datasetId,
          modelId,
          metrics: ['ACCURACY', 'PERPLEXITY'],
        })
      ).rejects.toThrow(ValidationException);

      const runs = await prisma.evaluationRun.findMany({ where: { datasetId } });
      expect(runs).toHaveLength(0);
    });

    it('rejects PERPLEXITY case-insensitively', async () => {
      await expect(
        evaluationService.createEvaluationRun(ownerId, workspaceId, {
          datasetId,
          modelId,
          metrics: ['perplexity'],
        })
      ).rejects.toThrow(/PERPLEXITY/);
    });

    it('throws NotFoundException for a non-existent model', async () => {
      await expect(
        evaluationService.createEvaluationRun(ownerId, workspaceId, {
          datasetId,
          modelId: 'nonexistent',
          metrics: ['ACCURACY'],
        })
      ).rejects.toThrow(NotFoundException);
    });
  });
});

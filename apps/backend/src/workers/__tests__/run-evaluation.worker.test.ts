import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import { processRunEvaluation } from '../run-evaluation.worker';
import { NoProviderConfiguredError } from '../../ai/types';

vi.mock('../../ai/resolver', () => ({
  resolveProvider: vi.fn(),
}));

describe('run-evaluation.worker', () => {
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
    vi.clearAllMocks();

    const workspace = await prisma.workspace.create({
      data: { name: 'Test Workspace', slug: `test-${Date.now()}-${Math.random()}` },
    });
    workspaceId = workspace.id;
    testWorkspaceIds.push(workspaceId);

    const owner = await prisma.user.create({
      data: { email: `owner-${Date.now()}-${Math.random()}@test.com`, password: 'hashed' },
    });
    ownerId = owner.id;

    const dataset = await prisma.dataset.create({
      data: { workspaceId, name: 'Test Dataset', datasetType: 'SFT', createdBy: ownerId },
    });
    datasetId = dataset.id;
    testDatasetIds.push(datasetId);

    await prisma.datasetSample.create({
      data: {
        datasetId,
        sourceType: 'SYNTHETIC',
        input: 'What is the capital of France?',
        output: 'Paris',
        inputTokens: 8,
        outputTokens: 1,
      },
    });

    const model = await prisma.modelRegistry.create({
      data: { workspaceId, providerId: 'anthropic', modelName: 'claude-test' },
    });
    modelId = model.id;
    testModelIds.push(modelId);
  });

  afterEach(async () => {
    if (testDatasetIds.length > 0) {
      await prisma.evaluationResult.deleteMany({
        where: { evaluationRun: { datasetId: { in: testDatasetIds } } },
      });
      await prisma.evaluationRun.deleteMany({ where: { datasetId: { in: testDatasetIds } } });
      await prisma.datasetSample.deleteMany({ where: { datasetId: { in: testDatasetIds } } });
      await prisma.dataset.deleteMany({ where: { id: { in: testDatasetIds } } });
      testDatasetIds.length = 0;
    }
    if (testModelIds.length > 0) {
      await prisma.modelRegistry.deleteMany({ where: { id: { in: testModelIds } } });
      testModelIds.length = 0;
    }
    if (testWorkspaceIds.length > 0) {
      await prisma.workspace.deleteMany({ where: { id: { in: testWorkspaceIds } } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      testWorkspaceIds.length = 0;
    }
  });

  async function createEvaluationRun(metrics: string[]) {
    return prisma.evaluationRun.create({
      data: {
        workspaceId,
        datasetId,
        modelId,
        modelVersion: '1.0.0',
        evaluationType: 'ACCURACY',
        metrics,
        status: 'PENDING',
      },
    });
  }

  it('re-derives datasetId/modelId/metrics from the EvaluationRun record, not the job payload', async () => {
    const { resolveProvider } = await import('../../ai/resolver');
    vi.mocked(resolveProvider).mockResolvedValue({
      id: 'anthropic',
      capabilities: ['text-generation'],
      generateText: vi.fn().mockResolvedValue({ text: 'Paris', provider: 'anthropic', model: 'claude-test' }),
    } as never);

    const run = await createEvaluationRun(['ACCURACY']);

    await processRunEvaluation({
      evaluationRunId: run.id,
      datasetId: 'wrong-dataset-id-from-stale-payload',
      modelId: 'wrong-model-id-from-stale-payload',
      workspaceId,
      userId: ownerId,
      metrics: [],
    });

    expect(resolveProvider).toHaveBeenCalledWith('text-generation', { explicitProviderId: 'anthropic' });

    const updated = await prisma.evaluationRun.findUnique({ where: { id: run.id } });
    expect(updated?.status).toBe('COMPLETED');

    const results = await prisma.evaluationResult.findMany({ where: { evaluationRunId: run.id } });
    expect(results).toHaveLength(1);
    expect(results[0].prediction).toBe('Paris');
  });

  it('calls the real AI provider with the sample input and the registered model name', async () => {
    const { resolveProvider } = await import('../../ai/resolver');
    const generateText = vi.fn().mockResolvedValue({ text: 'Paris', provider: 'anthropic', model: 'claude-test' });
    vi.mocked(resolveProvider).mockResolvedValue({
      id: 'anthropic',
      capabilities: ['text-generation'],
      generateText,
    } as never);

    const run = await createEvaluationRun(['ACCURACY']);

    await processRunEvaluation({
      evaluationRunId: run.id,
      datasetId,
      modelId,
      workspaceId,
      userId: ownerId,
      metrics: ['ACCURACY'],
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'What is the capital of France?', model: 'claude-test' })
    );

    const results = await prisma.evaluationResult.findMany({ where: { evaluationRunId: run.id } });
    expect(results[0].score).toBe(1);
  });

  it('never fabricates a prediction: fails the whole run honestly when no provider is configured', async () => {
    const { resolveProvider } = await import('../../ai/resolver');
    vi.mocked(resolveProvider).mockRejectedValue(
      new NoProviderConfiguredError('text-generation', ['anthropic', 'openai'])
    );

    const run = await createEvaluationRun(['ACCURACY']);

    await expect(
      processRunEvaluation({
        evaluationRunId: run.id,
        datasetId,
        modelId,
        workspaceId,
        userId: ownerId,
        metrics: ['ACCURACY'],
      })
    ).rejects.toThrow(NoProviderConfiguredError);

    const updated = await prisma.evaluationRun.findUnique({ where: { id: run.id } });
    expect(updated?.status).toBe('FAILED');

    const results = await prisma.evaluationResult.findMany({ where: { evaluationRunId: run.id } });
    expect(results).toHaveLength(0);
  });
});

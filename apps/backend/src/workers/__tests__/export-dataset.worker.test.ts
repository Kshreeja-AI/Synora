import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import { processExportDataset } from '../export-dataset.worker';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

describe('export-dataset.worker', () => {
  const testWorkspaceIds: string[] = [];
  const testDatasetIds: string[] = [];
  const writtenFiles: string[] = [];
  let workspaceId: string;
  let datasetId: string;
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

    const dataset = await prisma.dataset.create({
      data: {
        workspaceId,
        name: 'Test Dataset',
        datasetType: 'SFT',
        createdBy: ownerId,
      },
    });
    datasetId = dataset.id;
    testDatasetIds.push(datasetId);

    await prisma.datasetSample.create({
      data: {
        datasetId,
        sourceType: 'SYNTHETIC',
        input: 'What is 2+2?',
        output: '4',
        inputTokens: 5,
        outputTokens: 1,
      },
    });
  });

  afterEach(async () => {
    for (const filePath of writtenFiles) {
      await fs.unlink(filePath).catch(() => {});
    }
    writtenFiles.length = 0;

    if (testDatasetIds.length > 0) {
      await prisma.datasetSample.deleteMany({ where: { datasetId: { in: testDatasetIds } } });
      await prisma.trainingExport.deleteMany({ where: { datasetId: { in: testDatasetIds } } });
      await prisma.dataset.deleteMany({ where: { id: { in: testDatasetIds } } });
      testDatasetIds.length = 0;
    }
    if (testWorkspaceIds.length > 0) {
      await prisma.workspace.deleteMany({ where: { id: { in: testWorkspaceIds } } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      testWorkspaceIds.length = 0;
    }
  });

  async function createPendingExport(format: 'JSONL' | 'JSON' | 'CSV' | 'PARQUET' | 'HUGGINGFACE') {
    return prisma.trainingExport.create({
      data: { datasetId, workspaceId, format, status: 'PENDING' },
    });
  }

  it('writes a real JSONL file and marks the export COMPLETED', async () => {
    const trainingExport = await createPendingExport('JSONL');

    await processExportDataset({
      exportId: trainingExport.id,
      datasetId,
      workspaceId,
      userId: ownerId,
      format: 'JSONL',
      includePII: true,
    });

    const updated = await prisma.trainingExport.findUnique({ where: { id: trainingExport.id } });
    expect(updated?.status).toBe('COMPLETED');
    expect(updated?.fileUrl).toMatch(/\.jsonl$/);
    expect(updated?.checksum).toBeTruthy();

    const filePath = path.join(process.cwd(), updated!.fileUrl!);
    writtenFiles.push(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('What is 2+2?');
  });

  it('fails the export honestly for PARQUET instead of writing JSON under a .parquet name', async () => {
    const trainingExport = await createPendingExport('PARQUET');

    await expect(
      processExportDataset({
        exportId: trainingExport.id,
        datasetId,
        workspaceId,
        userId: ownerId,
        format: 'PARQUET',
        includePII: true,
      })
    ).rejects.toThrow(/not yet supported/);

    const updated = await prisma.trainingExport.findUnique({ where: { id: trainingExport.id } });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.fileUrl).toBeNull();
  });

  it('fails the export honestly for HUGGINGFACE', async () => {
    const trainingExport = await createPendingExport('HUGGINGFACE');

    await expect(
      processExportDataset({
        exportId: trainingExport.id,
        datasetId,
        workspaceId,
        userId: ownerId,
        format: 'HUGGINGFACE',
        includePII: true,
      })
    ).rejects.toThrow(/not yet supported/);

    const updated = await prisma.trainingExport.findUnique({ where: { id: trainingExport.id } });
    expect(updated?.status).toBe('FAILED');
  });
});

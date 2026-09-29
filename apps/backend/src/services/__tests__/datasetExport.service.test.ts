import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import { datasetExportService } from '../datasetExport.service';
import { NotFoundException, ValidationException } from '@synora/shared';

describe('datasetExport.service', () => {
  const testWorkspaceIds: string[] = [];
  const testDatasetIds: string[] = [];
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

    await prisma.workspaceMember.create({
      data: { workspaceId, userId: ownerId, role: 'OWNER' },
    });

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
  });

  afterEach(async () => {
    if (testDatasetIds.length > 0) {
      await prisma.trainingExport.deleteMany({ where: { datasetId: { in: testDatasetIds } } });
      await prisma.dataset.deleteMany({ where: { id: { in: testDatasetIds } } });
      testDatasetIds.length = 0;
    }
    if (testWorkspaceIds.length > 0) {
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: testWorkspaceIds } } });
      await prisma.workspace.deleteMany({ where: { id: { in: testWorkspaceIds } } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      testWorkspaceIds.length = 0;
    }
  });

  describe('exportDataset', () => {
    it('creates a PENDING export record without writing any file', async () => {
      const result = await datasetExportService.exportDataset(ownerId, workspaceId, {
        datasetId,
        format: 'JSONL',
      });

      expect(result.status).toBe('PENDING');

      const record = await prisma.trainingExport.findUnique({ where: { id: result.exportId } });
      expect(record).not.toBeNull();
      expect(record?.status).toBe('PENDING');
      expect(record?.fileUrl).toBeNull();
    });

    it('rejects PARQUET as an unsupported format rather than silently substituting JSON', async () => {
      await expect(
        datasetExportService.exportDataset(ownerId, workspaceId, {
          datasetId,
          format: 'PARQUET',
        })
      ).rejects.toThrow(ValidationException);

      const records = await prisma.trainingExport.findMany({ where: { datasetId } });
      expect(records).toHaveLength(0);
    });

    it('rejects HUGGINGFACE as an unsupported format', async () => {
      await expect(
        datasetExportService.exportDataset(ownerId, workspaceId, {
          datasetId,
          format: 'HUGGINGFACE',
        })
      ).rejects.toThrow(ValidationException);
    });

    it('throws NotFoundException for a non-existent dataset', async () => {
      await expect(
        datasetExportService.exportDataset(ownerId, workspaceId, {
          datasetId: 'nonexistent',
          format: 'JSONL',
        })
      ).rejects.toThrow(NotFoundException);
    });
  });
});

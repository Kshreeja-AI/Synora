import { describe, it, expect, beforeEach, vi } from 'vitest';
import { upsertVectors, queryVectors, deleteVectors, deleteVectorsByWorkspace, deleteVectorsByConversation } from '../index';
import { getVectorDBService } from '../factory';

vi.mock('../factory', () => ({
  getVectorDBService: vi.fn(),
}));

describe('top-level vectordb API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upsertVectors() resolves the service and delegates to it', async () => {
    const mockService = { upsert: vi.fn().mockResolvedValue({ upsertedCount: 1 }) };
    (getVectorDBService as any).mockReturnValue(mockService);

    const result = await upsertVectors([{ id: 'a', values: [1] }], { workspaceId: 'ws-1' });

    expect(result.upsertedCount).toBe(1);
    expect(mockService.upsert).toHaveBeenCalledWith([{ id: 'a', values: [1] }], { workspaceId: 'ws-1' });
  });

  it('queryVectors() resolves the service and delegates to it', async () => {
    const mockService = { query: vi.fn().mockResolvedValue({ matches: [] }) };
    (getVectorDBService as any).mockReturnValue(mockService);

    await queryVectors({ workspaceId: 'ws-1', vector: [1], topK: 5 });

    expect(mockService.query).toHaveBeenCalledWith({ workspaceId: 'ws-1', vector: [1], topK: 5 });
  });

  it('deleteVectors() resolves the service and delegates to it', async () => {
    const mockService = { delete: vi.fn().mockResolvedValue({}) };
    (getVectorDBService as any).mockReturnValue(mockService);

    await deleteVectors({ workspaceId: 'ws-1', deleteAll: true });

    expect(mockService.delete).toHaveBeenCalledWith({ workspaceId: 'ws-1', deleteAll: true });
  });

  it('deleteVectorsByWorkspace() delegates to service.deleteByWorkspace', async () => {
    const mockService = { deleteByWorkspace: vi.fn().mockResolvedValue({}) };
    (getVectorDBService as any).mockReturnValue(mockService);

    await deleteVectorsByWorkspace('ws-1');

    expect(mockService.deleteByWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('deleteVectorsByConversation() delegates to service.deleteByConversation', async () => {
    const mockService = { deleteByConversation: vi.fn().mockResolvedValue({}) };
    (getVectorDBService as any).mockReturnValue(mockService);

    await deleteVectorsByConversation('ws-1', 'conv-1');

    expect(mockService.deleteByConversation).toHaveBeenCalledWith('ws-1', 'conv-1');
  });
});

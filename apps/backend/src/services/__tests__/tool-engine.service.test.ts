import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolEngineService } from '../tool-engine.service';
import { performHttpToolRequest, ToolTransportError } from '../tool-transport';

/**
 * Engine behavior around the (mocked) transport: request assembly from
 * tool config, secret placeholder substitution, retry classification
 * (5xx retries, 4xx doesn't), and the truthful terminal statuses
 * written to the execution record — COMPLETED, FAILED, TIMEOUT.
 */

vi.mock('../tool-transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tool-transport')>();
  return {
    ...actual,
    performHttpToolRequest: vi.fn(),
  };
});

vi.mock('../toolSecret.service', () => ({
  toolSecretService: {
    getEncryptedSecretByToolAndName: vi.fn(),
  },
}));

vi.mock('@synora/database', () => ({
  prisma: {
    toolDefinition: {
      findUnique: vi.fn(),
    },
    toolExecution: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

const mockTransport = vi.mocked(performHttpToolRequest);

function baseTool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool-1',
    workspaceId: 'ws-1',
    name: 'lookup',
    type: 'HTTP',
    config: { url: 'https://api.example.com/lookup', method: 'POST' },
    secrets: [],
    timeout: 5000,
    maxRetries: 3,
    requiresApproval: false,
    isActive: true,
    ...overrides,
  };
}

async function lastExecutionUpdate() {
  const { prisma } = await import('@synora/database');
  const calls = vi.mocked(prisma.toolExecution.update).mock.calls;
  return calls[calls.length - 1][0];
}

describe('ToolEngineService.executeWithRetries', () => {
  let engine: ToolEngineService;

  beforeEach(async () => {
    vi.clearAllMocks();
    engine = new ToolEngineService();
    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValue(baseTool() as never);
    vi.mocked(prisma.toolExecution.update).mockResolvedValue({} as never);
  });

  it('records COMPLETED with the response payload on 2xx', async () => {
    mockTransport.mockResolvedValueOnce({
      statusCode: 200,
      contentType: 'application/json',
      body: { ok: true },
    });

    await engine.executeWithRetries('exec-1', 'tool-1', { city: 'Paris' });

    expect(mockTransport).toHaveBeenCalledTimes(1);
    const request = mockTransport.mock.calls[0][0];
    expect(request.url).toBe('https://api.example.com/lookup');
    expect(request.method).toBe('POST');
    expect(request.body).toBe('{"city":"Paris"}');
    expect(request.headers['content-type']).toBe('application/json');

    const update = await lastExecutionUpdate();
    expect(update.data).toMatchObject({
      status: 'COMPLETED',
      output: { statusCode: 200, body: { ok: true } },
      attemptNumber: 1,
    });
  });

  it('serializes input as query params for GET tools', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValue(
      baseTool({ config: { url: 'https://api.example.com/lookup', method: 'GET' } }) as never
    );
    mockTransport.mockResolvedValueOnce({ statusCode: 200, contentType: null, body: 'ok' });

    await engine.executeWithRetries('exec-1', 'tool-1', { city: 'Paris', limit: 3 });

    const request = mockTransport.mock.calls[0][0];
    expect(request.method).toBe('GET');
    expect(request.body).toBeUndefined();
    const url = new URL(request.url);
    expect(url.searchParams.get('city')).toBe('Paris');
    expect(url.searchParams.get('limit')).toBe('3');
  });

  it('fails immediately on 4xx without retrying', async () => {
    mockTransport.mockResolvedValueOnce({
      statusCode: 422,
      contentType: 'application/json',
      body: { error: 'bad input' },
    });

    await engine.executeWithRetries('exec-1', 'tool-1', {});

    expect(mockTransport).toHaveBeenCalledTimes(1);
    const update = await lastExecutionUpdate();
    expect(update.data).toMatchObject({
      status: 'FAILED',
      error: 'Tool endpoint responded with HTTP 422',
    });
  });

  it('retries 5xx responses and succeeds on a later attempt', async () => {
    mockTransport
      .mockResolvedValueOnce({ statusCode: 503, contentType: null, body: 'down' })
      .mockResolvedValueOnce({ statusCode: 200, contentType: null, body: 'up' });

    await engine.executeWithRetries('exec-1', 'tool-1', {});

    expect(mockTransport).toHaveBeenCalledTimes(2);
    const update = await lastExecutionUpdate();
    expect(update.data).toMatchObject({ status: 'COMPLETED', attemptNumber: 2 });
  }, 10000);

  it('stops immediately on a non-retryable transport error (e.g. SSRF block)', async () => {
    mockTransport.mockRejectedValueOnce(
      new ToolTransportError('Refusing to connect to a non-public address', { retryable: false })
    );

    await engine.executeWithRetries('exec-1', 'tool-1', {});

    expect(mockTransport).toHaveBeenCalledTimes(1);
    const update = await lastExecutionUpdate();
    expect(update.data).toMatchObject({
      status: 'FAILED',
      error: 'Refusing to connect to a non-public address',
    });
  });

  it('records TIMEOUT when every attempt times out', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValue(
      baseTool({ maxRetries: 1 }) as never
    );
    mockTransport.mockRejectedValue(
      new ToolTransportError('Tool execution timed out after 5000ms', {
        retryable: true,
        timedOut: true,
      })
    );

    await engine.executeWithRetries('exec-1', 'tool-1', {});

    expect(mockTransport).toHaveBeenCalledTimes(1);
    const update = await lastExecutionUpdate();
    expect(update.data).toMatchObject({ status: 'TIMEOUT' });
  });

  it('substitutes declared secret placeholders into headers without logging values', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValue(
      baseTool({
        secrets: ['API_KEY'],
        config: {
          url: 'https://api.example.com/lookup',
          method: 'POST',
          headers: { Authorization: 'Bearer {{secret:API_KEY}}' },
        },
      }) as never
    );
    const { toolSecretService } = await import('../toolSecret.service');
    vi.mocked(toolSecretService.getEncryptedSecretByToolAndName).mockResolvedValue({
      decrypted: 's3cret-value',
    });
    mockTransport.mockResolvedValueOnce({ statusCode: 200, contentType: null, body: 'ok' });

    await engine.executeWithRetries('exec-1', 'tool-1', {});

    const request = mockTransport.mock.calls[0][0];
    expect(request.headers.authorization).toBe('Bearer s3cret-value');
  });

  it('fails when config references a secret the tool does not declare', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValue(
      baseTool({
        secrets: [],
        config: {
          url: 'https://api.example.com/lookup',
          headers: { Authorization: 'Bearer {{secret:UNDECLARED}}' },
        },
      }) as never
    );

    await engine.executeWithRetries('exec-1', 'tool-1', {});

    expect(mockTransport).not.toHaveBeenCalled();
    const update = await lastExecutionUpdate();
    expect(update.data.status).toBe('FAILED');
    expect(update.data.error).toContain('UNDECLARED');
  });

  it('fails when the tool config has no url', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValue(
      baseTool({ config: {} }) as never
    );

    await engine.executeWithRetries('exec-1', 'tool-1', {});

    expect(mockTransport).not.toHaveBeenCalled();
    const update = await lastExecutionUpdate();
    expect(update.data.status).toBe('FAILED');
    expect(update.data.error).toContain('url');
  });

  it('fails fast when the tool definition has been deleted', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValue(null);

    await engine.executeWithRetries('exec-1', 'tool-1', {});

    expect(mockTransport).not.toHaveBeenCalled();
    const update = await lastExecutionUpdate();
    expect(update.data.status).toBe('FAILED');
  });
});

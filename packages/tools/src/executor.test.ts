import { asToolCallId } from '@synora/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from './define-tool.js';
import { executeTool } from './executor.js';
import { ToolRegistry } from './tool-registry.js';

const context = { tenantId: 't1', agentId: 'a1', sessionId: 's1' };

describe('tool registry + executor', () => {
  it('validates input and executes a registered tool', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        name: 'add',
        description: 'Adds two numbers',
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => a + b,
      }),
    );

    const result = await executeTool(
      registry,
      { toolCallId: asToolCallId('c1'), toolName: 'add', input: { a: 2, b: 3 } },
      context,
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toBe(5);
  });

  it('returns a structured error for invalid input instead of throwing', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        name: 'add',
        description: 'Adds two numbers',
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => a + b,
      }),
    );

    const result = await executeTool(
      registry,
      { toolCallId: asToolCallId('c2'), toolName: 'add', input: { a: 'oops' } },
      context,
    );

    expect(result.isError).toBe(true);
  });

  it('returns a structured error for an unknown tool', async () => {
    const registry = new ToolRegistry();
    const result = await executeTool(
      registry,
      { toolCallId: asToolCallId('c3'), toolName: 'missing', input: {} },
      context,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain('Unknown tool');
  });

  it('rejects registering the same tool name twice', () => {
    const registry = new ToolRegistry();
    const tool = defineTool({
      name: 'dup',
      description: 'x',
      inputSchema: z.object({}),
      execute: async () => null,
    });
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(/already registered/);
  });
});

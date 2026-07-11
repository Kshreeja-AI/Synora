import {
  type ToolExecutionContext,
  ToolExecutionError,
  type ToolInvocation,
  type ToolResult,
} from '@synora/core';
import type { ToolRegistry } from './tool-registry.js';

export interface ExecuteToolOptions {
  timeoutMs?: number;
}

/**
 * Runs a single tool invocation against the registry with a timeout
 * and uniform error shape. Never throws — failures come back as a
 * ToolResult with isError:true so the agent loop can feed the failure
 * to the model as a tool_result rather than crashing the run.
 */
export async function executeTool(
  registry: ToolRegistry,
  invocation: ToolInvocation,
  context: ToolExecutionContext,
  options: ExecuteToolOptions = {},
): Promise<ToolResult> {
  const handler = registry.get(invocation.toolName);
  if (!handler) {
    return {
      toolCallId: invocation.toolCallId,
      output: `Unknown tool "${invocation.toolName}"`,
      isError: true,
    };
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = context.signal
    ? anySignal([context.signal, controller.signal])
    : controller.signal;

  try {
    const output = await handler.execute(invocation.input, { ...context, signal });
    return { toolCallId: invocation.toolCallId, output };
  } catch (error) {
    const wrapped =
      error instanceof ToolExecutionError
        ? error
        : new ToolExecutionError(
            `Tool "${invocation.toolName}" failed: ${(error as Error).message}`,
            {
              cause: error,
            },
          );
    return { toolCallId: invocation.toolCallId, output: wrapped.message, isError: true };
  } finally {
    clearTimeout(timeout);
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

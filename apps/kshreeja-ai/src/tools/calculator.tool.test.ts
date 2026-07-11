import { asToolCallId } from '@synora/core';
import { describe, expect, it } from 'vitest';
import { calculatorTool } from './calculator.tool.js';

const context = { tenantId: 't1', agentId: 'a1', sessionId: 's1' };

describe('calculatorTool', () => {
  it('evaluates basic arithmetic with precedence and parentheses', async () => {
    const result = await calculatorTool.execute({ expression: '(2 + 3) * 4 - 1' }, context);
    expect(result).toEqual({ result: 19 });
  });

  it('handles decimals and unary minus', async () => {
    const result = await calculatorTool.execute({ expression: '-2.5 + 5' }, context);
    expect(result).toEqual({ result: 2.5 });
  });

  it('rejects malformed expressions', async () => {
    await expect(calculatorTool.execute({ expression: '2 + ' }, context)).rejects.toThrow();
  });

  it('rejects non-arithmetic input instead of evaluating it as code', async () => {
    await expect(
      calculatorTool.execute({ expression: 'process.exit(1)' }, context),
    ).rejects.toThrow();
  });
});

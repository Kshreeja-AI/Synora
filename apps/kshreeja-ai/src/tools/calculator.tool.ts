import { defineTool } from '@synora/tools';
import { z } from 'zod';

/**
 * Tiny recursive-descent arithmetic evaluator (+ - * / parentheses,
 * decimals, unary minus). Deliberately not `eval`/`Function` — tool
 * input comes from model output, which is untrusted, so it must never
 * reach a JS evaluator.
 */
function evaluateExpression(expression: string): number {
  let pos = 0;

  function peek(): string | undefined {
    return expression[pos];
  }
  function isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
  }
  function skipSpace(): void {
    while (peek() === ' ') pos++;
  }
  function parseNumber(): number {
    skipSpace();
    const start = pos;
    if (peek() === '-') pos++;
    while (isDigit(peek())) pos++;
    if (peek() === '.') {
      pos++;
      while (isDigit(peek())) pos++;
    }
    const raw = expression.slice(start, pos);
    if (!raw || raw === '-') throw new Error(`Invalid number at position ${start}`);
    return Number(raw);
  }
  function parsePrimary(): number {
    skipSpace();
    if (peek() === '(') {
      pos++;
      const value = parseExpr();
      skipSpace();
      if (peek() !== ')') throw new Error('Expected closing parenthesis');
      pos++;
      return value;
    }
    if (peek() === '-') {
      pos++;
      return -parsePrimary();
    }
    return parseNumber();
  }
  function parseTerm(): number {
    let value = parsePrimary();
    for (;;) {
      skipSpace();
      const op = peek();
      if (op === '*' || op === '/') {
        pos++;
        const rhs = parsePrimary();
        value = op === '*' ? value * rhs : value / rhs;
      } else {
        return value;
      }
    }
  }
  function parseExpr(): number {
    let value = parseTerm();
    for (;;) {
      skipSpace();
      const op = peek();
      if (op === '+' || op === '-') {
        pos++;
        const rhs = parseTerm();
        value = op === '+' ? value + rhs : value - rhs;
      } else {
        return value;
      }
    }
  }

  const result = parseExpr();
  skipSpace();
  if (pos !== expression.length) throw new Error(`Unexpected character at position ${pos}`);
  return result;
}

export const calculatorTool = defineTool({
  name: 'calculator',
  description:
    'Evaluates a basic arithmetic expression (+, -, *, /, parentheses). Use for any numeric computation.',
  inputSchema: z.object({ expression: z.string().min(1) }),
  readOnly: true,
  execute: async ({ expression }) => {
    const result = evaluateExpression(expression);
    if (!Number.isFinite(result)) throw new Error('Expression did not evaluate to a finite number');
    return { result };
  },
});

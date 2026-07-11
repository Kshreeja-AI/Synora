import type { ToolExecutionContext, ToolHandler } from '@synora/core';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export interface DefineToolOptions<TSchema extends z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TSchema;
  readOnly?: boolean;
  execute: (input: z.infer<TSchema>, context: ToolExecutionContext) => Promise<unknown>;
}

/**
 * Declares a tool once with a zod schema and gets both a validated
 * TypeScript-typed executor and a JSON Schema (for provider tool
 * definitions) for free. This is the primary way products register
 * capabilities with an agent.
 */
export function defineTool<TSchema extends z.ZodTypeAny>(
  options: DefineToolOptions<TSchema>,
): ToolHandler {
  const jsonSchema = zodToJsonSchema(options.inputSchema, { target: 'openApi3' }) as Record<
    string,
    unknown
  >;

  return {
    definition: {
      name: options.name,
      description: options.description,
      inputSchema: jsonSchema,
      readOnly: options.readOnly,
    },
    async execute(input, context) {
      const parsed = options.inputSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(`Invalid input for tool "${options.name}": ${parsed.error.message}`);
      }
      return options.execute(parsed.data, context);
    },
  };
}

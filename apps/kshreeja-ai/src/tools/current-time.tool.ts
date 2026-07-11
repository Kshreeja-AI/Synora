import { defineTool } from '@synora/tools';
import { z } from 'zod';

export const currentTimeTool = defineTool({
  name: 'current_time',
  description: 'Returns the current date and time in ISO 8601 format.',
  inputSchema: z.object({}),
  readOnly: true,
  execute: async () => ({ iso: new Date().toISOString() }),
});

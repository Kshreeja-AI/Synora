import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'apps/*',
  'packages/*',
  'packages/shared/*',
  'packages/infrastructure/*',
  'plugins/*',
]);

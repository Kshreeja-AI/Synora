/**
 * Prompt categories offered in the UI. Kept next to the library
 * components (rather than in the API client) because the backend
 * accepts any string here — this list is a curation choice, not a
 * contract. Templates have their own server-known set, exported as
 * TEMPLATE_CATEGORIES from `@/lib/api/templates`.
 */
export const PROMPT_CATEGORIES = [
  'creative',
  'analysis',
  'coding',
  'marketing',
  'education',
  'other',
] as const;

export type PromptCategory = (typeof PROMPT_CATEGORIES)[number];

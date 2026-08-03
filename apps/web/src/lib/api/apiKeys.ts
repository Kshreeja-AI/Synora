import { api } from './client';

/**
 * Developer-portal client for workspace API keys.
 *
 * The server returns the raw secret exactly once, at creation — the
 * `rawKey` field will never come back from list/revoke endpoints, only
 * from POST.
 */

export interface ApiKeySummary {
  id: string;
  workspaceId: string;
  createdById: string | null;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApiKeyResponse {
  apiKey: ApiKeySummary;
  /** Full secret — show once, then throw away in local state. */
  rawKey: string;
}

export function listApiKeys(workspaceId: string): Promise<{ keys: ApiKeySummary[] }> {
  return api.get(`/api/workspaces/${workspaceId}/api-keys`);
}

export function createApiKey(
  workspaceId: string,
  input: { name: string; expiresAt?: string | null }
): Promise<CreateApiKeyResponse> {
  return api.post(`/api/workspaces/${workspaceId}/api-keys`, input);
}

export function revokeApiKey(
  workspaceId: string,
  keyId: string
): Promise<{ id: string; revokedAt: string }> {
  return api.post(`/api/workspaces/${workspaceId}/api-keys/${keyId}/revoke`, {});
}

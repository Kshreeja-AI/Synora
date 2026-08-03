import { api } from './client';

/**
 * Admin API client.
 *
 * Mirrors routes/admin.ts. All calls are 403 for non-admin users — the UI
 * pages here should be gated at their layout level so the request never fires
 * for a caller who cannot see the response.
 */

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalWorkspaces: number;
  totalConversations: number;
  totalMessages: number;
  activeSubscriptions: number;
  last24hMessages: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  emailVerified: string | null;
  createdAt: string;
  _count: { workspaces: number };
}

export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  avatar: string | null;
  createdAt: string;
  _count: { members: number; conversations: number; projects: number };
}

export interface AdminAuditLog {
  id: string;
  workspaceId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: unknown;
  createdAt: string;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === false) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function getAdminStats(): Promise<AdminStats> {
  return api.get<AdminStats>('/api/admin/stats');
}

export function listAdminUsers(params: {
  search?: string;
  role?: 'USER' | 'ADMIN';
  status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  limit?: number;
  offset?: number;
} = {}): Promise<{ users: AdminUser[]; total: number }> {
  return api.get(`/api/admin/users${qs(params)}`);
}

export function listAdminWorkspaces(params: {
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ workspaces: AdminWorkspace[]; total: number }> {
  return api.get(`/api/admin/workspaces${qs(params)}`);
}

export function listAdminAuditLogs(params: {
  workspaceId?: string;
  actorId?: string;
  action?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ logs: AdminAuditLog[]; total: number }> {
  return api.get(`/api/admin/audit-logs${qs(params)}`);
}

export function suspendAdminUser(userId: string): Promise<AdminUser> {
  return api.post<AdminUser>(`/api/admin/users/${userId}/suspend`, {});
}

export function reactivateAdminUser(userId: string): Promise<AdminUser> {
  return api.post<AdminUser>(`/api/admin/users/${userId}/reactivate`, {});
}

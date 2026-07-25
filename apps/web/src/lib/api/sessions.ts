import { api } from './client';
import type { SessionResponse } from './types';

export function listSessions(): Promise<SessionResponse[]> {
  return api.get<SessionResponse[]>('/api/auth/sessions');
}

export function revokeSession(sessionId: string): Promise<{ message: string }> {
  return api.delete(`/api/auth/sessions/${sessionId}`);
}

import { api } from './client';
import type { CurrentUser, PreferencesResponse, UpdatePreferencesRequest, UpdateProfileRequest } from './types';

export function getCurrentUser(): Promise<CurrentUser> {
  return api.get<CurrentUser>('/api/users/me');
}

export function updateProfile(updates: UpdateProfileRequest): Promise<CurrentUser> {
  return api.patch<CurrentUser>('/api/users/me', updates);
}

export async function uploadAvatar(file: File): Promise<{ image: string }> {
  const formData = new FormData();
  formData.append('avatar', file);
  return api.upload('/api/users/me/avatar', formData);
}

export function removeAvatar(): Promise<{ message: string }> {
  return api.delete('/api/users/me/avatar');
}

export function changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
  return api.post('/api/users/me/password', { currentPassword, newPassword });
}

export function getPreferences(): Promise<PreferencesResponse> {
  return api.get<PreferencesResponse>('/api/users/me/preferences');
}

export function updatePreferences(updates: UpdatePreferencesRequest): Promise<PreferencesResponse> {
  return api.patch<PreferencesResponse>('/api/users/me/preferences', updates);
}

/** Idempotent: first call records the timestamp; later calls are no-ops. */
export function markOnboarded(): Promise<{ onboardedAt: string }> {
  return api.post<{ onboardedAt: string }>('/api/users/me/onboarded', {});
}

export function deleteAccount(password: string): Promise<{ message: string }> {
  return api.delete('/api/users/me', { password });
}

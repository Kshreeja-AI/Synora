import { api } from './client';

export type RegistrationMode = 'invite' | 'open';

/** Whether sign-up is open or by invitation. Public; says nothing about any address. */
export function getRegistrationStatus(): Promise<{ mode: RegistrationMode }> {
  return api.get<{ mode: RegistrationMode }>('/api/auth/registration-status', { anonymous: true });
}

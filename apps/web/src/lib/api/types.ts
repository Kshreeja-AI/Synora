/** Response envelope produced by the backend (`createApiResponse` / errorHandler). */
export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: ApiErrorBody;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  code?: string;
  message: string;
  details?: unknown;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type AuthResponse = AuthTokens & { user: AuthUser };

export interface ProfileFields {
  bio: string | null;
  website: string | null;
  location: string | null;
}

export interface PreferencesResponse {
  theme: 'LIGHT' | 'DARK' | 'AUTO';
  emailNotifications: boolean;
  pushNotifications: boolean;
  marketingEmails: boolean;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
  emailVerified: boolean;
  createdAt: string;
  profile: ProfileFields | null;
  preferences: PreferencesResponse;
}

export interface UpdateProfileRequest {
  name?: string;
  bio?: string;
  website?: string;
  location?: string;
}

export interface UpdatePreferencesRequest {
  theme?: PreferencesResponse['theme'];
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  marketingEmails?: boolean;
}

export interface SessionResponse {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  deviceLabel: string;
  rememberMe: boolean;
  isCurrent: boolean;
}

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'MEMBER' | 'VIEWER';

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatar: string | null;
  role: WorkspaceRole;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMemberSummary {
  id: string;
  role: WorkspaceRole;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
}

export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
}

export interface UpdateWorkspaceRequest {
  name?: string;
  description?: string;
}

export type NotificationType = 'SECURITY' | 'ACCOUNT' | 'WORKSPACE' | 'SYSTEM';

export interface NotificationSummary {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  notifications: NotificationSummary[];
  unreadCount: number;
}

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

export interface InvitationSummary {
  id: string;
  email: string;
  role: WorkspaceRole;
  createdAt: string;
  expiresAt: string;
  invitedBy: { id: string; name: string | null; email: string };
}

export interface CreateInvitationRequest {
  email: string;
  role: Exclude<WorkspaceRole, 'OWNER'>;
}

export interface InvitationPreview {
  workspaceName: string;
  role: WorkspaceRole;
  email: string;
  invitedBy: string | null;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; name: string | null; email: string } | null;
}

export type ProjectStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED';

export interface Project {
  id: string;
  userId: string;
  workspaceId: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  workspaceId?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  status?: ProjectStatus;
}

export interface Folder {
  id: string;
  workspaceId: string;
  projectId: string | null;
  parentId: string | null;
  name: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  workspaceId: string;
  projectId: string | null;
  folderId: string | null;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedById: string;
  createdAt: string;
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

export type PlanInterval = 'MONTH' | 'YEAR';
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIAL';
export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';

export interface Plan {
  id: string;
  key: string;
  name: string;
  interval: PlanInterval;
  priceCents: number;
  creditsPerInterval: number;
  trialDays: number | null;
  features: Record<string, unknown>;
  sortOrder: number;
  status: 'ACTIVE' | 'ARCHIVED';
  isDefault: boolean;
}

export interface Subscription {
  id: string;
  workspaceId: string;
  planId: string;
  plan: Plan;
  status: SubscriptionStatus;
  externalSubscriptionId: string | null;
  externalCustomerId: string | null;
  provider: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentMethod {
  id: string;
  subscriptionId: string | null;
  workspaceId: string;
  externalPaymentMethodId: string;
  type: 'CARD' | 'OTHER';
  brand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  isDefault: boolean;
  createdAt: string;
}

export interface Invoice {
  id: string;
  subscriptionId: string | null;
  workspaceId: string;
  externalInvoiceId: string;
  status: InvoiceStatus;
  amountDueCents: number;
  amountPaidCents: number;
  hostedInvoiceUrl: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceCredits {
  id: string;
  workspaceId: string;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreditLedgerEntry {
  id: string;
  workspaceId: string;
  type: 'GRANT' | 'DEDUCTION' | 'ADJUSTMENT';
  amount: number;
  balanceAfter: number;
  reason: string;
  actorId: string | null;
  createdAt: string;
}

export interface UsageRecord {
  id: string;
  workspaceId: string;
  userId: string | null;
  capability: string;
  quantity: number;
  creditsCost: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

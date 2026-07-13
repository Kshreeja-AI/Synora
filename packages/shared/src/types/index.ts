// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: {
    timestamp: string;
    version: string;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Pagination
export interface PaginationParams {
  page: number;
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// Auth Types
export interface AuthSession {
  userId: string;
  email: string;
  name?: string;
  role: string;
  workspace?: {
    id: string;
    name: string;
  };
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface AuthResponse {
  token: string;
  refreshToken?: string;
  user: {
    id: string;
    email: string;
    name?: string;
  };
}

// Project Types
export interface CreateProjectRequest {
  name: string;
  description?: string;
  workspaceId?: string;
}

export interface ProjectResponse {
  id: string;
  name: string;
  description?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// Document Types
export interface CreateDocumentRequest {
  title: string;
  content: string;
  format: 'markdown' | 'html' | 'plain_text' | 'rich_text';
  projectId?: string;
}

export interface DocumentResponse {
  id: string;
  title: string;
  content: string;
  format: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

// Image Generation
export interface GenerateImageRequest {
  prompt: string;
  width?: number;
  height?: number;
  model?: string;
  projectId?: string;
}

export interface GeneratedImageResponse {
  id: string;
  prompt: string;
  imageUrl: string;
  thumbnailUrl?: string;
  width: number;
  height: number;
  model: string;
  status: string;
  createdAt: string;
}

// Video Generation
export interface GenerateVideoRequest {
  prompt: string;
  duration?: number;
  model?: string;
  projectId?: string;
}

export interface GeneratedVideoResponse {
  id: string;
  prompt: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration: number;
  model: string;
  status: string;
  createdAt: string;
  completedAt?: string;
}

// Audio Generation
export interface GenerateAudioRequest {
  prompt: string;
  model?: string;
  projectId?: string;
}

export interface GeneratedAudioResponse {
  id: string;
  prompt: string;
  audioUrl: string;
  duration: number;
  model: string;
  status: string;
  createdAt: string;
  completedAt?: string;
}

// Workspace Types
export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
}

export interface WorkspaceResponse {
  id: string;
  name: string;
  description?: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

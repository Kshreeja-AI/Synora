// API Response Helpers
export function createApiResponse<T>(data: T, meta?: Record<string, unknown>) {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      ...meta,
    },
  };
}

export function createApiError(
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    },
  };
}

// String Utilities
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Validation Helpers
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[!@#$%^&*]/.test(password)
  );
}

// Date Utilities
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getRelativeTime(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;

  return formatDate(date);
}

// Object Utilities
export function omit<T extends Record<string, unknown>>(
  obj: T,
  keys: (keyof T)[]
): Partial<T> {
  const result = { ...obj };
  keys.forEach((key) => {
    delete result[key];
  });
  return result;
}

export function pick<T extends Record<string, unknown>>(
  obj: T,
  keys: (keyof T)[]
): Partial<T> {
  const result: Partial<T> = {};
  keys.forEach((key) => {
    if (key in obj) {
      result[key] = obj[key];
    }
  });
  return result;
}

// Array Utilities
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

// Error Handling
export class ApiException extends Error {
  constructor(
    readonly code: string,
    readonly message: string,
    readonly statusCode: number = 400,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiException';
  }
}

export class ValidationException extends ApiException {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationException';
  }
}

export class NotFoundException extends ApiException {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
    this.name = 'NotFoundException';
  }
}

export class UnauthorizedException extends ApiException {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedException';
  }
}

export class ForbiddenException extends ApiException {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenException';
  }
}

export class LockedException extends ApiException {
  constructor(message = 'Account temporarily locked', details?: Record<string, unknown>) {
    super('ACCOUNT_LOCKED', message, 423, details);
    this.name = 'LockedException';
  }
}

/** The envelope every presentation-layer HTTP response uses — see docs/architecture/11-presentation-layer.md. */
export type ApiResponse<T> =
  | Readonly<{ success: true; data: T }>
  | Readonly<{
      success: false;
      error: Readonly<{ code: string; message: string; details?: unknown }>;
    }>;

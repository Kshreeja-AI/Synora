import { AppError } from '@synora/errors';

/** Base class for application-layer failures (use-case orchestration/validation failures). */
export abstract class ApplicationError extends AppError {}

import { Request, Response, NextFunction } from 'express';

interface SizeLimit {
  bytes: number;
  label: string;
}

const DEFAULT_LIMIT: SizeLimit = { bytes: 1024 * 1024, label: '1MB' };
const STRICT_LIMIT: SizeLimit = { bytes: 10 * 1024, label: '10KB' };
const LARGE_LIMIT: SizeLimit = { bytes: 5 * 1024 * 1024, label: '5MB' };

export function validateInputSize(limit: SizeLimit = DEFAULT_LIMIT) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);

    if (contentLength > limit.bytes) {
      return res.status(413).json({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds maximum size of ${limit.label}`,
        },
      });
    }

    next();
  };
}

export const authInputValidator = validateInputSize(STRICT_LIMIT);
export const defaultInputValidator = validateInputSize(DEFAULT_LIMIT);
export const largeInputValidator = validateInputSize(LARGE_LIMIT);

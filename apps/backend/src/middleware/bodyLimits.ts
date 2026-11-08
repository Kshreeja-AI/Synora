import express from 'express';
import type { Express } from 'express';

/**
 * Request-body size limits for the API.
 *
 * The default used to be 10mb for every route, which let any anonymous caller
 * make the server buffer and parse 10mb of JSON per request. Real file uploads
 * are multipart and go through multer with their own per-route limits, so they
 * are not affected by these JSON/urlencoded limits. Only routes whose JSON
 * payload is legitimately large get the bigger ceiling.
 */
export const DEFAULT_BODY_LIMIT = '100kb';
export const LARGE_BODY_LIMIT = '2mb';

/** Path prefixes whose JSON body can legitimately exceed the default (document text). */
export const LARGE_BODY_PATHS: readonly string[] = ['/api/documents'];

/**
 * Mount the JSON/urlencoded parsers. The large-body parsers are mounted first
 * for their paths; body-parser skips a request that is already parsed, so the
 * default parsers that follow only handle everything else.
 */
export function mountBodyParsers(app: Express): void {
  app.use(
    [...LARGE_BODY_PATHS],
    express.json({ limit: LARGE_BODY_LIMIT }),
    express.urlencoded({ limit: LARGE_BODY_LIMIT, extended: true })
  );
  app.use(express.json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(express.urlencoded({ limit: DEFAULT_BODY_LIMIT, extended: true }));
}

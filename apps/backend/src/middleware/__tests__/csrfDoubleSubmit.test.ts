/**
 * A CSRF CONTROL THAT CANNOT BE SATISFIED IS NOT PROTECTION — IT IS AN OUTAGE.
 *
 * Double-submit asks the caller to prove it can READ a cookie for this
 * origin, then echo it in a header. Only same-origin script can do that: a
 * cross-site page can make the browser SEND cookies but never read them
 * back. That asymmetry is the whole mechanism.
 *
 * Marking the token cookie HttpOnly does not harden it — it disables it.
 * The legitimate page loses exactly the access the attacker never had, so it
 * can never produce the header, and every mutating request outside the
 * exempt /api/auth routes fails 403.
 *
 * That was the live production state: a real user could register and log in,
 * then create no workspace, start no conversation and send no message. The
 * server looked healthy and secure the entire time, which is why nothing
 * caught it — the control was present, documented, and inert.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { csrfProtection, generateCsrfToken } from '../csrf';

function res() {
  const cookies: { name: string; value: string; opts: Record<string, unknown> }[] = [];
  return {
    cookies,
    cookie: vi.fn((name: string, value: string, opts: Record<string, unknown>) =>
      cookies.push({ name, value, opts })
    ),
  } as unknown as Response & { cookies: typeof cookies };
}

function req(over: Partial<Request> = {}): Request {
  return { method: 'GET', path: '/api/workspaces', cookies: {}, headers: {}, body: {}, ...over } as Request;
}

describe('the CSRF token must be readable by the page that has to echo it', () => {
  it('does NOT set HttpOnly on the token cookie', () => {
    const r = res();
    csrfProtection(req(), r, vi.fn() as unknown as NextFunction);

    const issued = r.cookies.find((c) => c.name === 'X-CSRF-Token');
    expect(issued, 'a safe request should mint a token').toBeDefined();
    // THE REGRESSION. httpOnly here makes the whole scheme unsatisfiable.
    expect(issued?.opts.httpOnly).toBe(false);
  });

  it('keeps the protections that actually do work', () => {
    const r = res();
    csrfProtection(req(), r, vi.fn() as unknown as NextFunction);
    const issued = r.cookies.find((c) => c.name === 'X-CSRF-Token');
    // sameSite is what stops the cross-site request carrying the cookie at
    // all; dropping it while un-setting httpOnly WOULD be a real weakening.
    expect(issued?.opts.sameSite).toBe('strict');
  });

  it('still refuses a mutating request that echoes nothing', () => {
    const next = vi.fn();
    csrfProtection(
      req({ method: 'POST', cookies: { 'X-CSRF-Token': generateCsrfToken() } }),
      res(),
      next as unknown as NextFunction
    );
    expect(next.mock.calls[0]?.[0], 'missing header must still be rejected').toBeInstanceOf(Error);
  });

  it('accepts a mutating request that echoes the cookie — the path the UI uses', () => {
    const token = generateCsrfToken();
    const next = vi.fn();
    csrfProtection(
      req({ method: 'POST', cookies: { 'X-CSRF-Token': token }, headers: { 'x-csrf-token': token } }),
      res(),
      next as unknown as NextFunction
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a mismatched token', () => {
    const next = vi.fn();
    csrfProtection(
      req({
        method: 'POST',
        cookies: { 'X-CSRF-Token': generateCsrfToken() },
        headers: { 'x-csrf-token': generateCsrfToken() },
      }),
      res(),
      next as unknown as NextFunction
    );
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});

/**
 * A DEVELOPMENT DEFAULT MUST NOT SURVIVE TO PRODUCTION.
 *
 * `CORS_ORIGINS`, `FRONTEND_URL` and `BACKEND_URL` all default to
 * `http://localhost:300x`, and production does not override them —
 * `STAGE_OVERRIDES` in defaults.ts touches only logging and rate limits.
 * Verified by booting the real config with `DEPLOYMENT_STAGE=production`
 * and the three variables unset: every one resolved to localhost, with no
 * error, no warning, and a completely healthy-looking server.
 *
 * What that costs, if it ever ships:
 *   - the real site's API calls and realtime connections are all rejected
 *   - every password reset, verification and invitation email links to the
 *     recipient's own machine
 *   - every uploaded file resolves to an address nobody can reach
 *
 * Three different subsystems, one silent cause, and nothing in the product
 * would have said so. This is the same shape as the realtime CORS bug
 * fixed earlier — except there the wrong VARIABLE was read, and here the
 * right variable holds a wrong DEFAULT.
 */

import { describe, it, expect } from 'vitest';
import {
  assertNoLocalhostInProduction,
  isLoopbackUrl,
  LocalhostInProductionError,
} from '../productionGates';
import type { DeploymentStage } from '../types';

function configWith(overrides: {
  stage?: DeploymentStage;
  corsOrigins?: string[];
  frontendUrl?: string;
  backendUrl?: string;
}) {
  return {
    stage: overrides.stage ?? ('production' as DeploymentStage),
    server: { corsOrigins: overrides.corsOrigins ?? ['https://synora.example.com'] },
    urls: {
      frontendUrl: overrides.frontendUrl ?? 'https://synora.example.com',
      backendUrl: overrides.backendUrl ?? 'https://api.synora.example.com',
    },
  };
}

describe('recognising an address that only works on this machine', () => {
  it('catches every spelling of loopback, not just the word localhost', () => {
    // A deployment written by hand can produce any of these, and all of
    // them are equally unreachable from a visitor's browser.
    expect(isLoopbackUrl('http://localhost:3000')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:3001')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:3000')).toBe(true);
    expect(isLoopbackUrl('http://0.0.0.0:3000')).toBe(true);
    expect(isLoopbackUrl('https://LOCALHOST:3000')).toBe(true);
  });

  it('does not flag a real address that merely mentions localhost', () => {
    // A substring search would fail here, and a false refusal to boot is
    // worse than the bug: it blocks a correct deployment.
    expect(isLoopbackUrl('https://localhost.synora.example.com')).toBe(false);
    expect(isLoopbackUrl('https://synora.example.com/localhost')).toBe(false);
  });

  it('leaves an unparseable value to the schema, rather than blaming it', () => {
    expect(isLoopbackUrl('not a url')).toBe(false);
  });
});

describe('the production boot gate', () => {
  it('refuses production when the API would only accept localhost origins', () => {
    expect(() =>
      assertNoLocalhostInProduction(configWith({ corsOrigins: ['http://localhost:3000'] }))
    ).toThrow(LocalhostInProductionError);
  });

  it('refuses production when emails would link to the recipient\'s own machine', () => {
    expect(() =>
      assertNoLocalhostInProduction(configWith({ frontendUrl: 'http://localhost:3000' }))
    ).toThrow(/password reset/i);
  });

  it('refuses production when uploaded files would be unreachable', () => {
    expect(() =>
      assertNoLocalhostInProduction(configWith({ backendUrl: 'http://localhost:3001' }))
    ).toThrow(/uploaded files/i);
  });

  it('reports every offender at once, not one per restart', () => {
    // Reporting one at a time turns a five-minute fix into three failed
    // deployments.
    try {
      assertNoLocalhostInProduction(
        configWith({
          corsOrigins: ['http://localhost:3000'],
          frontendUrl: 'http://localhost:3000',
          backendUrl: 'http://localhost:3001',
        })
      );
      expect.unreachable('should have refused');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('CORS_ORIGINS');
      expect(message).toContain('FRONTEND_URL');
      expect(message).toContain('BACKEND_URL');
    }
  });

  it('names what to do, not only what is wrong', () => {
    try {
      assertNoLocalhostInProduction(configWith({ frontendUrl: 'http://localhost:3000' }));
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as Error).message).toMatch(/set each to the real public address/i);
    }
  });

  it('applies to staging too — a broken staging teaches nothing', () => {
    expect(() =>
      assertNoLocalhostInProduction(
        configWith({ stage: 'staging', frontendUrl: 'http://localhost:3000' })
      )
    ).toThrow(LocalhostInProductionError);
  });
});

describe('what the gate must NOT break', () => {
  it('never fires in development, where localhost is the right answer', () => {
    for (const stage of ['development', 'testing', 'qa'] as DeploymentStage[]) {
      expect(() =>
        assertNoLocalhostInProduction(
          configWith({
            stage,
            corsOrigins: ['http://localhost:3000'],
            frontendUrl: 'http://localhost:3000',
            backendUrl: 'http://localhost:3001',
          })
        )
      ).not.toThrow();
    }
  });

  it('allows a localhost origin ALONGSIDE the real domain', () => {
    // Deliberate and common: a developer pointing a local frontend at
    // staging. Only having nothing BUT localhost is the unset default, and
    // refusing the mixed case would break a legitimate setup to catch a
    // mistake that is not being made.
    expect(() =>
      assertNoLocalhostInProduction(
        configWith({ corsOrigins: ['https://synora.example.com', 'http://localhost:3000'] })
      )
    ).not.toThrow();
  });

  it('passes a fully configured production deployment', () => {
    expect(() => assertNoLocalhostInProduction(configWith({}))).not.toThrow();
  });

  it('does not object to plain http on a real host', () => {
    // TLS termination at a proxy is a legitimate architecture. Refusing on
    // the scheme would be an opinion; the loopback host is a fact.
    expect(() =>
      assertNoLocalhostInProduction(
        configWith({
          corsOrigins: ['http://synora.example.com'],
          frontendUrl: 'http://synora.example.com',
          backendUrl: 'http://api.synora.example.com',
        })
      )
    ).not.toThrow();
  });
});

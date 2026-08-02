import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server } from 'http';
import type { AddressInfo } from 'net';
import {
  isPublicAddress,
  performHttpToolRequest,
  ToolTransportError,
} from '../tool-transport';

/**
 * The SSRF guard is the security boundary between user-defined tool
 * configs and the network the backend sits on. The address-policy tests
 * pin the exact ranges that must never be reachable; the live-server
 * tests exercise the transport itself with a permissive policy (the
 * default policy correctly refuses the loopback test server — which is
 * itself asserted below).
 */

const allowAll = () => true;

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '127.8.8.8',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata endpoint
    '100.64.0.1', // CGNAT
    '198.18.0.1', // benchmarking
    '0.0.0.0',
    '224.0.0.1', // multicast
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1', // link-local
    'fc00::1', // unique local
    'fd12:3456::1',
    'ff02::1', // multicast
    '::ffff:127.0.0.1', // v4-mapped loopback
    '::ffff:10.0.0.1', // v4-mapped private
    '64:ff9b::a00:1', // NAT64
  ])('blocks %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946'])(
    'allows public address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    }
  );

  it('rejects non-IP garbage', () => {
    expect(isPublicAddress('not-an-ip')).toBe(false);
  });
});

describe('performHttpToolRequest', () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: { method?: string; url?: string; headers?: Record<string, unknown>; body?: string };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        lastRequest = {
          method: req.method,
          url: req.url,
          headers: req.headers as Record<string, unknown>,
          body: Buffer.concat(chunks).toString('utf8'),
        };

        if (req.url?.startsWith('/json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else if (req.url?.startsWith('/text')) {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('plain result');
        } else if (req.url?.startsWith('/missing')) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'nope' }));
        } else if (req.url?.startsWith('/boom')) {
          res.writeHead(503);
          res.end('unavailable');
        } else if (req.url?.startsWith('/redirect')) {
          res.writeHead(302, { location: 'http://127.0.0.1/internal' });
          res.end();
        } else if (req.url?.startsWith('/slow')) {
          setTimeout(() => {
            res.writeHead(200);
            res.end('finally');
          }, 5000);
        } else {
          res.writeHead(200);
          res.end('fallback');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('performs a POST with headers and JSON body, parsing a JSON response', async () => {
    const response = await performHttpToolRequest(
      {
        url: `${baseUrl}/json`,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'k-123' },
        body: JSON.stringify({ city: 'Paris' }),
        timeoutMs: 3000,
      },
      allowAll
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(lastRequest.method).toBe('POST');
    expect(lastRequest.headers?.['x-api-key']).toBe('k-123');
    expect(lastRequest.body).toBe('{"city":"Paris"}');
  });

  it('returns text bodies verbatim', async () => {
    const response = await performHttpToolRequest(
      { url: `${baseUrl}/text`, method: 'GET', headers: {}, timeoutMs: 3000 },
      allowAll
    );
    expect(response.body).toBe('plain result');
  });

  it('returns 4xx and 5xx responses instead of throwing (classification is the engine\'s job)', async () => {
    const notFound = await performHttpToolRequest(
      { url: `${baseUrl}/missing`, method: 'GET', headers: {}, timeoutMs: 3000 },
      allowAll
    );
    expect(notFound.statusCode).toBe(404);
    expect(notFound.body).toEqual({ error: 'nope' });

    const boom = await performHttpToolRequest(
      { url: `${baseUrl}/boom`, method: 'GET', headers: {}, timeoutMs: 3000 },
      allowAll
    );
    expect(boom.statusCode).toBe(503);
  });

  it('refuses to follow redirects', async () => {
    await expect(
      performHttpToolRequest(
        { url: `${baseUrl}/redirect`, method: 'GET', headers: {}, timeoutMs: 3000 },
        allowAll
      )
    ).rejects.toMatchObject({ retryable: false });
  });

  it('times out with a retryable, timedOut error', async () => {
    const promise = performHttpToolRequest(
      { url: `${baseUrl}/slow`, method: 'GET', headers: {}, timeoutMs: 300 },
      allowAll
    );
    await expect(promise).rejects.toBeInstanceOf(ToolTransportError);
    await expect(
      performHttpToolRequest(
        { url: `${baseUrl}/slow`, method: 'GET', headers: {}, timeoutMs: 300 },
        allowAll
      )
    ).rejects.toMatchObject({ retryable: true, timedOut: true });
  });

  it('blocks loopback targets under the DEFAULT address policy', async () => {
    await expect(
      performHttpToolRequest({ url: `${baseUrl}/json`, method: 'GET', headers: {}, timeoutMs: 3000 })
    ).rejects.toMatchObject({ retryable: false });
  });

  it('blocks hostnames that resolve to loopback under the default policy', async () => {
    await expect(
      performHttpToolRequest({
        url: `http://localhost:${(server.address() as AddressInfo).port}/json`,
        method: 'GET',
        headers: {},
        timeoutMs: 3000,
      })
    ).rejects.toThrow(/non-public address/);
  });

  it('rejects non-http protocols', async () => {
    await expect(
      performHttpToolRequest(
        { url: 'file:///etc/passwd', method: 'GET', headers: {}, timeoutMs: 1000 },
        allowAll
      )
    ).rejects.toMatchObject({ retryable: false });
  });
});

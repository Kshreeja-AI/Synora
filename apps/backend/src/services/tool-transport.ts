import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import type { LookupOptions, LookupAddress } from 'node:dns';
import { isIP } from 'node:net';

/**
 * Network transport for HTTP/Webhook tool executions.
 *
 * Tool configs are user-supplied, which makes every outbound request here
 * a server-side request forgery vector: a workspace member could point a
 * tool at 169.254.169.254, localhost, or an internal service and read the
 * response through the execution record. The guard below therefore
 * validates EVERY address a hostname resolves to (via the `lookup` hook,
 * so DNS answers can't swap in a private address between check and
 * connect), refuses IP-literal hosts in private ranges, and does not
 * follow redirects — a redirect to an internal address would bypass the
 * original hostname's validation.
 */

const MAX_RESPONSE_BYTES = 1_000_000;

export interface HttpToolRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Pre-serialized body; omitted for GET/HEAD requests. */
  body?: string;
  timeoutMs: number;
}

export interface HttpToolResponse {
  statusCode: number;
  contentType: string | null;
  /** Parsed JSON when the response declares it, raw text otherwise. */
  body: unknown;
}

export class ToolTransportError extends Error {
  readonly retryable: boolean;
  readonly timedOut: boolean;

  constructor(message: string, options: { retryable: boolean; timedOut?: boolean }) {
    super(message);
    this.name = 'ToolTransportError';
    this.retryable = options.retryable;
    this.timedOut = options.timedOut ?? false;
  }
}

/**
 * Injection point for tests only: the default policy blocks loopback, so
 * transport tests that need a local target server pass a permissive
 * policy explicitly. Production callers never override it.
 */
export type AddressPolicy = (address: string) => boolean;

function isPublicIPv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) return false;
  const [a, b] = octets;

  if (a === 0) return false; // 0.0.0.0/8 ("this network")
  if (a === 10) return false; // 10.0.0.0/8 private
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 CGNAT
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 private
  if (a === 192 && b === 0 && octets[2] === 0) return false; // 192.0.0.0/24 special
  if (a === 192 && b === 168) return false; // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 benchmarking
  if (a >= 224) return false; // multicast + reserved + broadcast
  return true;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIPv4(address);
  if (family !== 6) return false;

  const lower = address.toLowerCase();
  // IPv4-mapped/translated forms carry the v4 policy.
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPublicIPv4(v4Mapped[1]);
  if (lower.startsWith('64:ff9b:')) return false; // NAT64 → v4 space

  if (lower === '::' || lower === '::1') return false; // unspecified/loopback
  const firstGroup = parseInt(lower.split(':')[0] || '0', 16);
  if ((firstGroup & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((firstGroup & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((firstGroup & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}

function makeGuardedLookup(policy: AddressPolicy) {
  return (
    hostname: string,
    options: LookupOptions,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number
    ) => void
  ): void => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) {
        callback(err, '', 0);
        return;
      }
      const resolved = addresses as LookupAddress[];
      const blocked = resolved.find((entry) => !policy(entry.address));
      if (blocked || resolved.length === 0) {
        const guardError: NodeJS.ErrnoException = new Error(
          `Refusing to connect: "${hostname}" resolves to a non-public address`
        );
        guardError.code = 'EADDRBLOCKED';
        callback(guardError, '', 0);
        return;
      }
      if (options.all) {
        callback(null, resolved);
        return;
      }
      callback(null, resolved[0].address, resolved[0].family);
    });
  };
}

export function performHttpToolRequest(
  req: HttpToolRequest,
  addressPolicy: AddressPolicy = isPublicAddress
): Promise<HttpToolResponse> {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return Promise.reject(new ToolTransportError(`Invalid tool URL`, { retryable: false }));
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return Promise.reject(
      new ToolTransportError(`Unsupported URL protocol: ${url.protocol}`, { retryable: false })
    );
  }

  const hostLiteral = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostLiteral) && !addressPolicy(hostLiteral)) {
    return Promise.reject(
      new ToolTransportError('Refusing to connect to a non-public address', { retryable: false })
    );
  }

  return new Promise<HttpToolResponse>((resolve, reject) => {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    let settled = false;
    const fail = (error: ToolTransportError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const succeed = (response: HttpToolResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    };

    const request = requestFn(
      url,
      {
        method: req.method,
        headers: { 'user-agent': 'Synora-ToolEngine/1', ...req.headers },
        lookup: makeGuardedLookup(addressPolicy),
      },
      (response) => {
        const status = response.statusCode ?? 0;

        if (status >= 300 && status < 400) {
          response.resume();
          fail(
            new ToolTransportError(
              `Tool endpoint responded with a redirect (${status}); redirects are not followed`,
              { retryable: false }
            )
          );
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            response.destroy();
            request.destroy();
            fail(
              new ToolTransportError(
                `Tool response exceeded the ${MAX_RESPONSE_BYTES} byte limit`,
                { retryable: false }
              )
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const contentType = response.headers['content-type'] ?? null;
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown = text;
          if (contentType && contentType.includes('json') && text.length > 0) {
            try {
              body = JSON.parse(text);
            } catch {
              // Endpoint lied about its content type; keep the raw text.
            }
          }
          succeed({ statusCode: status, contentType, body });
        });
        response.on('error', (error) => {
          fail(new ToolTransportError(`Response failed: ${error.message}`, { retryable: true }));
        });
      }
    );

    // One timer covers the whole exchange (connect + request + response
    // body), because tool.timeout is a promise to the user about total
    // wall time, not per-socket idle time.
    const timer = setTimeout(() => {
      request.destroy();
      fail(
        new ToolTransportError(`Tool execution timed out after ${req.timeoutMs}ms`, {
          retryable: true,
          timedOut: true,
        })
      );
    }, req.timeoutMs);

    request.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRBLOCKED') {
        fail(new ToolTransportError(error.message, { retryable: false }));
        return;
      }
      fail(new ToolTransportError(`Request failed: ${error.message}`, { retryable: true }));
    });

    if (req.body !== undefined) {
      request.write(req.body);
    }
    request.end();
  });
}

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Server-Side Request Forgery defence for URLs Synora did not choose.
 *
 * THE THREAT, CONCRETELY. `replicateVideo.downloadVideo()` fetches a URL that
 * arrives inside a provider's JSON response. Synora runs that fetch from
 * inside the production network, where `postgres:5432`, `redis:6379` and
 * `app:3001` all resolve and none of them are reachable from the internet.
 * A compromised or malicious provider response therefore borrows Synora's
 * network position: it names an internal address, Synora dials it, and the
 * bytes come back. Cloud metadata endpoints (169.254.169.254) are the classic
 * prize because they hand out instance credentials to anyone who asks from
 * the right place.
 *
 * WHY THIS IS NOT A REGEX. A blocklist of strings loses to `0x7f.1`,
 * `2130706433`, `127.1`, `[::1]`, `localtest.me` (a public name resolving to
 * 127.0.0.1), and a redirect from a benign host to an internal one. The only
 * check that holds is: resolve the name to actual IP addresses, and judge the
 * ADDRESSES.
 *
 * WHAT THIS DOES NOT SOLVE, STATED PLAINLY. Between our DNS lookup and the
 * connection Node makes, an attacker controlling the name can change the
 * answer -- classic DNS rebinding. Closing that needs connecting to the
 * validated IP directly with the Host header preserved, which Node's fetch
 * does not expose. Every redirect hop IS re-validated, which removes the
 * cheap version of the attack; the rebinding window is a known, narrow
 * residual risk recorded here rather than papered over.
 */

export class SsrfBlockedError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly reason: string
  ) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

/** Ranges that must never be reachable from a provider-supplied URL. */
const BLOCKED_V4: ReadonlyArray<{ cidr: string; why: string }> = [
  { cidr: '0.0.0.0/8', why: 'this host' },
  { cidr: '10.0.0.0/8', why: 'private' },
  { cidr: '100.64.0.0/10', why: 'carrier-grade NAT' },
  { cidr: '127.0.0.0/8', why: 'loopback' },
  { cidr: '169.254.0.0/16', why: 'link-local, includes cloud metadata' },
  { cidr: '172.16.0.0/12', why: 'private — the Docker default range' },
  { cidr: '192.0.0.0/24', why: 'IETF protocol assignments' },
  { cidr: '192.0.2.0/24', why: 'documentation' },
  { cidr: '192.168.0.0/16', why: 'private' },
  { cidr: '198.18.0.0/15', why: 'benchmarking' },
  { cidr: '224.0.0.0/4', why: 'multicast' },
  { cidr: '240.0.0.0/4', why: 'reserved' },
];

function v4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function v4InCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

/**
 * Judge a single resolved address. Returns the reason it is blocked, or null.
 *
 * IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is unwrapped first: it is an IPv4
 * address wearing a different hat, and checking it only as v6 would wave
 * loopback straight through.
 */
export function blockedAddressReason(address: string): string | null {
  let addr = address.trim().toLowerCase();
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);

  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) addr = mapped[1];

  const kind = isIP(addr);

  if (kind === 4) {
    for (const { cidr, why } of BLOCKED_V4) {
      if (v4InCidr(addr, cidr)) return `${cidr} (${why})`;
    }
    return null;
  }

  if (kind === 6) {
    if (addr === '::' || addr === '::1') return 'IPv6 loopback/unspecified';
    if (/^f[cd]/.test(addr)) return 'fc00::/7 (unique local)';
    if (/^fe[89ab]/.test(addr)) return 'fe80::/10 (link-local)';
    if (/^ff/.test(addr)) return 'ff00::/8 (multicast)';
    return null;
  }

  return 'not a recognisable IP address';
}

/**
 * Throw unless `raw` is an http(s) URL whose every resolved address is public.
 *
 * Deliberately fail-closed: a name that will not resolve, or a scheme we do
 * not understand, is refused rather than attempted.
 */
export async function assertPublicUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError('Refusing to fetch a malformed URL', raw, 'unparseable');
  }

  // file:, ftp:, gopher:, data: — none of these belong on a download path, and
  // file: would read the container's own disk.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(
      `Refusing to fetch a non-HTTP URL`,
      raw,
      `scheme ${url.protocol}`
    );
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  // A single-label hostname cannot be a public DNS name, but IS exactly how
  // Docker services address each other: `postgres`, `redis`, `app`, `caddy`.
  if (isIP(host) === 0 && !host.includes('.')) {
    throw new SsrfBlockedError(
      'Refusing to fetch an internal-looking hostname',
      raw,
      'single-label hostname (container/service name)'
    );
  }

  // A literal IP needs no DNS; judge it directly.
  if (isIP(host) !== 0) {
    const reason = blockedAddressReason(host);
    if (reason) {
      throw new SsrfBlockedError('Refusing to fetch a non-public address', raw, reason);
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new SsrfBlockedError('Refusing to fetch an unresolvable host', raw, 'DNS lookup failed');
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError('Refusing to fetch a host with no addresses', raw, 'no DNS answer');
  }

  // EVERY address must be public. One private answer among several is enough
  // to be the one Node connects to.
  for (const { address } of addresses) {
    const reason = blockedAddressReason(address);
    if (reason) {
      throw new SsrfBlockedError('Refusing to fetch a non-public address', raw, reason);
    }
  }
}

/**
 * `fetch` for URLs Synora did not choose.
 *
 * Redirects are followed manually so each hop is validated. Automatic
 * following would let a public URL bounce to an internal one after the only
 * check had already passed — which is the standard way this defence is
 * defeated when it is applied to the first URL alone.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  maxRedirects = 3
): Promise<Response> {
  let current = raw;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);

    const response = await fetch(current, { ...init, redirect: 'manual' });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return response;
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }

  throw new SsrfBlockedError('Too many redirects', raw, `exceeded ${maxRedirects} hops`);
}

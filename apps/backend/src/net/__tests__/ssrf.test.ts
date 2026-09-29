import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// DNS is mocked so these tests assert OUR logic rather than the state of the
// internet, and so a hostile answer can be simulated deterministically.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'node:dns/promises';
import { assertPublicUrl, blockedAddressReason, safeFetch, SsrfBlockedError } from '../ssrf';

const mockLookup = lookup as unknown as ReturnType<typeof vi.fn>;
const resolvesTo = (...addresses: string[]) =>
  mockLookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));

describe('blockedAddressReason', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.1.1.1', 'loopback anywhere in 127/8'],
    ['0.0.0.0', 'this host'],
    ['10.1.2.3', 'private class A'],
    ['172.17.0.2', 'the Docker default bridge range'],
    ['192.168.1.10', 'private class C'],
    ['169.254.169.254', 'CLOUD METADATA — hands out instance credentials'],
    ['169.254.1.1', 'link-local generally'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['224.0.0.1', 'multicast'],
  ])('blocks %s (%s)', (ip) => {
    expect(blockedAddressReason(ip)).not.toBeNull();
  });

  it.each([['8.8.8.8'], ['1.1.1.1'], ['93.184.216.34'], ['200.234.32.93']])(
    'allows the public address %s',
    (ip) => {
      expect(blockedAddressReason(ip)).toBeNull();
    }
  );

  describe('IPv6', () => {
    it.each([['::1'], ['::'], ['fc00::1'], ['fd12:3456::1'], ['fe80::1'], ['ff02::1']])(
      'blocks %s',
      (ip) => expect(blockedAddressReason(ip)).not.toBeNull()
    );

    it('allows a public IPv6 address', () => {
      expect(blockedAddressReason('2606:4700:4700::1111')).toBeNull();
    });

    // The trap a v6-only check walks into: this IS 127.0.0.1.
    it('unwraps IPv4-mapped IPv6 rather than waving it through', () => {
      expect(blockedAddressReason('::ffff:127.0.0.1')).not.toBeNull();
      expect(blockedAddressReason('::ffff:169.254.169.254')).not.toBeNull();
    });
  });
});

describe('assertPublicUrl', () => {
  beforeEach(() => { mockLookup.mockReset(); });

  it('allows an ordinary public URL', async () => {
    resolvesTo('93.184.216.34');
    await expect(assertPublicUrl('https://replicate.delivery/out/video.mp4')).resolves.toBeUndefined();
  });

  it.each([
    ['http://localhost:3000/x', 'localhost'],
    ['http://127.0.0.1:6379/', 'loopback by literal IP'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['http://10.0.0.5:5432/', 'private range'],
    ['http://[::1]:8080/', 'IPv6 loopback in brackets'],
  ])('blocks %s (%s)', async (url) => {
    resolvesTo('127.0.0.1'); // for the hostname cases
    await expect(assertPublicUrl(url)).rejects.toThrow(SsrfBlockedError);
  });

  // The production-network case: these names exist only inside Docker.
  it.each([['http://postgres:5432/'], ['http://redis:6379/'], ['http://app:3001/'], ['http://caddy/']])(
    'blocks the container service name %s',
    async (url) => {
      await expect(assertPublicUrl(url)).rejects.toThrow(/internal-looking hostname/);
    }
  );

  it.each([['file:///etc/passwd'], ['ftp://example.com/x'], ['gopher://example.com/'], ['data:text/plain,hi']])(
    'blocks the non-HTTP scheme in %s',
    async (url) => {
      await expect(assertPublicUrl(url)).rejects.toThrow(/non-HTTP URL/);
    }
  );

  // A public name whose DNS answer points inward — the reason judging the
  // ADDRESS is the only thing that works. No string check catches this.
  it('blocks a public hostname that resolves to a private address', async () => {
    resolvesTo('127.0.0.1');
    await expect(assertPublicUrl('https://localtest.me/x')).rejects.toThrow(SsrfBlockedError);
  });

  it('blocks when ANY of several answers is private', async () => {
    resolvesTo('93.184.216.34', '10.0.0.7');
    await expect(assertPublicUrl('https://split-horizon.example/x')).rejects.toThrow(SsrfBlockedError);
  });

  it('fails closed when DNS cannot answer', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertPublicUrl('https://nx.example/x')).rejects.toThrow(/unresolvable/);
  });

  it('fails closed on an empty DNS answer', async () => {
    mockLookup.mockResolvedValue([]);
    await expect(assertPublicUrl('https://empty.example/x')).rejects.toThrow(/no addresses/);
  });

  it('refuses a malformed URL rather than attempting it', async () => {
    await expect(assertPublicUrl('not a url')).rejects.toThrow(/malformed/);
  });
});

describe('safeFetch redirect handling', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { mockLookup.mockReset(); });
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

  it('returns a normal response for a public URL', async () => {
    resolvesTo('93.184.216.34');
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 })) as never;
    const res = await safeFetch('https://cdn.example/video.mp4');
    expect(res.status).toBe(200);
  });

  // THE bypass this exists to stop: validate the first URL, then let the
  // server redirect inward. Automatic redirect-following checks only hop one.
  it('blocks a redirect from a public URL to an internal one', async () => {
    mockLookup.mockImplementation(async (host: string) =>
      host === 'cdn.example'
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }]
    );
    // ONE redirect, then a normal 200. An endlessly-repeating redirect would
    // also throw SsrfBlockedError -- via the hop limit -- and the test would
    // pass whether or not per-hop validation existed. Asserting the REASON is
    // what makes this test about address validation rather than about counting.
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
      )
      .mockResolvedValueOnce(new Response('instance-credentials', { status: 200 }));
    globalThis.fetch = f as never;

    await expect(safeFetch('https://cdn.example/video.mp4')).rejects.toMatchObject({
      name: 'SsrfBlockedError',
      reason: expect.stringContaining('169.254'),
    });
    // The second hop must never have been dialled.
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('stops a redirect loop rather than following it forever', async () => {
    resolvesTo('93.184.216.34');
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://cdn.example/again' } })
    ) as never;

    await expect(safeFetch('https://cdn.example/video.mp4', {}, 2)).rejects.toThrow(/Too many redirects/);
  });

  it('follows a legitimate public redirect — the guard must not break real downloads', async () => {
    resolvesTo('93.184.216.34');
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.example/final.mp4' } }))
      .mockResolvedValueOnce(new Response('bytes', { status: 200 }));
    globalThis.fetch = f as never;

    const res = await safeFetch('https://cdn.example/video.mp4');
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

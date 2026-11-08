/**
 * Web-search adapters against a deterministic fake fetch. Proves parsing,
 * citation URLs, limits and graceful failure. The live Wikipedia call is a
 * separate opt-in integration test (webSearch.integration.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config', () => ({ getConfig: vi.fn() }));

import { SearxngSearchProvider, WikipediaSearchProvider } from './webSearch.providers';

const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('WikipediaSearchProvider', () => {
  it('returns titled results with citable article URLs and plain-text snippets', async () => {
    const fetchImpl = json({
      query: { search: [{ title: 'Delhi Metro', snippet: 'The <span class="searchmatch">Delhi</span> Metro &amp; more' }, { snippet: 'no title' }] },
    });
    const out = await new WikipediaSearchProvider(fetchImpl).search({ query: 'delhi metro', limit: 3 });
    expect(out.provider).toBe('wikipedia');
    expect(out.results).toEqual([
      { title: 'Delhi Metro', url: 'https://en.wikipedia.org/wiki/Delhi_Metro', snippet: 'The Delhi Metro & more' },
    ]);
    const called = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0][0];
    expect(called).toContain('srlimit=3');
    expect(called).toContain('srsearch=delhi%20metro');
  });

  it('uses the language edition when given a valid code and ignores a malformed one', async () => {
    const hi = json({ query: { search: [] } });
    await new WikipediaSearchProvider(hi).search({ query: 'x', language: 'hi' });
    expect((hi as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]).toContain('https://hi.wikipedia.org/');
    const bad = json({ query: { search: [] } });
    await new WikipediaSearchProvider(bad).search({ query: 'x', language: 'evil.com/' });
    expect((bad as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]).toContain('https://en.wikipedia.org/');
  });

  it('clamps the limit to 1..10', async () => {
    const f = json({ query: { search: [] } });
    await new WikipediaSearchProvider(f).search({ query: 'x', limit: 999 });
    await new WikipediaSearchProvider(f).search({ query: 'x', limit: 0 });
    const calls = (f as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
    expect(calls[0]).toContain('srlimit=10');
    expect(calls[1]).toContain('srlimit=1');
  });

  it('fails gracefully with a typed error when unreachable, non-200, or malformed', async () => {
    const down = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(new WikipediaSearchProvider(down).search({ query: 'x' })).rejects.toMatchObject({ name: 'AIProviderError' });
    await expect(new WikipediaSearchProvider(json({}, 503)).search({ query: 'x' })).rejects.toThrow(/HTTP 503/);
    await expect(new WikipediaSearchProvider(json({ nope: 1 })).search({ query: 'x' })).rejects.toThrow(/unexpected shape/);
  });

  it('rejects empty and oversized queries before any network call', async () => {
    const f = json({});
    const p = new WikipediaSearchProvider(f);
    await expect(p.search({ query: '   ' })).rejects.toThrow(/empty/);
    await expect(p.search({ query: 'a'.repeat(301) })).rejects.toThrow(/300/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('SearxngSearchProvider', () => {
  it('maps results, keeps only http(s) links and respects the limit', async () => {
    const f = json({
      results: [
        { title: 'A', url: 'https://a.example/x', content: 'sa' },
        { title: 'B', url: 'javascript:alert(1)', content: 'sb' },
        { title: 'C', url: 'http://c.example', content: 'sc' },
        { title: 'D', url: 'https://d.example', content: 'sd' },
      ],
    });
    const out = await new SearxngSearchProvider('http://searx.local/', f).search({ query: 'q', limit: 2, language: 'hi' });
    expect(out.results.map((r) => r.url)).toEqual(['https://a.example/x', 'http://c.example']);
    const url = (f as unknown as { mock: { calls: [string][] } }).mock.calls[0][0];
    expect(url.startsWith('http://searx.local/search?')).toBe(true);
    expect(url).toContain('format=json');
    expect(url).toContain('language=hi');
  });

  it('reports an unexpected response shape instead of returning empty success', async () => {
    await expect(new SearxngSearchProvider('http://s', json({ error: 'x' })).search({ query: 'q' })).rejects.toThrow(/unexpected shape/);
  });
});

import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyDiscoveredPage, discoverPages, selectDiscoveredUrls } from '../src/page-discovery.js';

const servers: Server[] = [];

async function serve(handler: RequestListener): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port.');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('page discovery', () => {
  it('crawls one origin, canonicalizes duplicates, and leaves generated page types unchecked', async () => {
    const requests = new Map<string, number>();
    const { origin } = await serve((request, response) => {
      const path = request.url ?? '/';
      requests.set(path, (requests.get(path) ?? 0) + 1);
      response.setHeader('content-type', 'text/html; charset=utf-8');
      if (path === '/') {
        response.end(`<!doctype html><title>Home &amp; help</title>
          <a href="/about">About</a>
          <a href="/about#team">About fragment</a>
          <a href="/about?utm_source=test">About tracking</a>
          <a href="/jobs">Jobs</a>
          <a href="/category/news">News category</a>
          <a href="/search?q=a11y">Search</a>
          <a href="/guide.pdf">PDF</a>
          <a href="https://example.com/outside">Outside</a>`);
        return;
      }
      response.end(`<title>${path}</title><a href="/">Home</a>`);
    });

    const result = await discoverPages(`${origin}/`, { maxDepth: 2 });

    expect(result.seedUrl).toBe(`${origin}/`);
    expect(result.candidates.map((candidate) => candidate.url)).toEqual([
      `${origin}/`,
      `${origin}/about`,
      `${origin}/jobs`,
      `${origin}/category/news`,
      `${origin}/search?q=a11y`
    ]);
    expect(result.candidates[0]?.title).toBe('Home & help');
    expect(result.candidates.find((candidate) => candidate.url.endsWith('/about'))?.recommended).toBe(true);
    expect(result.candidates.find((candidate) => candidate.url.endsWith('/jobs'))).toMatchObject({
      category: 'jobs', recommended: false
    });
    expect(result.candidates.find((candidate) => candidate.url.endsWith('/category/news'))).toMatchObject({
      category: 'taxonomy', recommended: false
    });
    expect(result.candidates.find((candidate) => candidate.url.includes('/search?'))).toMatchObject({
      category: 'utility', recommended: false
    });
    expect(requests.get('/about')).toBe(1);
    expect(requests.has('/about?utm_source=test')).toBe(false);
    expect(result.discoveryDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not follow a redirect outside the approved origin', async () => {
    let outsideRequests = 0;
    const outside = await serve((_request, response) => {
      outsideRequests += 1;
      response.setHeader('content-type', 'text/html');
      response.end('<title>Outside</title>');
    });
    const inside = await serve((_request, response) => {
      response.statusCode = 302;
      response.setHeader('location', `${outside.origin}/outside`);
      response.end();
    });

    const result = await discoverPages(`${inside.origin}/`);

    expect(outsideRequests).toBe(0);
    expect(result.errors).toEqual([{
      url: `${inside.origin}/`,
      message: 'A redirect left the approved origin and was not followed.'
    }]);
  });

  it('collapses a same-origin redirect alias into its final unique URL', async () => {
    const { origin } = await serve((request, response) => {
      if (request.url === '/') {
        response.statusCode = 301;
        response.setHeader('location', '/home');
        response.end();
        return;
      }
      response.setHeader('content-type', 'text/html');
      response.end('<title>Home</title><a href="/">Old home URL</a>');
    });

    const result = await discoverPages(`${origin}/`);

    expect(result.candidates).toEqual([expect.objectContaining({ url: `${origin}/home`, title: 'Home' })]);
    expect(result.fetchedPageCount).toBe(1);
  });

  it('caps discovery explicitly and validates selected pages against the current result', async () => {
    const { origin } = await serve((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end('<a href="/one">One</a><a href="/two">Two</a><a href="/three">Three</a>');
    });
    const result = await discoverPages(`${origin}/`, { maxPages: 2, maxDepth: 1 });

    expect(result.candidates).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(selectDiscoveredUrls(result, [`${origin}/one`, `${origin}/one#duplicate`])).toEqual([`${origin}/one`]);
    expect(() => selectDiscoveredUrls(result, [`${origin}/not-discovered`])).toThrow(
      'The selected URL was not in the current discovery result'
    );
  });

  it('classifies ordinary content separately from jobs, taxonomies, utilities, and query variants', () => {
    expect(classifyDiscoveredPage('https://example.test/about')).toMatchObject({ category: 'content', recommended: true });
    expect(classifyDiscoveredPage('https://example.test/careers/openings')).toMatchObject({ category: 'jobs', recommended: false });
    expect(classifyDiscoveredPage('https://example.test/tag/accessibility')).toMatchObject({ category: 'taxonomy', recommended: false });
    expect(classifyDiscoveredPage('https://example.test/login')).toMatchObject({ category: 'utility', recommended: false });
    expect(classifyDiscoveredPage('https://example.test/product?colour=blue')).toMatchObject({ category: 'query-variant', recommended: false });
  });

  it('leaves terminal date archives unchecked without excluding dated articles', () => {
    expect(classifyDiscoveredPage('https://example.test/2026/')).toMatchObject({ category: 'taxonomy', recommended: false });
    expect(classifyDiscoveredPage('https://example.test/news/2026/10/')).toMatchObject({ category: 'taxonomy', recommended: false });
    expect(classifyDiscoveredPage('https://example.test/2026/10/09/')).toMatchObject({ category: 'taxonomy', recommended: false });
    expect(classifyDiscoveredPage('https://example.test/2026/10/09/accessible-design')).toMatchObject({
      category: 'content', recommended: true
    });
  });

  it('ignores links in comments and inert markup while sanitizing untrusted titles', async () => {
    const { origin } = await serve((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><title>Café\u001b\u202e 東京</title>
        <!-- <a href="/comment">Comment</a> -->
        <script>const example = '</template><a href="/script">Script</a>';</script>
        <template><a href="/template">Template</a></template>
        <style>.example { content: '<a href="/style">Style</a>'; }</style>
        <a href="/live">Live</a>`);
    });

    const result = await discoverPages(`${origin}/`, { maxDepth: 1 });

    expect(result.candidates.map((candidate) => candidate.url)).toEqual([`${origin}/`, `${origin}/live`]);
    expect(result.candidates[0]?.title).toBe('Café 東京');
  });

  it('truncates discovered titles by Unicode code point without splitting surrogate pairs', async () => {
    const title = `${'a'.repeat(159)}😀ignored`;
    const { origin } = await serve((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(`<title>${title}</title>`);
    });

    const result = await discoverPages(`${origin}/`);
    const discoveredTitle = result.candidates[0]?.title ?? '';

    expect([...discoveredTitle]).toHaveLength(160);
    expect(discoveredTitle).toBe(`${'a'.repeat(159)}😀`);
  });

  it('does not report depth truncation for duplicate, external, or asset links', async () => {
    const { origin } = await serve((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end('<a href="/">Same page</a><a href="https://elsewhere.example/page">External</a><a href="/logo.svg">Asset</a>');
    });

    const result = await discoverPages(`${origin}/`, { maxDepth: 0 });

    expect(result.truncated).toBe(false);
  });
});

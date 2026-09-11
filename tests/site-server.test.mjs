import { describe, expect, it, vi } from 'vitest';
import siteWorker from '../site/server.js';

describe('site worker', () => {
  it('serves the requested static asset without using a GitHub credential', async () => {
    const fetchAsset = vi.fn().mockResolvedValue(new globalThis.Response('site', { status: 200 }));
    const request = new globalThis.Request('https://launcher.example/styles.css');

    const response = await siteWorker.fetch(request, { ASSETS: { fetch: fetchAsset } });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('site');
    expect(fetchAsset).toHaveBeenCalledWith(request);
  });

  it('falls back to the home page only for extension-free GET routes', async () => {
    const fetchAsset = vi.fn()
      .mockResolvedValueOnce(new globalThis.Response('missing', { status: 404 }))
      .mockResolvedValueOnce(new globalThis.Response('home', { status: 200 }));

    const response = await siteWorker.fetch(
      new globalThis.Request('https://launcher.example/get-started'),
      { ASSETS: { fetch: fetchAsset } }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('home');
    expect(fetchAsset).toHaveBeenCalledTimes(2);
    expect(new globalThis.URL(fetchAsset.mock.calls[1][0].url).pathname).toBe('/');
  });

  it('returns a service error when static assets are unavailable', async () => {
    const response = await siteWorker.fetch(new globalThis.Request('https://launcher.example/'), {});
    expect(response.status).toBe(503);
  });
});

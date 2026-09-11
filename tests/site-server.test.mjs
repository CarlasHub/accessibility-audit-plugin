import { describe, expect, it, vi } from 'vitest';
import { handleAuditRequest, normalizeAuditUrls } from '../site/server.js';

function launchRequest(urls, authenticated = true) {
  const headers = {
    'content-type': 'application/json',
    origin: 'https://launcher.example'
  };
  if (authenticated) headers['oai-authenticated-user-id'] = 'test-user';

  return new globalThis.Request('https://launcher.example/api/audits', {
    method: 'POST',
    headers,
    body: JSON.stringify({ urls })
  });
}

describe('site audit launcher', () => {
  it('normalizes public HTTPS pages and rejects unsafe targets', () => {
    expect(normalizeAuditUrls([' https://Example.com/path#section '])).toEqual(['https://example.com/path']);
    expect(() => normalizeAuditUrls(['http://example.com'])).toThrow(/require HTTPS/);
    expect(() => normalizeAuditUrls(['https://localhost'])).toThrow(/public hostname/);
    expect(() => normalizeAuditUrls(['https://127.0.0.1'])).toThrow(/public hostname/);
    expect(() => normalizeAuditUrls(['https://[::1]'])).toThrow(/public hostname/);
  });

  it('dispatches the central workflow and returns its exact run page', async () => {
    const githubFetch = vi.fn().mockResolvedValue(
      new globalThis.Response(JSON.stringify({ html_url: 'https://github.com/CarlasHub/accessibility-audit-plugin/actions/runs/123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const response = await handleAuditRequest(
      launchRequest(['https://example.com/', 'https://example.org/help']),
      { GITHUB_ACTIONS_TOKEN: 'test-token' },
      githubFetch
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      exactRun: true,
      pages: 2,
      runUrl: 'https://github.com/CarlasHub/accessibility-audit-plugin/actions/runs/123'
    });
    expect(githubFetch).toHaveBeenCalledOnce();
    const [url, options] = githubFetch.mock.calls[0];
    expect(url).toContain('/actions/workflows/accessibility-audit.yml/dispatches');
    expect(options.headers.authorization).toBe('Bearer test-token');
    const body = JSON.parse(options.body);
    expect(body.ref).toBe('main');
    expect(body.return_run_details).toBe(true);
    expect(body.inputs['target-url']).toBe('https://example.com/\nhttps://example.org/help');
    expect(body.inputs['request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('requires authenticated access and a server-side GitHub credential', async () => {
    const githubFetch = vi.fn();
    const signedOut = await handleAuditRequest(launchRequest(['https://example.com'], false), {}, githubFetch);
    expect(signedOut.status).toBe(401);

    const unconfigured = await handleAuditRequest(launchRequest(['https://example.com']), {}, githubFetch);
    expect(unconfigured.status).toBe(503);
    expect(githubFetch).not.toHaveBeenCalled();
  });

  it('rejects cross-origin launch attempts', async () => {
    const request = new globalThis.Request('https://launcher.example/api/audits', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.example',
        'oai-authenticated-user-id': 'test-user'
      },
      body: JSON.stringify({ urls: ['https://example.com'] })
    });

    const response = await handleAuditRequest(request, { GITHUB_ACTIONS_TOKEN: 'test-token' }, vi.fn());
    expect(response.status).toBe(403);
  });
});

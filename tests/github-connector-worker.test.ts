import { describe, expect, it } from 'vitest';
import {
  createSignedState,
  encodeGitHubContent,
  type ConnectorEnvironment,
  validateReturnUrl,
  verifySignedState,
  default as connector
} from '../connector/src/index.js';

function environment(): ConnectorEnvironment {
  return {
    ALLOWED_ORIGINS: 'https://carlashub.github.io,http://127.0.0.1:4173',
    GITHUB_APP_SLUG: 'carlashub-accessibility-audit',
    GITHUB_CLIENT_ID: 'Iv1.example',
    GITHUB_CLIENT_SECRET: 'test-secret-that-is-not-deployed',
    SESSIONS: {
      async get() { return null; },
      async put() { /* Test double. */ }
    },
    STATE_SECRET: 'separate-state-secret'
  };
}

describe('GitHub connector security boundaries', () => {
  it('allows return paths only on an exact configured origin', () => {
    const result = validateReturnUrl(
      'https://carlashub.github.io/accessibility-audit-plugin/?step=github#ignored',
      environment()
    );

    expect(result.href).toBe('https://carlashub.github.io/accessibility-audit-plugin/?step=github');
    expect(() => validateReturnUrl('https://carlashub.github.io.evil.example/', environment()))
      .toThrow('not allowed');
    expect(() => validateReturnUrl('https://user:password@carlashub.github.io/', environment()))
      .toThrow('not allowed');
  });

  it('round-trips a valid signed OAuth state', async () => {
    const state = {
      expiresAt: Date.now() + 60_000,
      nonce: 'abcdefghijklmnopqrstuvwxyz123456',
      returnTo: 'https://carlashub.github.io/accessibility-audit-plugin/'
    };

    const signed = await createSignedState(state, environment());
    await expect(verifySignedState(signed, environment())).resolves.toEqual(state);
  });

  it('rejects altered and expired OAuth state', async () => {
    const signed = await createSignedState({
      expiresAt: Date.now() - 1,
      nonce: 'abcdefghijklmnopqrstuvwxyz123456',
      returnTo: 'https://carlashub.github.io/accessibility-audit-plugin/'
    }, environment());

    await expect(verifySignedState(`${signed.slice(0, -1)}x`, environment())).rejects.toThrow('invalid');
    await expect(verifySignedState(signed, environment())).rejects.toThrow('expired');
  });

  it('encodes Unicode workflow content as GitHub-compatible base64', () => {
    const content = 'name: Accessibility audit — Café\n';
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(encodeGitHubContent(content)), (character) => character.charCodeAt(0)));

    expect(decoded).toBe(content);
  });

  it('returns a safe client error for an invalid setup request', async () => {
    const testEnvironment = environment();
    testEnvironment.SESSIONS = {
      async get() {
        return JSON.stringify({ token: 'test-token', expiresAt: Date.now() + 60_000 });
      },
      async put() { /* Test double. */ }
    };
    const response = await connector.fetch(new Request('https://connector.example/api/setup', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${'a'.repeat(32)}`,
        'Content-Type': 'application/json',
        Origin: 'https://carlashub.github.io'
      },
      body: JSON.stringify({ repository: 'not-a-repository', urls: ['https://example.com/'] })
    }), testEnvironment);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ message: expect.any(String) });
  });
});

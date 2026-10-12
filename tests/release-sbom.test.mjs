import { describe, expect, it } from 'vitest';
import { uuidV5 } from '../scripts/lib/release-sbom.mjs';

describe('release SBOM UUID generation', () => {
  it('matches the RFC 9562 UUIDv5 reference vector', () => {
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com'))
      .toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('rejects malformed UUID namespaces', () => {
    expect(() => uuidV5('not-a-uuid', 'www.example.com'))
      .toThrow('UUIDv5 namespace must be an RFC 4122 UUID.');
  });
});

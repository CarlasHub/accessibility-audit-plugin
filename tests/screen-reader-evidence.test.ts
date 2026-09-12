import { describe, expect, it } from 'vitest';
import {
  assertScreenReaderEvidence,
  screenReaderEvidenceValidationErrors,
  type ScreenReaderEvidenceDocument
} from '../src/audit/screen-reader-evidence.js';

function validEvidence(): ScreenReaderEvidenceDocument {
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-12T10:00:00.000Z',
    targetUrl: 'https://example.com/checkout',
    screenReader: 'VoiceOver',
    status: 'evidence-captured',
    environment: {
      operatingSystem: 'darwin 25 arm64',
      node: 'v22.0.0',
      browser: 'webkit',
      browserVersion: '1.2.3',
      guidepup: '0.33.1'
    },
    journey: [{ command: 'Move to next heading', spokenPhrase: 'Checkout, heading level one' }],
    transcript: ['Checkout, heading level one'],
    pageInventory: {
      documentTitle: 'Checkout',
      language: 'en',
      headings: [{ level: 1, text: 'Checkout' }],
      landmarks: ['main'],
      interactiveElementCount: 3
    },
    warnings: [],
    conformanceNotice: 'Qualified human review is required before any conformance decision.'
  };
}

describe('native screen-reader evidence schema', () => {
  it('accepts complete, traceable evidence without treating it as conformance', () => {
    const evidence = validEvidence();
    expect(() => assertScreenReaderEvidence(evidence)).not.toThrow();
    expect(evidence.conformanceNotice).toMatch(/human review/i);
  });

  it('rejects a captured status without an actual transcript', () => {
    const evidence = { ...validEvidence(), transcript: [] };
    expect(screenReaderEvidenceValidationErrors(evidence)).toContain('evidence-captured status requires a transcript');
    expect(() => assertScreenReaderEvidence(evidence)).toThrow(/requires a transcript/);
  });

  it('rejects evidence without environment provenance or a valid target URL', () => {
    const evidence = { ...validEvidence(), targetUrl: 'file:///tmp/page.html', environment: {} };
    const errors = screenReaderEvidenceValidationErrors(evidence);
    expect(errors).toContain('targetUrl must use http or https');
    expect(errors).toContain('environment.browserVersion is required');
  });
});

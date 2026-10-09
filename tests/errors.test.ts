import { describe, expect, it } from 'vitest';
import {
  cliDebugEnabled,
  formatCliError,
  redactAuditProgressEvent,
  redactSensitiveText,
  toActionableAuditError
} from '../src/errors.js';
import { JourneyBuilderInputError } from '../src/journey-builder.js';
import { JourneyDraftError } from '../src/journey-drafts.js';
import { JourneyApprovalError } from '../src/journey-approval.js';
import { JourneyValidationError } from '../src/journey-validation.js';

describe('actionable audit errors', () => {
  it.each([
    ['file-read', 'Correct the draft path'],
    ['invalid-json', 'Correct the draft JSON syntax'],
    ['invalid-draft', 'Use a draft created by'],
    ['invalid-schema', 'Correct every reported candidateJourneys field'],
    ['file-exists', 'Choose a different --output path'],
    ['file-write', 'Create a writable parent directory']
  ] as const)('gives %s journey-approval failures approval-specific recovery', (code, recovery) => {
    const formatted = formatCliError(new JourneyApprovalError(code, 'Safe approval detail.'));

    expect(formatted).toContain(`Journey draft could not be approved (${code}).`);
    expect(formatted).toContain(recovery);
    expect(formatted).not.toContain('Accessibility audit failed');
  });

  it('keeps approval paths private by default and exposes them only for local debugging', () => {
    const localPath = '/Users/carla/private/review.draft.json';
    const error = new JourneyApprovalError('file-read', `Could not read the journey draft "${localPath}".`);

    expect(formatCliError(error)).not.toContain(localPath);
    expect(formatCliError(error, true)).toContain(localPath);
  });

  it('reports journey validation errors without claiming an audit failed', () => {
    const formatted = formatCliError(new JourneyValidationError('invalid-schema', 'journeys[0].steps: Required.'));

    expect(formatted).toContain('Journey validation failed (invalid-schema).');
    expect(formatted).toContain('journeys[0].steps: Required.');
    expect(formatted).not.toContain('Accessibility audit failed');
    expect(formatted).not.toContain('Retry the audit');
  });

  it.each([
    ['file-read', 'Check the file path and permissions'],
    ['invalid-json', 'Correct the JSON syntax'],
    ['invalid-schema', 'Correct the reported journey fields']
  ] as const)('preserves the %s journey-validation code and recovery', (code, recovery) => {
    const formatted = formatCliError(new JourneyValidationError(code, 'Safe validation detail.'));
    expect(formatted).toContain(`Journey validation failed (${code}).`);
    expect(formatted).toContain(recovery);
  });

  it.each([
    ['file-read', 'Correct the source path or its read permissions'],
    ['invalid-json', 'Correct the source JSON syntax'],
    ['invalid-schema', 'Use a journey object, a journey array'],
    ['file-exists', 'Choose a different --output path'],
    ['file-write', 'Create a writable parent directory']
  ] as const)('gives %s journey-draft failures draft-specific recovery', (code, recovery) => {
    const formatted = formatCliError(new JourneyDraftError(code, 'Safe draft detail.'));

    expect(formatted).toContain(`Journey draft could not be saved (${code}).`);
    expect(formatted).toContain(recovery);
    expect(formatted).toContain('accessibility-audit journeys draft [path] [--output <path>]');
    expect(formatted).not.toContain('journeys validate');
    expect(formatted).not.toContain('Accessibility audit failed');
  });

  it('keeps local draft paths out of default output and exposes them only in debug output', () => {
    const localPath = '/Users/carla/private/incomplete.json';
    const error = new JourneyDraftError('file-read', `Could not read the journey draft source "${localPath}".`);

    expect(formatCliError(error)).not.toContain(localPath);
    expect(formatCliError(error, true)).toContain(localPath);
  });
  it('reports journey builder input errors without claiming an audit failed', () => {
    const formatted = formatCliError(new JourneyBuilderInputError('Journey field "id" is invalid.'));

    expect(formatted).toContain('Journey could not be created (invalid-input).');
    expect(formatted).toContain('Journey field "id" is invalid.');
    expect(formatted).not.toContain('Accessibility audit failed');
    expect(formatted).not.toContain('Retry the audit');
  });
  it.each([
    ['No supported Chromium browser is available.', 'browser-unavailable'],
    ['Playwright browser installation failed: network unavailable.', 'browser-install-failed'],
    ['Invalid allowed host "example.test/path".', 'scope-restricted'],
    ['The selected template does not match the bundled template.', 'template-invalid'],
    ['Generated workbook validation failed: missing Summary.', 'report-validation-failed'],
    ['At least one URL or page-list file is required.', 'invalid-input'],
    ['Journey drafts are non-runnable and cannot be used as audit configuration.', 'invalid-input']
  ])('classifies %s', (message, code) => {
    expect(toActionableAuditError(new Error(message))).toEqual(expect.objectContaining({
      code,
      message,
      retryable: true,
      nextSteps: expect.arrayContaining([expect.any(String)])
    }));
  });

  it.each([
    ['Navigation blocked: Host sub.example.test is not in the exact-host list.', 'scope-restricted'],
    ['Host sub.example.test is not in the allowed-host list.', 'scope-restricted'],
    ['Host example.com does not look like a staging host.', 'scope-restricted'],
    ['All discovered URLs were excluded by the host restrictions.', 'scope-restricted'],
    ['Unsupported or invalid target URL. Supply an HTTP(S) URL without embedded credentials.', 'invalid-input'],
    ['Invalid explicit URL list entry 2. Supply a complete HTTP(S) URL without embedded credentials.', 'invalid-input'],
    ['Invalid explicit URL list JSON syntax. Supply a valid JSON array of HTTP(S) URL strings.', 'invalid-input'],
    ['URLs containing embedded usernames or passwords are not supported.', 'invalid-input'],
    ['No HTTP(S) URLs were found in the supplied input.', 'invalid-input'],
    ['Quick Audit requires one valid HTTP(S) URL.', 'invalid-input'],
    ["Executable doesn't exist at /browser/chromium", 'browser-unavailable']
  ])('classifies the production failure %s', (message, code) => {
    expect(toActionableAuditError(new Error(message)).code).toBe(code);
  });

  it.each([
    ['Firefox', 'firefox'],
    ['WebKit', 'webkit']
  ] as const)('provides %s-specific unavailable-browser recovery', (label, engine) => {
    const actionable = toActionableAuditError(new Error(
      `No supported ${label} browser is currently available. Run "npx playwright install ${engine}" in the plugin directory.`
    ));
    const recovery = actionable.nextSteps.join(' ');

    expect(actionable.code).toBe('browser-unavailable');
    expect(recovery).toContain(`playwright install ${engine}`);
    expect(recovery.toLowerCase()).not.toContain('chromium');
    expect(recovery.toLowerCase()).not.toContain('browser channel');
  });

  it.each([
    ['Chromium', 'chromium'],
    ['Firefox', 'firefox'],
    ['WebKit', 'webkit']
  ] as const)('provides %s-specific installation-failure recovery', (label, engine) => {
    const actionable = toActionableAuditError(new Error(`Playwright ${label} installation failed with exit code 1.`));
    const recovery = actionable.nextSteps.join(' ');

    expect(actionable.code).toBe('browser-install-failed');
    expect(recovery).toContain(`playwright install ${engine}`);
    expect(recovery).toContain(`after ${label} is available`);
    for (const otherEngine of ['chromium', 'firefox', 'webkit'].filter((item) => item !== engine)) {
      expect(recovery.toLowerCase()).not.toContain(`playwright install ${otherEngine}`);
    }
  });

  it('uses neutral recovery for an executable-path failure without a safely inferable engine', () => {
    const actionable = toActionableAuditError(new Error('Configured browser executable is unavailable.'));
    const recovery = actionable.nextSteps.join(' ').toLowerCase();

    expect(actionable.code).toBe('browser-unavailable');
    expect(recovery).toContain('selected playwright browser');
    expect(recovery).not.toContain('chromium');
    expect(recovery).not.toContain('browser channel');
  });

  it('keeps the generic fallback for an unknown production failure', () => {
    expect(toActionableAuditError(new Error('An unrecognized subsystem stopped.')).code).toBe('audit-failed');
  });

  it('gives a draft-specific recovery path instead of suggesting another audit retry', () => {
    const formatted = formatCliError(new Error('Journey drafts are non-runnable and cannot be used as audit configuration.'));

    expect(formatted).toContain('Keep incomplete work in candidateJourneys');
    expect(formatted).toContain('Approve the draft only after every candidate passes strict journey validation');
    expect(formatted).not.toContain('Retry the audit once');
  });

  it('classifies filesystem write failures without exposing a stack by default', () => {
    const error = Object.assign(new Error('EACCES: permission denied, mkdir /reports'), { code: 'EACCES' });
    const formatted = formatCliError(error);

    expect(formatted).toContain('Accessibility audit failed (output-unavailable).');
    expect(formatted).toContain('Try this next:');
    expect(formatted).toContain('ACCESSIBILITY_AUDIT_DEBUG=1');
    expect(formatted).not.toContain('\n    at ');
  });

  it('includes stack details only when debug output is explicitly enabled', () => {
    const error = new Error('Unexpected audit failure.');
    error.stack = 'Error: Unexpected audit failure.\n    at audit (audit.ts:10:2)';

    expect(formatCliError(error, true)).toContain('at audit (audit.ts:10:2)');
    expect(formatCliError(error, false)).not.toContain('at audit (audit.ts:10:2)');
    expect(cliDebugEnabled('YES')).toBe(true);
    expect(cliDebugEnabled('0')).toBe(false);
  });

  it.each([
    '/Users/carla/private/reports/audit.xlsx',
    '/Users/carla/My Reports/a(b)/audit.xlsx',
    String.raw`C:\Users\Carla\Private\reports\audit.xlsx`,
    String.raw`C:\Users\Carla\My Reports\a(b)\audit.xlsx`,
    String.raw`\\fileserver\private share\a(b)\audit.xlsx`,
    'file:///Users/carla/My%20Reports/a(b)/audit.xlsx'
  ])('redacts the local path %s by default and exposes it only in debug output', (localPath) => {
    const error = Object.assign(new Error(`EACCES: permission denied, open '${localPath}'`), { code: 'EACCES' });
    error.stack = `Error: EACCES: permission denied, open '${localPath}'\n    at writeReport (report.ts:10:2)`;

    expect(formatCliError(error)).not.toContain(localPath);
    expect(formatCliError(error)).not.toContain('My Reports');
    expect(formatCliError(error)).not.toContain('private share');
    expect(formatCliError(error)).not.toContain('a(b)');
    expect(toActionableAuditError(error).message).toContain('[local path]');
    expect(formatCliError(error, true)).toContain(localPath);
  });

  it.each([
    [String.raw`C:\Users\Carla\My Reports\audit.xlsx`, 'C:\\'],
    ['file:///Users/carla/My%20Reports/audit.xlsx', 'file://']
  ])('redacts the complete path token without leaving its %s prefix', (localPath, exposedPrefix) => {
    const result = toActionableAuditError(new Error(`EACCES: permission denied, open '${localPath}'`));

    expect(result.message).toBe('EACCES: permission denied, open [local path]');
    expect(result.message).not.toContain(exposedPrefix);
  });

  it('normalizes control characters in messages returned to users', () => {
    const result = toActionableAuditError(new Error('Unexpected\nmultiline\tfailure'));
    expect(result.message).toBe('Unexpected multiline failure');
  });

  it('preserves complete HTTPS URLs, including query values that begin with a slash', () => {
    const message = 'Request failed at https://example.test/a/b?next=/c';
    expect(toActionableAuditError(new Error(message)).message).toBe(message);
    expect(formatCliError(new Error(message))).toContain(message);
  });

  it('redacts credentials and sensitive URL values while preserving useful URL context', () => {
    const result = redactSensitiveText(
      'Request failed at https://carla:password@example.test/callback?access_token=abc123&next=/dashboard#id_token=def456'
    );

    expect(result).toContain('https://[redacted]@example.test/callback');
    expect(result).toContain('access_token=[redacted]');
    expect(result).toContain('next=/dashboard');
    expect(result).toContain('id_token=[redacted]');
    expect(result).not.toMatch(/carla|password|abc123|def456/);
  });

  it('fails closed for deeply encoded and malformed URL parameter names', () => {
    const result = redactSensitiveText(
      'Request failed at https://public.example/path?access%252525255Ftoken=deep-secret&access%ZZtoken=malformed-secret&refresh%5Ftoken=single-secret&next=/public#ID%252DToken=fragment-secret'
    );

    expect(result).toBe(
      'Request failed at https://public.example/path?access%252525255Ftoken=[redacted]&access%ZZtoken=[redacted]&refresh%5Ftoken=[redacted]&next=/public#ID%252DToken=[redacted]'
    );
    expect(result).not.toMatch(/deep-secret|malformed-secret|single-secret|fragment-secret/);
  });

  it('redacts complete quoted environment values without dropping adjacent diagnostics', () => {
    const result = redactSensitiveText(
      String.raw`TOKEN="alpha beta \"gamma\""; retry public endpoint. CLIENT_SECRET='delta epsilon \'zeta\''; status 401.`
    );

    expect(result).toBe(
      'TOKEN="[redacted]"; retry public endpoint. CLIENT_SECRET=\'[redacted]\'; status 401.'
    );
    expect(result).not.toMatch(/alpha|beta|gamma|delta|epsilon|zeta/);
  });

  it.each([
    [
      'Authorization: Bearer header-secret; request https://public.example/path failed',
      'Authorization: [redacted]; request https://public.example/path failed'
    ],
    [
      'Cookie: session=cookie-secret; theme=dark; status 401 at https://public.example/login',
      'Cookie: [redacted]; status 401 at https://public.example/login'
    ],
    [
      'Cookie: sid=period-secret. Request https://public.example/login failed',
      'Cookie: [redacted]. Request https://public.example/login failed'
    ],
    [
      'X-API-Key: guidance-secret. Please retry the public endpoint',
      'X-API-Key: [redacted]. Please retry the public endpoint'
    ],
    [
      'Proxy-Authorization: Basic recovery-secret. Contact the service owner',
      'Proxy-Authorization: [redacted]. Contact the service owner'
    ],
    [
      'Set-Cookie: sid=recovery-secret. To recover, sign in again',
      'Set-Cookie: [redacted]. To recover, sign in again'
    ],
    [
      'Authorization: Digest realm="Private. Please do not expose", nonce="secret"',
      'Authorization: [redacted]'
    ],
    [
      'Authorization: Digest realm="Private; request do not expose", nonce="secret". Please retry safely',
      'Authorization: [redacted]. Please retry safely'
    ],
    [
      'Authorization: Digest realm="Private, request hidden | retry hidden -> next hidden (status 200)", nonce="secret". Contact the service owner',
      'Authorization: [redacted]. Contact the service owner'
    ],
    [
      'Authorization: Digest realm="Private, status: 200", nonce="secret". To recover, sign in again',
      'Authorization: [redacted]. To recover, sign in again'
    ],
    [
      'authorization: Digest username="carla", nonce="digest-secret", status: 401',
      'authorization: [redacted], status: 401'
    ]
  ])('redacts an inline header while preserving public failure context', (message, expected) => {
    expect(redactSensitiveText(message)).toBe(expected);
  });

  it.each([
    String.raw`Authorization: Digest realm=\"Private; request hidden\", nonce=\"secret\". Please retry safely`,
    String.raw`Authorization: Digest realm=\"Private, request hidden\", nonce=\"secret\". Please retry safely`,
    String.raw`Authorization: Digest realm=\"Private | retry hidden\", nonce=\"secret\". Please retry safely`,
    String.raw`Authorization: Digest realm=\"Private -> next hidden\", nonce=\"secret\". Please retry safely`,
    String.raw`Authorization: Digest realm=\"Private, status: 200\", nonce=\"secret\". Please retry safely`,
    String.raw`Authorization: Digest realm=\"Private (status 200)\", nonce=\"secret\". Please retry safely`,
    String.raw`Authorization: Digest realm=\"Private. Request hidden\", nonce=\"secret\". Please retry safely`
  ])('keeps every boundary family inside backslash-escaped header quotes protected', (message) => {
    expect(redactSensitiveText(message)).toBe('Authorization: [redacted]. Please retry safely');
  });

  it.each([
    String.raw`Authorization: Digest realm=\"Private \\\"hidden; request hidden\\\" tail\", nonce=\"secret\". Please retry safely`,
    String.raw`Authorization: Digest realm=\"Private \\\"hidden, request hidden\\\" tail\", nonce=\"secret\". Please retry safely`,
    String.raw`Authorization: Digest realm=\"Private \\\"hidden | retry hidden\\\" tail\", nonce=\"secret\". Please retry safely`,
    String.raw`Authorization: Digest realm=\"Private \\\"hidden -> next hidden\\\" tail\", nonce=\"secret\". Please retry safely`,
    String.raw`Authorization: Digest realm=\"Private \\\"hidden, status: 200\\\" tail\", nonce=\"secret\". Please retry safely`,
    String.raw`Authorization: Digest realm=\"Private \\\"hidden (status 200)\\\" tail\", nonce=\"secret\". Please retry safely`,
    String.raw`Authorization: Digest realm=\"Private \\\"hidden. Request hidden\\\" tail\", nonce=\"secret\". Please retry safely`
  ])('keeps boundaries inside embedded serialized escaped quotes protected', (message) => {
    expect(redactSensitiveText(message)).toBe('Authorization: [redacted]. Please retry safely');
  });

  it('redacts both message and structured URL progress fields', () => {
    const event = redactAuditProgressEvent({
      phase: 'browser',
      current: 1,
      total: 2,
      message: 'Testing https://public.example/path?access_token=message-secret&next=/public',
      url: 'https://user:url-secret@public.example/path#id_token=field-secret'
    });

    expect(event).toMatchObject({
      phase: 'browser',
      current: 1,
      total: 2,
      message: 'Testing https://public.example/path?access_token=[redacted]&next=/public',
      url: 'https://[redacted]@public.example/path#id_token=[redacted]'
    });
    expect(JSON.stringify(event)).not.toMatch(/message-secret|url-secret|field-secret|user/);
  });

  it.each([
    ['Authorization: Bearer top-secret-token', 'top-secret-token'],
    ['Cookie: session=secret-cookie; theme=dark', 'secret-cookie'],
    ['Failed with {"access_token":"json-secret","password":"hunter2"}', 'json-secret'],
    ['Failed with TOKEN=environment-secret', 'environment-secret']
  ])('redacts sensitive diagnostic text from %s', (message, secret) => {
    const result = toActionableAuditError(new Error(message)).message;

    expect(result).toContain('[redacted]');
    expect(result).not.toContain(secret);
    expect(formatCliError(new Error(message), true)).not.toContain(secret);
  });

  it('redacts cookie and local-storage values from storage-state-shaped text', () => {
    const state = '{"cookies":[{"name":"session","value":"cookie-secret"}],"origins":[{"localStorage":[{"name":"auth","value":"storage-secret"}]}]}';
    const result = redactSensitiveText(`Invalid storage state: ${state}`);

    expect(result).not.toMatch(/cookie-secret|storage-secret/);
    expect(result.match(/\[redacted\]/g)).toHaveLength(2);
  });

  it('never exposes authentication material when local debug output is enabled', () => {
    const localPath = '/Users/carla/private/audit.ts';
    const error = new Error('Request failed: Authorization: Bearer debug-secret');
    error.stack = `Error: token=debug-secret\n    at audit (${localPath}:10:2)`;
    const formatted = formatCliError(error, true);

    expect(formatted).toContain(localPath);
    expect(formatted).not.toContain('debug-secret');
    expect(formatted).toContain('token=[redacted]');
  });

  it('still redacts a local path that appears after a complete HTTPS URL', () => {
    const publicUrl = 'https://example.test/a/b?next=/c';
    const localPath = '/Users/carla/private/audit.xlsx';
    const result = toActionableAuditError(new Error(`Request failed at ${publicUrl}; report: ${localPath}`));

    expect(result.message).toContain(publicUrl);
    expect(result.message).toContain('[local path]');
    expect(result.message).not.toContain(localPath);
  });
});

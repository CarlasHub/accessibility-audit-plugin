import { singleLineText } from './text.js';
import { JourneyDraftError } from './journey-drafts.js';
import { JourneyApprovalError } from './journey-approval.js';
import { JourneyValidationError } from './journey-validation.js';
import type { AuditProgressEvent } from './types.js';

export type AuditErrorCode =
  | 'invalid-input'
  | 'scope-restricted'
  | 'authentication-preflight-failed'
  | 'browser-unavailable'
  | 'browser-install-failed'
  | 'template-invalid'
  | 'output-unavailable'
  | 'report-validation-failed'
  | 'audit-failed';

export interface ActionableAuditError {
  code: AuditErrorCode;
  message: string;
  nextSteps: string[];
  retryable: boolean;
}

interface ErrorClassification {
  code: AuditErrorCode;
  nextSteps: string[];
  retryable: boolean;
}

type RecoveryBrowserEngine = 'chromium' | 'firefox' | 'webkit';

function recoveryBrowserEngine(message: string): RecoveryBrowserEngine | undefined {
  const normalized = message.toLowerCase();
  if (
    /\bno supported firefox browser\b/.test(normalized)
    || /\bplaywright firefox installation\b/.test(normalized)
    || /\bplaywright install firefox\b/.test(normalized)
  ) return 'firefox';
  if (
    /\bno supported webkit browser\b/.test(normalized)
    || /\bplaywright webkit installation\b/.test(normalized)
    || /\bplaywright install webkit\b/.test(normalized)
  ) return 'webkit';
  if (
    /\bno supported chromium browser\b/.test(normalized)
    || /\bplaywright chromium installation\b/.test(normalized)
    || /\bplaywright install chromium\b/.test(normalized)
    || /\bchromium-based browser\b/.test(normalized)
  ) return 'chromium';
  return undefined;
}

function recoveryBrowserLabel(engine: RecoveryBrowserEngine): string {
  if (engine === 'firefox') return 'Firefox';
  if (engine === 'webkit') return 'WebKit';
  return 'Chromium';
}

function browserInstallNextSteps(engine: RecoveryBrowserEngine): string[] {
  const label = recoveryBrowserLabel(engine);
  return [
    'Check network access and write permission for the plugin-owned browser directory.',
    `Run "npx playwright install ${engine}" in the plugin directory, or configure a supported browser executable.`,
    `Retry the same audit after ${label} is available.`
  ];
}

function browserUnavailableNextSteps(engine?: RecoveryBrowserEngine): string[] {
  if (!engine) {
    return [
      'Enable automatic browser installation or install the selected Playwright browser in the plugin directory.',
      'If an executable path was supplied, confirm it points to a compatible installed browser.',
      'Retry the audit.'
    ];
  }
  const label = recoveryBrowserLabel(engine);
  return [
    `Enable automatic browser installation or run "npx playwright install ${engine}" in the plugin directory.`,
    engine === 'chromium'
      ? 'If an executable path or browser channel was supplied, confirm it points to an installed Chromium-based browser.'
      : `If an executable path was supplied, confirm it points to an installed ${label} browser.`,
    'Retry the audit.'
  ];
}

const SENSITIVE_FIELD = String.raw`(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|client[_-]?secret|password|passwd|secret|authorization|proxy[_-]?authorization|cookie|set[_-]?cookie|session(?:[_-]?id)?)`;
const SENSITIVE_URL_PARAMETER = String.raw`(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|key|client[_-]?secret|password|passwd|secret|authorization|session(?:[_-]?id)?|code|signature|sig)`;
const SENSITIVE_URL_PARAMETER_PATTERN = new RegExp(`^${SENSITIVE_URL_PARAMETER}$`, 'i');

function isSensitiveUrlParameter(value: string): boolean {
  let decoded = value.replace(/\+/g, ' ');
  for (let pass = 0; pass < 4; pass += 1) {
    if (SENSITIVE_URL_PARAMETER_PATTERN.test(decoded)) return true;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return false;
      decoded = next;
    } catch {
      // A malformed encoded key cannot be classified safely, so hide its value.
      return decoded.includes('%');
    }
  }
  // If decoding is still changing the key after the bounded work limit, treat
  // it as sensitive instead of allowing arbitrary encoding depth to bypass us.
  return SENSITIVE_URL_PARAMETER_PATTERN.test(decoded) || decoded.includes('%');
}

function findInlineHeaderBoundary(value: string): number {
  let quote: '"' | "'" | undefined;
  let escapedQuoteDelimiter = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escapedQuoteDelimiter) {
        if (character === '\\') {
          let quoteIndex = index;
          while (value[quoteIndex] === '\\') quoteIndex += 1;
          if (value[quoteIndex] === quote) {
            // A serialized outer delimiter has one backslash. Longer runs
            // represent escaped quote content and must stay protected.
            if (quoteIndex - index === 1) {
              quote = undefined;
              escapedQuoteDelimiter = false;
            }
            index = quoteIndex;
          }
        }
      } else if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '\\' && (value[index + 1] === '"' || value[index + 1] === "'")) {
      quote = value[index + 1] as '"' | "'";
      escapedQuoteDelimiter = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    const remainder = value.slice(index);
    if (
      /^(?:;\s+|,\s+|\s+\|\s+|\s+->\s+)(?=(?:request|response|status|url|retry|failed|failure|error|at|see|then|public|next)\b)/i.test(remainder)
      || /^,\s+(?=["']?[a-z][\w-]*["']?\s*:)/i.test(remainder)
      || /^\s+(?=\((?:status|request|response|error)\b)/i.test(remainder)
      || /^\.\s+(?:[A-Z][A-Za-z]*|request|response|status|retry|failed|error)\b/.test(remainder)
    ) {
      return index;
    }
  }
  return -1;
}

function redactInlineHeaderValue(value: string): string {
  const boundary = findInlineHeaderBoundary(value);
  return boundary < 0 ? '[redacted]' : `[redacted]${value.slice(boundary)}`;
}

/**
 * Removes common authentication material from text crossing a user-visible
 * error or diagnostic boundary. This is defense in depth; callers must still
 * avoid putting secrets in URLs, configuration, filenames, and artifacts.
 */
export function redactSensitiveText(value: string): string {
  let redacted = value;

  // Keep the useful public URL while removing embedded user information and
  // sensitive OAuth/API query or fragment values.
  redacted = redacted.replace(/\b(https?:\/\/)([^/@\s]+)@/gi, '$1[redacted]@');
  redacted = redacted.replace(
    /([?&#])([^=&#\s"']+)=([^&#\s"']*)/g,
    (match, separator: string, parameter: string) => (
      isSensitiveUrlParameter(parameter) ? `${separator}${parameter}=[redacted]` : match
    )
  );

  // Environment-style quoted assignments often contain spaces and escaped
  // punctuation. Replace the whole quoted value before token-based fallbacks.
  redacted = redacted.replace(
    new RegExp(`(\\b${SENSITIVE_FIELD}\\b\\s*[=:]\\s*)"(?:\\\\.|[^"\\\\])*"`, 'gi'),
    '$1"[redacted]"'
  );
  redacted = redacted.replace(
    new RegExp(`(\\b${SENSITIVE_FIELD}\\b\\s*[=:]\\s*)'(?:\\\\.|[^'\\\\])*'`, 'gi'),
    "$1'[redacted]'"
  );

  // Keep adjacent request/status context while removing complete header values,
  // including multi-pair Cookie and Set-Cookie values.
  redacted = redacted.replace(
    /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key)(\s*:\s*)([^\r\n]+)/gi,
    (_match, header: string, separator: string, headerValue: string) => (
      `${header}${separator}${redactInlineHeaderValue(headerValue)}`
    )
  );

  // Cover JSON, JavaScript-like objects, environment-style assignments, and
  // standalone authentication schemes commonly surfaced by client libraries.
  redacted = redacted.replace(
    new RegExp(`("${SENSITIVE_FIELD}"\\s*:\\s*")([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'gi'),
    '$1[redacted]"'
  );
  redacted = redacted.replace(
    new RegExp(`('${SENSITIVE_FIELD}'\\s*:\\s*')([^'\\\\]*(?:\\\\.[^'\\\\]*)*)'`, 'gi'),
    "$1[redacted]'"
  );
  redacted = redacted.replace(
    new RegExp(`(\\b${SENSITIVE_FIELD}\\b\\s*[=:]\\s*)(?!\\[redacted\\]|["'])[^\\s,;}&]+`, 'gi'),
    '$1[redacted]'
  );
  redacted = redacted.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi, '$1 [redacted]');

  // Playwright storage state stores cookie and local-storage secrets under a
  // generic "value" field. Only apply this wider rule when state-shaped data
  // is present, avoiding needless redaction in unrelated validation messages.
  if (/['"](?:cookies|origins|localStorage)['"]\s*:/i.test(redacted)) {
    redacted = redacted.replace(
      /("value"\s*:\s*")([^"\\]*(?:\\.[^"\\]*)*)"/gi,
      '$1[redacted]"'
    );
    redacted = redacted.replace(
      /('value'\s*:\s*')([^'\\]*(?:\\.[^'\\]*)*)'/gi,
      "$1[redacted]'"
    );
  }

  return redacted;
}

/** Sanitizes both prose and structured URL fields before progress is emitted. */
export function redactAuditProgressEvent(event: AuditProgressEvent): AuditProgressEvent {
  return {
    ...event,
    message: redactSensitiveText(event.message),
    ...(event.url === undefined ? {} : { url: redactSensitiveText(event.url) })
  };
}

function rawErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return singleLineText(redactSensitiveText(raw), 1_000) || 'The accessibility audit failed unexpectedly.';
}

function debugErrorDetails(error: unknown): string {
  const raw = error instanceof Error ? error.stack ?? error.message : String(error);
  return singleLineText(redactSensitiveText(raw), 5_000) || 'No debug details were available.';
}

function redactAbsolutePaths(message: string): string {
  const webUrlRanges = [...message.matchAll(/https?:\/\/\S+/gi)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length
  }));
  const firstUnprotectedMatch = (pattern: RegExp, boundaryGroup?: number): number => {
    for (const match of message.matchAll(pattern)) {
      const index = match.index + (boundaryGroup === undefined ? 0 : (match[boundaryGroup] ?? '').length);
      if (!webUrlRanges.some((range) => index >= range.start && index < range.end)) return index;
    }
    return -1;
  };
  const starts = [
    firstUnprotectedMatch(/file:\/\//gi),
    firstUnprotectedMatch(/(^|[\s'"(=,:])\\\\(?=[^\\])/g, 1),
    firstUnprotectedMatch(/\b[A-Za-z]:[\\/]/g),
    firstUnprotectedMatch(/(^|[\s'"(=,:])\/(?!\/)/g, 1)
  ].filter((index) => index >= 0);
  if (starts.length === 0) return message;

  let start = Math.min(...starts);
  if (start > 0 && /['"]/.test(message[start - 1] ?? '')) start -= 1;
  const prefix = message.slice(0, start).trimEnd();
  return `${prefix}${prefix ? ' ' : ''}[local path]`;
}

function systemErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return typeof error.code === 'string' ? error.code.toUpperCase() : '';
}

function classify(message: string, systemCode: string): ErrorClassification {
  const normalized = message.toLowerCase();

  if (normalized.includes('authentication preflight failed')) {
    return {
      code: 'authentication-preflight-failed',
      nextSteps: [
        'Create a fresh Playwright storage-state file using a dedicated, least-privilege test account.',
        'Restrict the file to the audit operator and ensure every cookie and origin belongs to an approved audit host.',
        'Review the authenticated-page security guide, then retry the same confirmed scope.'
      ],
      retryable: true
    };
  }

  if (normalized.includes('journey drafts are non-runnable')) {
    return {
      code: 'invalid-input',
      nextSteps: [
        'Keep incomplete work in candidateJourneys inside the draft file.',
        'Approve the draft only after every candidate passes strict journey validation.',
        'Use the approved runnable journey JSON in audit configuration or the GitHub Action.'
      ],
      retryable: true
    };
  }

  if (normalized.includes('playwright') && normalized.includes('install') && normalized.includes('failed')) {
    const engine = recoveryBrowserEngine(message) ?? 'chromium';
    return {
      code: 'browser-install-failed',
      nextSteps: browserInstallNextSteps(engine),
      retryable: true
    };
  }

  if (
    /no supported (?:chromium|firefox|webkit) browser/.test(normalized)
    || normalized.includes('configured browser executable is unavailable')
    || /executable (?:doesn['’]t|does not) exist|browser executable|could not find.+(?:chrome|edge|chromium|firefox|webkit)|(?:browser|channel|chromium distribution|firefox|webkit).+not found|(?:please\s+)?run.+playwright install/i.test(message)
  ) {
    return {
      code: 'browser-unavailable',
      nextSteps: browserUnavailableNextSteps(recoveryBrowserEngine(message)),
      retryable: true
    };
  }

  if (
    normalized.includes('generated workbook validation failed')
    || normalized.includes('report validation failed')
  ) {
    return {
      code: 'report-validation-failed',
      nextSteps: [
        'Keep the generated output and validation details for diagnosis.',
        'Retry once to rule out an interrupted write.',
        'If the failure repeats, report the validation message with the plugin version.'
      ],
      retryable: true
    };
  }

  if (
    normalized.includes('template') && (
      normalized.includes('byte-identical')
      || normalized.includes('does not match')
      || normalized.includes('missing worksheet')
      || normalized.includes('invalid')
    )
  ) {
    return {
      code: 'template-invalid',
      nextSteps: [
        'Remove the custom template setting to use the bundled report template.',
        'If a custom path is required, provide a byte-identical copy of the bundled template.',
        'Retry the audit after correcting the template.'
      ],
      retryable: true
    };
  }

  if (
    normalized.includes('allowed host')
    || normalized.includes('allowed-host list')
    || normalized.includes('allowlist')
    || normalized.includes('staging-only')
    || normalized.includes('staging only')
    || normalized.includes('all urls were excluded')
    || normalized.includes('all resolved urls were excluded')
    || normalized.includes('all discovered urls were excluded by the host restrictions')
    || normalized.includes('exact-host list')
    || normalized.includes('does not look like a staging host')
  ) {
    return {
      code: 'scope-restricted',
      nextSteps: [
        'Review the exact target hosts, host allowlist, and staging-only setting.',
        'Authorize only the intended hosts, then confirm the updated pre-audit scope.',
        'Retry with the corrected scope.'
      ],
      retryable: true
    };
  }

  if (
    systemCode === 'ENOENT'
    || normalized.includes('at least one url')
    || normalized.includes('no urls')
    || normalized.includes('unsupported input')
    || normalized.includes('unsupported url')
    || normalized.includes('unsupported or invalid target url')
    || normalized.includes('invalid url')
    || normalized.includes('explicit url list')
    || normalized.includes('json url list')
    || normalized.includes('credentials in urls')
    || normalized.includes('embedded usernames or passwords')
    || normalized.includes('embedded credentials')
    || normalized.includes('no http(s) urls were found')
    || normalized.includes('navigation resolved to an invalid url')
    || normalized.includes('quick audit requires one valid http(s) url')
  ) {
    return {
      code: 'invalid-input',
      nextSteps: [
        'Provide at least one complete HTTP(S) URL, a pasted URL list, or a readable XLSX, CSV, TXT, JSON, or local URL-set XML sitemap page-list path.',
        'Remove credentials from URLs and confirm that every input file exists and is readable.',
        'Review the command help or pre-audit summary, then retry.'
      ],
      retryable: true
    };
  }

  if (
    ['EACCES', 'EPERM', 'ENOSPC', 'EROFS'].includes(systemCode)
    || normalized.includes('permission denied')
    || normalized.includes('no space left')
    || normalized.includes('read-only file system')
  ) {
    return {
      code: 'output-unavailable',
      nextSteps: [
        'Choose an output directory that exists, is writable, and has enough free space.',
        'Confirm the input files are readable and no report file is locked by another application.',
        'Retry the audit.'
      ],
      retryable: true
    };
  }

  return {
    code: 'audit-failed',
    nextSteps: [
      'Retry the audit once with the same confirmed scope.',
      'If it fails again, enable debug output and report the message with the plugin version.'
    ],
    retryable: true
  };
}

export function toActionableAuditError(error: unknown): ActionableAuditError {
  const rawMessage = rawErrorMessage(error);
  return {
    message: redactAbsolutePaths(rawMessage),
    ...classify(rawMessage, systemErrorCode(error))
  };
}

export function formatCliError(error: unknown, includeDebugDetails = false): string {
  if (error instanceof JourneyApprovalError) {
    const message = error.code === 'file-read'
      ? 'The journey draft could not be read.'
      : error.code === 'file-exists'
        ? 'The requested approved journey output already exists.'
        : error.code === 'file-write'
          ? 'The approved journey file could not be written.'
          : error.code === 'invalid-schema' && error.issues.length > 0
            ? `Found ${error.issues.length} journey schema ${error.issues.length === 1 ? 'issue' : 'issues'}:\n${error.issues.map((issue) => `  - ${singleLineText(redactSensitiveText(issue), 500)}`).join('\n')}`
            : redactAbsolutePaths(rawErrorMessage(error));
    const nextStep = error.code === 'file-read'
      ? 'Correct the draft path or its read permissions, then run "accessibility-audit journeys approve <draft-path> [--output <path>]" again.'
      : error.code === 'invalid-json'
        ? 'Correct the draft JSON syntax, then run "accessibility-audit journeys approve <draft-path> [--output <path>]" again.'
        : error.code === 'invalid-draft'
          ? 'Use a draft created by "accessibility-audit journeys draft", then run the approval command again.'
          : error.code === 'invalid-schema'
            ? 'Correct every reported candidateJourneys field, then run "accessibility-audit journeys approve <draft-path> [--output <path>]" again.'
            : error.code === 'file-exists'
              ? 'Choose a different --output path, then run the approval command again.'
              : 'Create a writable parent directory or choose a writable --output path, then run the approval command again.';
    const debugDetails = includeDebugDetails
      ? `\n\nDebug details:\n${debugErrorDetails(error)}`
      : '\n\nSet ACCESSIBILITY_AUDIT_DEBUG=1 to include a stack trace.';
    return `Journey draft could not be approved (${error.code}).\n${message}\n\nTry this next:\n  1. ${nextStep}${debugDetails}`;
  }
  if (error instanceof JourneyDraftError) {
    const message = error.code === 'file-read'
      ? 'The journey draft source could not be read.'
      : error.code === 'file-exists'
        ? 'The requested journey draft output already exists.'
        : error.code === 'file-write'
          ? 'The journey draft could not be written.'
          : redactAbsolutePaths(rawErrorMessage(error));
    const nextStep = error.code === 'file-read'
      ? 'Correct the source path or its read permissions, then run "accessibility-audit journeys draft [path] [--output <path>]" again.'
      : error.code === 'invalid-json'
        ? 'Correct the source JSON syntax, then run "accessibility-audit journeys draft [path] [--output <path>]" again.'
        : error.code === 'invalid-schema'
          ? 'Use a journey object, a journey array, or an object containing a journeys array, then run "accessibility-audit journeys draft [path] [--output <path>]" again.'
          : error.code === 'file-exists'
            ? 'Choose a different --output path, then run "accessibility-audit journeys draft [path] [--output <path>]" again.'
            : 'Create a writable parent directory or choose a writable --output path, then run "accessibility-audit journeys draft [path] [--output <path>]" again.';
    const debugDetails = includeDebugDetails
      ? `\n\nDebug details:\n${debugErrorDetails(error)}`
      : '\n\nSet ACCESSIBILITY_AUDIT_DEBUG=1 to include a stack trace.';
    return `Journey draft could not be saved (${error.code}).\n${message}\n\nTry this next:\n  1. ${nextStep}${debugDetails}`;
  }
  if (error instanceof JourneyValidationError) {
    const message = error.issues.length > 0
      ? `Found ${error.issues.length} journey schema ${error.issues.length === 1 ? 'issue' : 'issues'}:\n${error.issues.map((issue) => `  - ${singleLineText(redactSensitiveText(issue), 500)}`).join('\n')}`
      : redactAbsolutePaths(rawErrorMessage(error));
    const nextStep = error.code === 'file-read'
      ? 'Check the file path and permissions, then run "accessibility-audit journeys validate <path>" again.'
      : error.code === 'invalid-json'
        ? 'Correct the JSON syntax, then run "accessibility-audit journeys validate <path>" again.'
        : 'Correct the reported journey fields, then run "accessibility-audit journeys validate <path>" again.';
    const debugDetails = includeDebugDetails
      ? `\n\nDebug details:\n${debugErrorDetails(error)}`
      : '\n\nSet ACCESSIBILITY_AUDIT_DEBUG=1 to include a stack trace.';
    return `Journey validation failed (${error.code}).\n${message}\n\nTry this next:\n  1. ${nextStep}${debugDetails}`;
  }
  if (error instanceof Error && error.name === 'JourneyBuilderInputError') {
    const message = redactAbsolutePaths(rawErrorMessage(error));
    const debugDetails = includeDebugDetails
      ? `\n\nDebug details:\n${debugErrorDetails(error)}`
      : '\n\nSet ACCESSIBILITY_AUDIT_DEBUG=1 to include a stack trace.';
    return `Journey could not be created (invalid-input).\n${message}\n\nTry this next:\n  1. Correct the named journey field and run "accessibility-audit journeys build" again.${debugDetails}`;
  }
  const actionable = toActionableAuditError(error);
  const nextSteps = actionable.nextSteps
    .map((step, index) => `  ${index + 1}. ${step}`)
    .join('\n');
  const debugDetails = includeDebugDetails
    ? `\n\nDebug details:\n${debugErrorDetails(error)}`
    : '\n\nSet ACCESSIBILITY_AUDIT_DEBUG=1 to include a stack trace.';
  return `Accessibility audit failed (${actionable.code}).\n${actionable.message}\n\nTry this next:\n${nextSteps}${debugDetails}`;
}

export function cliDebugEnabled(value = process.env.ACCESSIBILITY_AUDIT_DEBUG): boolean {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

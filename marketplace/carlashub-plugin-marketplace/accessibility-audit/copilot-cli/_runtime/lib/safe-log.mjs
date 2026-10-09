const SENSITIVE_FIELD = String.raw`(?:access(?:_|-)?token|api(?:_|-)?key|authorization|client(?:_|-)?secret|cookie|id(?:_|-)?token|password|passwd|private(?:_|-)?key|proxy(?:_|-)?authorization|refresh(?:_|-)?token|secret|session(?:_|-)?id|session|set(?:_|-)?cookie|token|x(?:_|-)?api(?:_|-)?key)`;
const SENSITIVE_KEYS = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'clientsecret',
  'cookie',
  'idtoken',
  'key',
  'password',
  'passwd',
  'privatekey',
  'proxyauthorization',
  'refreshtoken',
  'secret',
  'session',
  'sessionid',
  'setcookie',
  'sig',
  'signature',
  'token',
  'xapikey'
]);

function decodeKey(value) {
  let decoded = value;
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return next;
      decoded = next;
    } catch {
      return 'token';
    }
  }
  return decoded.includes('%') ? 'token' : decoded;
}

function isSensitiveKey(value) {
  const canonical = decodeKey(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEYS.has(canonical);
}

function findInlineHeaderBoundary(value) {
  let quote;
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
      quote = value[index + 1];
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
    ) return index;
  }
  return -1;
}

function redactInlineHeaderValue(value) {
  const boundary = findInlineHeaderBoundary(value);
  return boundary < 0 ? '[redacted]' : `[redacted]${value.slice(boundary)}`;
}

export function redactLogMessage(value) {
  let safe = String(value).replace(/[\r\n]+/g, ' ');
  safe = safe.replace(/\b(https?:\/\/)([^/@\s]+)@/gi, '$1[redacted]@');
  safe = safe.replace(/([?#&])([^\s=&#]+)=([^\s&#]*)/g, (match, separator, key) => (
    isSensitiveKey(key) ? `${separator}${key}=[redacted]` : match
  ));
  safe = safe.replace(new RegExp(`(\\b${SENSITIVE_FIELD}\\b\\s*[=:]\\s*)"(?:\\\\.|[^"\\\\])*"`, 'gi'), '$1"[redacted]"');
  safe = safe.replace(new RegExp(`(\\b${SENSITIVE_FIELD}\\b\\s*[=:]\\s*)'(?:\\\\.|[^'\\\\])*'`, 'gi'), "$1'[redacted]'");
  safe = safe.replace(
    /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key)(\s*:\s*)([^\r\n]+)/gi,
    (_match, header, separator, headerValue) => `${header}${separator}${redactInlineHeaderValue(headerValue)}`
  );
  safe = safe.replace(new RegExp(`("${SENSITIVE_FIELD}"\\s*:\\s*")([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'gi'), '$1[redacted]"');
  safe = safe.replace(new RegExp(`('${SENSITIVE_FIELD}'\\s*:\\s*')([^'\\\\]*(?:\\\\.[^'\\\\]*)*)'`, 'gi'), "$1[redacted]'");
  safe = safe.replace(new RegExp(`(\\b${SENSITIVE_FIELD}\\b\\s*[=:]\\s*)(?!\\[redacted\\]|["'])[^\\s,;}&]+`, 'gi'), '$1[redacted]');
  safe = safe.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi, '$1 [redacted]');
  safe = safe.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g, '[redacted]');
  return safe;
}

export function createSafeLogger(write = (message) => process.stderr.write(message)) {
  return (message) => write(`[accessibility-audit] ${redactLogMessage(message)}\n`);
}

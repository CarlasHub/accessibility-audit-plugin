import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

const SAFE_LITERAL = /^(?:\[?redacted\]?|<redacted>|example|placeholder|changeme|replace[-_ ]?me|your[-_ ].*|\$\{\{?[^}]+\}\}?|\$[A-Z_][A-Z0-9_]*|%[A-Z_][A-Z0-9_]*%)$/i;
const SENSITIVE_KEYS = new Set([
  'accesskey',
  'accesstoken',
  'apikey',
  'authorization',
  'clientsecret',
  'cookie',
  'idtoken',
  'password',
  'passwd',
  'privatekey',
  'proxyauthorization',
  'refreshtoken',
  'secret',
  'session',
  'sessionid',
  'setcookie',
  'token',
  'xapikey'
]);

const TEXT_RULES = [
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g
  },
  {
    id: 'url-userinfo',
    pattern: /https?:\/\/(?!\[redacted\]@)[^\s/@'"]+@/gi
  },
  {
    id: 'authorization-value',
    pattern: /\b(?:proxy-)?authorization\s*:\s*(?:basic|bearer|digest)\s+(?!\[redacted\])[^\s,'"}\]]{4,}/gi
  },
  {
    id: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g
  },
  {
    id: 'openai-token',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g
  },
  {
    id: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g
  },
  {
    id: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g
  }
];

function isSafeLiteral(value) {
  const normalized = String(value).trim().replace(/^['"]|['"]$/g, '');
  return normalized === '' || SAFE_LITERAL.test(normalized);
}

function decodedKey(value) {
  let decoded = value;
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return next;
      decoded = next;
    } catch {
      return /(?:token|secret|password|key|auth|cookie|session)/i.test(decoded) ? 'token' : decoded;
    }
  }
  return decoded.includes('%') ? 'token' : decoded;
}

function isSensitiveKey(value) {
  const canonical = decodedKey(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEYS.has(canonical);
}

function scalarValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    let escaped = false;
    for (let index = 1; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        return trimmed.slice(0, index + 1);
      }
    }
    return trimmed;
  }

  return trimmed.replace(/\s+#.*$/, '').replace(/,\s*$/, '').trim();
}

function isNonStringScalar(value) {
  return /^(?:true|false|null|~|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)$/i.test(value);
}

function isSafeWorkflowPermission(filePath, key, value) {
  const normalizedPath = filePath.replaceAll('\\', '/');
  const normalizedValue = String(value).trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  return /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(normalizedPath)
    && key.toLowerCase().replace(/[^a-z0-9]/g, '') === 'idtoken'
    && /^(?:write|none)$/.test(normalizedValue);
}

function lineNumberAt(contents, index) {
  return contents.slice(0, index).split('\n').length;
}

function addFinding(findings, seen, path, line, rule) {
  const key = `${path}:${line}:${rule}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ path, line, rule });
}

function jsonKeyLine(contents, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`["']${escaped}["']\\s*:`).exec(contents);
  return lineNumberAt(contents, match?.index ?? 0);
}

function inspectJsonValue(value, path, findings, seen, filePath, contents) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (isSensitiveKey(key) && typeof child === 'string' && !isSafeLiteral(child)) {
      addFinding(findings, seen, filePath, jsonKeyLine(contents, key), `literal-sensitive-field:${childPath}`);
    }
    inspectJsonValue(child, childPath, findings, seen, filePath, contents);
  }
}

export function findCredentialFindings(filePath, contents) {
  const findings = [];
  const seen = new Set();
  let parsedJson;
  let jsonParsed = false;

  if (filePath.endsWith('.json')) {
    try {
      parsedJson = JSON.parse(contents);
      jsonParsed = true;
    } catch {
      // Syntax validation belongs to each manifest validator; text rules and
      // the fail-closed scalar scanner still inspect malformed JSON.
    }
  }

  for (const rule of TEXT_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of contents.matchAll(rule.pattern)) {
      addFinding(findings, seen, filePath, lineNumberAt(contents, match.index ?? 0), rule.id);
    }
  }

  const urlParameter = /[?#&]([^\s=&#]+)=([^\s&#"']*)/g;
  for (const match of contents.matchAll(urlParameter)) {
    const [, key = '', value = ''] = match;
    if (isSensitiveKey(key) && !isSafeLiteral(value)) {
      addFinding(findings, seen, filePath, lineNumberAt(contents, match.index ?? 0), 'sensitive-url-parameter');
    }
  }

  if (!jsonParsed) {
    const scalarAssignment = /^[ \t]*["']?([A-Za-z][A-Za-z0-9_.-]*)["']?[ \t]*[:=][ \t]*(.*?)[ \t]*$/gm;
    for (const match of contents.matchAll(scalarAssignment)) {
      const [, key = '', rawValue = ''] = match;
      const value = scalarValue(rawValue);
      if (
        isSensitiveKey(key)
        && value !== ''
        && !isNonStringScalar(value)
        && !isSafeLiteral(value)
        && !isSafeWorkflowPermission(filePath, key, value)
        && !/^[{[]/.test(value)
      ) {
        addFinding(findings, seen, filePath, lineNumberAt(contents, match.index ?? 0), `literal-sensitive-field:${key}`);
      }
    }
  }

  if (jsonParsed) inspectJsonValue(parsedJson, '', findings, seen, filePath, contents);

  return findings.sort((left, right) => left.line - right.line || left.rule.localeCompare(right.rule));
}

async function walk(directory, visitor) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path, visitor);
    } else {
      visitor(path);
    }
  }
}

export async function repositoryManifestPaths(root) {
  const candidates = [
    'package.json',
    'plugin.json',
    '.mcp.json',
    'action.yml',
    '.codex-plugin/plugin.json',
    '.cursor-plugin/plugin.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json'
  ].map((path) => join(root, path));

  for (const directory of [join(root, '.github', 'workflows'), join(root, 'marketplace', 'carlashub-plugin-marketplace')]) {
    try {
      await walk(directory, (path) => {
        const name = basename(path);
        if (
          /\.ya?ml$/i.test(name)
          || ['.mcp.json', 'plugin.json', 'marketplace.json', 'install-manifest.json', 'hooks.json'].includes(name)
          || path.includes(`${join('catalog-fragments', '')}`) && name.endsWith('.json')
        ) candidates.push(path);
      });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }

  return [...new Set(candidates)].sort();
}

export async function scanCredentialFiles(root, paths) {
  const selectedPaths = paths ?? await repositoryManifestPaths(root);
  const findings = [];
  for (const path of selectedPaths) {
    try {
      findings.push(...findCredentialFindings(relative(root, path) || basename(path), await readFile(path, 'utf8')));
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  return findings;
}

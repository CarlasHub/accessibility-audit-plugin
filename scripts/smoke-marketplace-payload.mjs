import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(import.meta.dirname, '..');
const execFileAsync = promisify(execFile);
const sourceRoot = join(root, 'marketplace', 'carlashub-plugin-marketplace', 'accessibility-audit');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'accessibility-audit-marketplace-smoke-'));
const pluginData = join(temporaryRoot, 'plugin data with spaces');
const targetProject = join(temporaryRoot, 'read only target');
const sentinelPath = join(targetProject, 'sentinel.txt');
const sentinel = 'The marketplace plugin must not modify this project.\n';
const harnesses = ['claude', 'copilot-cli', 'copilot-vscode'];
let stderr = '';
let discoveredToolCount = 0;

try {
  await mkdir(targetProject, { recursive: true });
  await writeFile(sentinelPath, sentinel, 'utf8');
  for (const harness of harnesses) {
    const pluginRoot = join(temporaryRoot, `${harness} plugin with spaces`);
    await cp(join(sourceRoot, harness), pluginRoot, { recursive: true });
    const environment = Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'));
    delete environment.CLAUDE_PLUGIN_ROOT;
    delete environment.CLAUDE_PLUGIN_DATA;
    delete environment.COPILOT_PLUGIN_ROOT;
    delete environment.COPILOT_PLUGIN_DATA;
    delete environment.PLUGIN_ROOT;
    delete environment.PLUGIN_DATA;
    if (harness === 'claude') {
      environment.CLAUDE_PLUGIN_ROOT = pluginRoot;
      environment.CLAUDE_PLUGIN_DATA = pluginData;
    } else {
      environment.COPILOT_PLUGIN_ROOT = pluginRoot;
      environment.COPILOT_PLUGIN_DATA = pluginData;
    }
    environment.npm_config_offline = 'true';
    const mcp = JSON.parse(await readFile(join(pluginRoot, '.mcp.json'), 'utf8'));
    const server = mcp.mcpServers?.['accessibility-audit'];
    if (!server?.command || !Array.isArray(server.args)) throw new Error(`${harness} has no usable MCP configuration.`);
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: environment,
      cwd: targetProject,
      stderr: 'pipe'
    });
    transport.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    const client = new Client({ name: `${harness}-marketplace-smoke-test`, version: '1.0.0' }, { capabilities: {} });
    try {
      await client.connect(transport, { timeout: 10 * 60_000 });
      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);
      for (const required of ['run_accessibility_audit', 'get_audit_instructions', 'validate_accessibility_report']) {
        if (!toolNames.includes(required)) throw new Error(`${harness} packaged MCP server is missing ${required}.`);
      }
      const auditTool = tools.tools.find((tool) => tool.name === 'run_accessibility_audit');
      const historySchema = auditTool?.inputSchema?.properties?.historyPaths;
      if (historySchema?.type !== 'array' || historySchema.maxItems !== 50) {
        throw new Error(`${harness} packaged MCP schema omitted the bounded historyPaths contract.`);
      }
      const result = await client.callTool({
        name: 'get_audit_instructions',
        arguments: { targets: 'https://preview.example.test/', auditor: 'Automated' }
      });
      const text = Array.isArray(result.content)
        ? result.content.find((item) => item.type === 'text')?.text
        : undefined;
      if (!text?.includes('WCAG 2.2')) throw new Error(`${harness} did not return the embedded audit instructions.`);
      discoveredToolCount = toolNames.length;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  if (await readFile(sentinelPath, 'utf8') !== sentinel) {
    throw new Error('The packaged plugin modified the target project during startup.');
  }
  const installManifest = JSON.parse(await readFile(join(sourceRoot, 'copilot-cli', 'install-manifest.json'), 'utf8'));
  const installedPackageRoot = join(
    pluginData,
    'runtime',
    installManifest.version,
    'node_modules',
    installManifest.packageName
  );
  const installedPackage = JSON.parse(await readFile(join(installedPackageRoot, 'package.json'), 'utf8'));
  if (installedPackage.version !== installManifest.version) {
    throw new Error('The installed runtime version does not match the payload manifest.');
  }
  await readFile(join(installedPackageRoot, 'dist', 'history.js'), 'utf8');
  const { stdout: cliHelp } = await execFileAsync(process.execPath, [
    join(installedPackageRoot, 'dist', 'cli.js'),
    'audit',
    '--help'
  ]);
  if (!cliHelp.includes('--history <path>')) {
    throw new Error('The installed runtime CLI omitted the repeatable --history option.');
  }
  const [runnerSource, htmlSource, excelSource, scopeSource] = await Promise.all([
    readFile(join(installedPackageRoot, 'dist', 'audit', 'runner.js'), 'utf8'),
    readFile(join(installedPackageRoot, 'dist', 'reporting', 'html.js'), 'utf8'),
    readFile(join(installedPackageRoot, 'dist', 'reporting', 'excel.js'), 'utf8'),
    readFile(join(installedPackageRoot, 'dist', 'scope.js'), 'utf8')
  ]);
  if (!runnerSource.includes('scopeMode: AUDIT_SCOPE_MODE') || !scopeSource.includes("'supplied-pages-only'")) {
    throw new Error('The installed runtime omitted the supplied-pages-only JSON contract.');
  }
  if (!htmlSource.includes('links are never added as audit targets')) {
    throw new Error('The installed runtime omitted the HTML no-crawl disclosure.');
  }
  if (!excelSource.includes('Scope mode: ${AUDIT_SCOPE_LABEL}')) {
    throw new Error('The installed runtime omitted the Excel supplied-pages-only scope mode.');
  }
  const { collectUrls } = await import(pathToFileURL(join(installedPackageRoot, 'dist', 'urls.js')).href);
  const sitemapPath = join(temporaryRoot, 'packaged-sitemap.xml');
  await writeFile(sitemapPath, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="urn:image">
    <!-- Literal documentation mentioning <!DOCTYPE is safe. -->
    <url><loc>https://example.test/page</loc><image:image><image:loc>https://cdn.example.test/image.jpg</image:loc></image:image></url>
  </urlset>`);
  const sitemapResult = await collectUrls([sitemapPath]);
  if (JSON.stringify(sitemapResult.urls) !== JSON.stringify(['https://example.test/page'])) {
    throw new Error('The installed runtime did not apply safe URL-set sitemap semantics.');
  }
  const unsafeSitemapPath = join(temporaryRoot, 'packaged-unsafe-sitemap.xml');
  await writeFile(
    unsafeSitemapPath,
    '<!DOCTYPE urlset [<!ENTITY secret SYSTEM "file:///etc/passwd">]><urlset><url><loc>&secret;</loc></url></urlset>'
  );
  let rejectedUnsafeSitemap = false;
  try {
    await collectUrls([unsafeSitemapPath]);
  } catch (error) {
    rejectedUnsafeSitemap = error instanceof Error && error.message.includes('DOCTYPE declarations are not allowed');
  }
  if (!rejectedUnsafeSitemap) {
    throw new Error('The installed runtime did not reject an XML sitemap DOCTYPE declaration.');
  }
  const oversizedSitemapPath = join(temporaryRoot, 'packaged-oversized-sitemap.xml');
  await writeFile(
    oversizedSitemapPath,
    `<urlset><url>${'<loc>https://example.test/page</loc>'.repeat(50_001)}</url></urlset>`
  );
  let rejectedOversizedSitemap = false;
  try {
    await collectUrls([oversizedSitemapPath]);
  } catch (error) {
    rejectedOversizedSitemap = error instanceof Error && error.message.includes('50,000 URL sitemap limit');
  }
  if (!rejectedOversizedSitemap) {
    throw new Error('The installed runtime did not enforce the URL-set sitemap location limit.');
  }
  process.stdout.write(`Marketplace smoke test passed for ${harnesses.join(', ')}. ${discoveredToolCount} MCP tools loaded from the isolated packaged runtime.\n`);
} catch (error) {
  if (stderr) process.stderr.write(stderr);
  throw error;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

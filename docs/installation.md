# Installation

This guide installs the Accessibility Audit plugin without adding dependencies or configuration to the project being audited. Keep the plugin in its own permanent directory and open the unrelated project separately in Cursor, Claude Code, Codex, GitHub Copilot CLI, or GitHub Copilot in VS Code.

## Choose the supported installation path

| Client | Supported developer installation | Where the audit runs |
|---|---|---|
| Cursor | Built checkout under Cursor's local plugin directory, normally by symlink | Any project opened in Cursor |
| Claude Code | Built checkout passed with `--plugin-dir`, or a built local marketplace | Any directory from which Claude Code is started |
| Claude Desktop Chat | Generated custom-plugin ZIP uploaded through Customize | A local Chat conversation on the computer running the plugin MCP server |
| Codex | Built checkout registered as a local marketplace in Codex CLI | Any directory from which Codex CLI is started |
| GitHub Copilot CLI | Generated `copilot-cli` payload installed directly or from a compatible marketplace | Any directory from which Copilot CLI is started |
| GitHub Copilot in VS Code | Generated `copilot-vscode` payload distributed through a compatible marketplace | Any project opened in VS Code |

The Codex IDE extension does not currently load plugins. Use Codex CLI or another Codex/ChatGPT surface that supports plugins.

The repository also contains marketplace metadata for private distribution. A marketplace administrator must package and validate a release before offering it remotely. Cloning the source and completing the build below is the supported developer route; do not assume that an unbuilt source snapshot contains `dist/mcp.js`.

## 1. Install the shared prerequisites

You need:

- Git;
- Node.js 22 or later;
- npm;
- Cursor, Claude Code, Claude Desktop, Codex CLI, or a supported GitHub Copilot client, depending on the client being tested;
- Microsoft Excel or another OOXML-compatible application to open the generated report.

Verify the basic tools:

```sh
git --version
node --version
npm --version
```

If your organisation uses a private mirror, authenticate Git before cloning through its approved credential flow.

## 2. Prepare one isolated plugin checkout

Run these commands in a tools directory, not inside the application repository that will be audited:

```sh
git clone https://github.com/CarlasHub/accessibility-audit-plugin.git accessibility-audit
cd accessibility-audit
npm ci
npm run build
```

The audit automatically installs headless Playwright Chromium on first use when neither bundled Chromium nor a supported system Chrome/Edge installation is available. To prepare it before the first audit, run `npx playwright install chromium` in this plugin checkout. Use `--no-auto-install-browser` only when automatic downloads are prohibited and an approved browser is already configured.

Keep this checkout after installation. The clients use it as the plugin source, and future updates are rebuilt here.

Verify the build before configuring an editor:

```sh
node dist/cli.js --version
node dist/cli.js --help
test -f dist/mcp.js
```

On Windows PowerShell, replace the final file check with:

```powershell
Test-Path .\dist\mcp.js
```

The version and help commands must exit successfully, and the file check must return success or `True`.

## 3A. Install in Cursor

### macOS or Linux

From the built plugin checkout:

```sh
PLUGIN_PATH="$(pwd -P)"
mkdir -p ~/.cursor/plugins/local
ln -s "$PLUGIN_PATH" ~/.cursor/plugins/local/accessibility-audit
```

If that destination already exists, inspect it first. Remove or replace it only when you know it is an obsolete copy of this plugin.

### Windows PowerShell

Clone and build directly in Cursor's local plugin directory, or create a directory junction from that directory to the permanent checkout. A direct checkout avoids requiring symbolic-link privileges:

```powershell
$PluginPath = Join-Path $env:USERPROFILE ".cursor\plugins\local\accessibility-audit"
git clone https://github.com/CarlasHub/accessibility-audit-plugin.git $PluginPath
Set-Location $PluginPath
npm ci
npx playwright install chromium
npm run build
```

### Activate and verify Cursor

1. Run **Developer: Reload Window**, or restart Cursor.
2. Open **Customize**.
3. Find `accessibility-audit` at user or local scope.
4. Confirm that its command, skill, rule, and `accessibility-audit` MCP server are enabled.
5. Open any project and run:

```text
/accessibility-audit https://preview.example.test/
```

If a managed Cursor installation does not show the local plugin, ask an administrator whether **Allow Local Plugin Imports** is enabled. Team or Enterprise marketplace installation is managed in the Cursor Dashboard and does not require each developer to create a local symlink.

## 3B. Install in Claude Code

### Use the plugin for one Claude Code session

Start Claude Code from the unrelated project you want to work in, while passing the separate built plugin directory:

```sh
cd /path/to/project-being-audited
claude --plugin-dir /path/to/accessibility-audit
```

This does not copy plugin files into the project. The plugin remains active for that Claude Code session. In Claude Code, run:

```text
/accessibility-audit https://preview.example.test/
```

### Install from the built checkout as a local marketplace

For a persistent local installation, add the built checkout and install its marketplace entry from within Claude Code:

```text
/plugin marketplace add /path/to/accessibility-audit
/plugin install accessibility-audit@accessibility-audit-marketplace
/reload-plugins
```

Open `/plugin`, check the **Installed** and **Errors** tabs, and confirm that the plugin and its MCP server loaded without errors.

Private Git marketplace installation uses the same marketplace name, but it is a release/distribution workflow. The user must have Git credentials that can read the private repository, and the published plugin snapshot must contain its runnable build. See the [Claude Code marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces).

## 3C. Install in Claude Desktop Chat

Create the uploadable custom-plugin ZIP from the isolated plugin checkout:

```sh
npm ci
npm run package:claude-desktop
```

The packaging command rebuilds the marketplace payload, checks the Claude manifest and required runtime files, creates a ZIP without an extra wrapper directory, validates its ZIP central directory, and writes:

```text
artifacts/accessibility-audit-claude-desktop-<version>.zip
artifacts/accessibility-audit-claude-desktop-<version>.zip.sha256
```

Install it in Claude Desktop:

1. Open **Customize** from the left sidebar.
2. Open **Plugins**.
3. Use the custom-plugin upload option and select the generated ZIP. Do not unzip it.
4. Review the trust warning. The plugin runs a local MCP server and headless browser on this computer.
5. Confirm that **Accessibility Audit** appears under personal plugins and is enabled.
6. Start a new conversation in the **Chat** tab.
7. Type `/`, select **Run Accessibility Audit**, add the URL or page-list path, and send the message.

The plugin asks for the exact scope, auditor, and landing-page QA URL before starting. The editable auditor default is `Automated`. It writes results under `Accessibility Audit Results` in the user's home directory unless another output directory is confirmed.

The plugin must be used from Claude Desktop on the computer where it is installed because its MCP server is local. It is not available from `claude.ai` on another computer. Hooks do not run in Chat, but the MCP launcher independently verifies and installs the bundled runtime before starting. An organisation administrator can disable custom plugins or local MCP servers.

To verify installation, open a new Chat conversation, type `/`, and confirm that **Run Accessibility Audit** appears. If the skill appears but execution fails, inspect the plugin or connector error in **Customize → Plugins** and confirm that `node --version` reports 22 or later.

## 3D. Install in Codex

Use Codex CLI, not the Codex IDE extension. From a terminal, register the built checkout as a local marketplace and install the plugin:

```sh
codex plugin marketplace add /path/to/accessibility-audit
codex plugin add accessibility-audit@accessibility-audit-marketplace
codex plugin list
```

Then start a new Codex CLI session in the unrelated project:

```sh
cd /path/to/project-being-audited
codex
```

Enter `/plugins` and confirm that `accessibility-audit` is installed. Start a new thread after installing or updating so Codex loads the current skill and MCP tools. Run an audit with a direct request such as:

```text
Use the Accessibility Audit plugin to audit https://preview.example.test/.
```

Codex supports local paths and configured Git marketplaces, but the local built-checkout route above is the supported developer installation for this repository. See the [official OpenAI plugin documentation](https://developers.openai.com/codex/plugins) and [plugin packaging documentation](https://developers.openai.com/plugins/build/plugins).

## 3E. Install in GitHub Copilot CLI

Build and validate the generated marketplace payload from the isolated source checkout:

```sh
npm run build:marketplace
npm run validate:marketplace
npm run test:marketplace
copilot plugin install ./marketplace/carlashub-plugin-marketplace/accessibility-audit/copilot-cli
copilot plugin list
```

Start Copilot CLI in an unrelated project. In an interactive session, run `/skills list` and confirm that `run-accessibility-audit` is present. Then request:

```text
Use the Accessibility Audit plugin to audit https://preview.example.test/.
```

After the CarlasHub marketplace is published, users can register it and install the entry instead of using a local path:

```sh
copilot plugin marketplace add CarlasHub/accessibility-audit-plugin
copilot plugin install accessibility-audit@carlashub-plugins
```

The first activation installs the bundled production runtime into `COPILOT_PLUGIN_DATA`; it does not add packages or files to the open project.

## 3F. Install in GitHub Copilot in VS Code

The generated `copilot-vscode` payload follows the marketplace’s VS Code harness convention. Publish it through a compatible marketplace, then use the organisation-approved plugin installation flow in VS Code. After installation:

1. Reload VS Code if the marketplace UI requests it.
2. Confirm that `accessibility-audit-vscode` is enabled.
3. Confirm that the `accessibility-audit` MCP server and `run-accessibility-audit` skill are available.
4. Open any project and request an audit of explicit URLs or a page-list file.

Local source installation is not presented as equivalent proof of the marketplace harness. Use `npm run test:marketplace` to verify the packaged MCP runtime and follow [Marketplace submission](marketplace-submission.md) for the eventual repository submission.

## 4. Run against a different project

No plugin files need to be copied into the target project. Open or start the client in that project, then supply the page scope explicitly:

- one page: `/accessibility-audit https://preview.example.test/`;
- selected pages: `/accessibility-audit https://preview.example.test/ https://preview.example.test/jobs`;
- every URL in a prepared list: `/accessibility-audit /absolute/path/to/pages.xlsx`.

The plugin tests only the URLs supplied. It does not crawl a complete site from its home page. The confirmation step lets the user change the auditor name from the default `Automated` and verify the landing-page QA URL before the browser starts.

## 5. Update an installation

In the permanent plugin checkout:

```sh
git pull --ff-only
npm ci
npm run build
npm run check
npm run build:marketplace
npm run validate:marketplace
npm run test:marketplace
```

Then refresh the relevant client:

- Cursor: run **Developer: Reload Window**.
- Claude Code with `--plugin-dir`: restart the session. For a local marketplace, run `/plugin marketplace update accessibility-audit-marketplace`, reinstall or update the plugin if offered, then run `/reload-plugins`.
- Codex: remove and reinstall the cached plugin, then start a new session:

```sh
codex plugin remove accessibility-audit@accessibility-audit-marketplace
codex plugin add accessibility-audit@accessibility-audit-marketplace
```

- Copilot CLI local payload: rebuild it, then reinstall the local plugin because Copilot caches installed plugins:

```sh
copilot plugin uninstall accessibility-audit
copilot plugin install ./marketplace/carlashub-plugin-marketplace/accessibility-audit/copilot-cli
```

- Copilot marketplace: run `copilot plugin marketplace update carlashub-plugins`, then `copilot plugin update accessibility-audit`.

## 6. Uninstall

### Cursor

Remove only the `~/.cursor/plugins/local/accessibility-audit` local-plugin entry, then reload Cursor. Do not delete the target application repository.

### Claude Code

```text
/plugin uninstall accessibility-audit@accessibility-audit-marketplace
/plugin marketplace remove accessibility-audit-marketplace
```

### Claude Desktop Chat

Open **Customize → Plugins**, locate **Accessibility Audit** under personal plugins, and use its menu to uninstall it. To update it, generate a new ZIP with `npm run package:claude-desktop`, remove the installed copy, upload the new ZIP, and start a new Chat conversation.

### Codex

```sh
codex plugin remove accessibility-audit@accessibility-audit-marketplace
codex plugin marketplace remove accessibility-audit-marketplace
```

### GitHub Copilot CLI

```sh
copilot plugin uninstall accessibility-audit
```

Marketplace administrators control Copilot in VS Code removal through the organisation-approved client workflow.

Deleting the separate source checkout is optional after every client has been uninstalled.

## Troubleshooting installation

### `dist/mcp.js` is missing

Run `npm ci` and `npm run build` in the plugin checkout. Do not run them in the project being audited.

### Chromium is missing

Normally no manual step is required. The plugin tries bundled Chromium, Chrome, and Edge, then installs Playwright Chromium once in plugin-owned storage. If automatic installation is disabled or blocked, run this in the plugin checkout:

```sh
npx playwright install chromium
```

### The plugin is listed but the MCP server failed

For source-checkout installations, confirm that Node.js 22 or later is visible to the client, `dist/mcp.js` exists, and dependencies were installed in the plugin checkout. For generated marketplace payloads, run `npm run validate:marketplace` and `npm run test:marketplace`; the latter performs a real packaged installation and MCP handshake. Inspect the first `accessibility-audit` startup error rather than repeatedly reloading.

### The command is not visible

- Cursor: reload the window, check **Customize**, and check local-plugin policy.
- Claude Code: run `/plugin`, inspect **Installed** and **Errors**, then `/reload-plugins`.
- Codex: run `codex plugin list`, open `/plugins`, and start a new session. Do not test in the unsupported Codex IDE extension.
- Copilot CLI: run `copilot plugin list`, then `/skills list` in a new interactive session. Reinstall a changed local payload because Copilot caches it.
- Copilot in VS Code: verify the organisation marketplace connection, enabled plugin, skill, and MCP server, then reload the window once.

### The plugin writes files into the target repository

Set a separate output directory in the confirmation form or configuration. The default is `Accessibility Audit Results` in the user's home directory; plugin dependencies and build output belong only in the isolated plugin checkout.

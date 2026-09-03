# Installation

This guide installs the Accessibility Audit plugin without adding dependencies or configuration to the project being audited. Keep the plugin in its own permanent directory and open the unrelated project separately in Cursor, Claude Code, or Codex.

## Choose the supported installation path

| Client | Supported developer installation | Where the audit runs |
|---|---|---|
| Cursor | Built checkout under Cursor's local plugin directory, normally by symlink | Any project opened in Cursor |
| Claude Code | Built checkout passed with `--plugin-dir`, or a built local marketplace | Any directory from which Claude Code is started |
| Codex | Built checkout registered as a local marketplace in Codex CLI | Any directory from which Codex CLI is started |

The Codex IDE extension does not currently load plugins. Use Codex CLI or another Codex/ChatGPT surface that supports plugins.

The repository also contains marketplace metadata for private distribution. A marketplace administrator must package and validate a release before offering it remotely. Cloning the source and completing the build below is the supported developer route; do not assume that an unbuilt source snapshot contains `dist/mcp.js`.

## 1. Install the shared prerequisites

You need:

- Git access to the private repository;
- Node.js 22 or later;
- npm;
- Cursor, Claude Code, or Codex CLI, depending on the client being tested;
- Microsoft Excel or another OOXML-compatible application to open the generated report.

Verify the basic tools:

```sh
git --version
node --version
npm --version
```

If the GitHub repository is private, authenticate Git before cloning. For example, use your organisation's approved Git credential helper or `gh auth login`, then verify that the account can read the repository.

## 2. Prepare one isolated plugin checkout

Run these commands in a tools directory, not inside the application repository that will be audited:

```sh
git clone https://github.com/carla-goncalves_radancy/accessibility-audit-plugin.git accessibility-audit
cd accessibility-audit
npm ci
npx playwright install chromium
npm run build
```

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
git clone https://github.com/carla-goncalves_radancy/accessibility-audit-plugin.git $PluginPath
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

## 3C. Install in Codex

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
npx playwright install chromium
npm run build
npm run check
```

Then refresh the relevant client:

- Cursor: run **Developer: Reload Window**.
- Claude Code with `--plugin-dir`: restart the session. For a local marketplace, run `/plugin marketplace update accessibility-audit-marketplace`, reinstall or update the plugin if offered, then run `/reload-plugins`.
- Codex: remove and reinstall the cached plugin, then start a new session:

```sh
codex plugin remove accessibility-audit@accessibility-audit-marketplace
codex plugin add accessibility-audit@accessibility-audit-marketplace
```

## 6. Uninstall

### Cursor

Remove only the `~/.cursor/plugins/local/accessibility-audit` local-plugin entry, then reload Cursor. Do not delete the target application repository.

### Claude Code

```text
/plugin uninstall accessibility-audit@accessibility-audit-marketplace
/plugin marketplace remove accessibility-audit-marketplace
```

### Codex

```sh
codex plugin remove accessibility-audit@accessibility-audit-marketplace
codex plugin marketplace remove accessibility-audit-marketplace
```

Deleting the separate source checkout is optional after every client has been uninstalled.

## Troubleshooting installation

### `dist/mcp.js` is missing

Run `npm ci` and `npm run build` in the plugin checkout. Do not run them in the project being audited.

### Chromium is missing

Run this in the plugin checkout:

```sh
npx playwright install chromium
```

### The plugin is listed but the MCP server failed

Confirm that Node.js 22 or later is the version visible to the client, `dist/mcp.js` exists, and dependencies were installed in the plugin checkout. Inspect the first `accessibility-audit` MCP startup error rather than repeatedly reloading.

### The command is not visible

- Cursor: reload the window, check **Customize**, and check local-plugin policy.
- Claude Code: run `/plugin`, inspect **Installed** and **Errors**, then `/reload-plugins`.
- Codex: run `codex plugin list`, open `/plugins`, and start a new session. Do not test in the unsupported Codex IDE extension.

### The plugin writes files into the target repository

Set a separate output directory in the confirmation form or configuration. The default is `Accessibility Audit Results` in the user's home directory; plugin dependencies and build output belong only in the isolated plugin checkout.

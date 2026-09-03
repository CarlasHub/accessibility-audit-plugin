# RAI Ops marketplace submission

This document prepares a release for `radancy-pe/rai-ops-plugin-marketplace`. It does not authorize or perform changes in that repository. Build and verify the release in this source repository first; copy it to a marketplace fork only after the release is accepted for submission.

## Supported marketplace payloads

`npm run build:marketplace` generates three independent payloads under `marketplace/rai-ops-plugin-marketplace/accessibility-audit`:

| Directory | Catalog | Manifest | Intended client |
|---|---|---|---|
| `claude` | `.claude-plugin/marketplace.json` | `.claude-plugin/plugin.json` | Claude Code |
| `copilot-cli` | `.github/plugin/marketplace.json` | `plugin.json` | GitHub Copilot CLI |
| `copilot-vscode` | `.github/plugin/marketplace.json` | `.claude-plugin/plugin.json` | GitHub Copilot in VS Code |

Each payload contains the audit skill, command guidance, MCP configuration, a checksum-verified application archive, and an installer/launcher. Production dependencies are bundled in the archive. On first activation, they are extracted into the client’s plugin data directory. Nothing is installed into the project open in the editor.

Cursor and Codex support remain in the source repository. The current RAI Ops marketplace has no Cursor or Codex harness, so this submission does not invent catalog entries for them.

## Release prerequisites

- Node.js 22 or later and npm.
- A clean source checkout at the release commit.
- Permission to fork and open a pull request against the RAI Ops marketplace when submission is approved.
- No customer audit output, screenshots, private URLs, or credentials in the source tree.

The generated payload carries a bundled workbook template but no captured audit screenshots or customer data.

## Build the candidate in the source repository

```sh
npm ci
npm run check
npm run test:integration
npm run build:marketplace
npm run validate:marketplace
npm run test:marketplace
npm run test:rai-marketplace
npm pack --dry-run
```

`build:marketplace` is the only supported way to create the payload. It compiles the TypeScript source, creates an npm archive with bundled production dependencies, calculates its SHA-256 digest, writes the three install manifests, and regenerates client manifests and catalog fragments. Do not hand-edit generated payload files.

`validate:marketplace` verifies paths, names, versions, manifests, hooks, MCP launchers, runtime checksums, required compiled files, the workbook template, and removal of retired screen-reader automation files. `test:marketplace` performs an offline install from the packaged archive in a temporary directory, opens an MCP protocol connection, lists the six tools, calls the embedded-instructions tool, and checks that an unrelated target directory is unchanged.

`test:rai-marketplace` clones the current marketplace into a temporary directory, inserts the staged payload and catalog fragments there, runs the marketplace’s own validator and tests, and deletes the temporary checkout. It requires read access to the marketplace but never pushes or changes the remote repository.

## Review the generated candidate

Before copying anything, inspect:

- `marketplace/rai-ops-plugin-marketplace/accessibility-audit/claude`
- `marketplace/rai-ops-plugin-marketplace/accessibility-audit/copilot-cli`
- `marketplace/rai-ops-plugin-marketplace/accessibility-audit/copilot-vscode`
- `marketplace/rai-ops-plugin-marketplace/catalog-fragments/claude.json`
- `marketplace/rai-ops-plugin-marketplace/catalog-fragments/copilot.json`

Confirm that all three install manifests have the same application version, tarball name, and SHA-256 digest. Confirm that the release version matches `package.json`, `src/version.ts`, the source client manifests, and `CHANGELOG.md`.

## Copy into a marketplace fork

After the release candidate is approved, create or update a fork of `radancy-pe/rai-ops-plugin-marketplace`. From the marketplace fork root, copy the generated `accessibility-audit` directory as one unit:

```sh
cp -R /path/to/accessibility-audit/marketplace/rai-ops-plugin-marketplace/accessibility-audit ./accessibility-audit
```

Do not copy `catalog-fragments` into the marketplace. Those two files are controlled insertion examples.

Add the object from `catalog-fragments/claude.json` to the `plugins` array in `.claude-plugin/marketplace.json`. Add both objects from `catalog-fragments/copilot.json` to the `plugins` array in `.github/plugin/marketplace.json`. Sort each complete `plugins` array alphabetically by `name`; do not merely append the new entries.

For the first pull request, the Claude source reference may use `main` because the release tag cannot point at an unmerged payload. The marketplace validator reports that moving reference as a warning, not an error.

## Validate the marketplace fork

Run the marketplace’s own checks from its root:

```sh
node tests/validate-marketplace.mjs
node --test tests/validate-marketplace.test.mjs
```

Then validate the copied package, using the source repository scripts before the pull request if any payload changed. A passing catalog validator proves catalog structure and manifest agreement. It does not prove client UI behavior or a real website audit.

Review the fork diff and confirm that it contains only:

- `accessibility-audit/claude/**`
- `accessibility-audit/copilot-cli/**`
- `accessibility-audit/copilot-vscode/**`
- one alphabetically inserted Claude catalog entry
- two alphabetically inserted Copilot catalog entries

## Pull-request and tag sequence

1. Open the initial marketplace pull request with the three payloads and catalog entries.
2. Record the source commit and all verification results in the pull-request description.
3. After the marketplace pull request merges, create a marketplace tag named `accessibility-audit-v<version>` at the reviewed merge commit.
4. Open a small follow-up pull request changing only the Claude catalog entry’s `source.ref` from `main` to that immutable tag.
5. Re-run the marketplace validator. The accessibility-audit moving-reference warning must be gone.

Do not move or reuse an existing release tag. A new plugin version requires a new generated payload, new checksum, catalog version updates, a new reviewed marketplace commit, and a new immutable tag.

## Manual client verification

Automated packaging tests do not replace client checks. Before broad rollout, verify each supported marketplace harness:

### Claude Code

1. Add the test fork as a marketplace.
2. Install `accessibility-audit@radancy`.
3. Start a new session and confirm the command, skill, and MCP server load.
4. Run one authorized test page and stop a second run to verify partial output.

### GitHub Copilot CLI

1. Add the test fork with `copilot plugin marketplace add OWNER/REPOSITORY`.
2. Install `accessibility-audit@radancy`.
3. Confirm the plugin with `copilot plugin list` and the skill with `/skills list`.
4. Run one authorized test page and verify the Excel, JSON, ZIP, progress, and cancellation behavior.

### GitHub Copilot in VS Code

1. Add the test marketplace using the organisation-approved VS Code flow.
2. Enable `accessibility-audit-vscode`.
3. Confirm the skill and `accessibility-audit` MCP server appear without startup errors.
4. Run one authorized test page and verify that no file in the open project changes.

Use non-sensitive test pages. Do not attach private screenshots or page content to a public or broadly visible pull request.

## Runtime and browser behavior

The first plugin activation verifies the packaged SHA-256 digest and prepares a versioned runtime in `CLAUDE_PLUGIN_DATA`, `COPILOT_PLUGIN_DATA`, or the plugin’s private fallback cache. Concurrent startup attempts share a lock. Failed and incomplete installs are cleaned up, and a subsequent activation retries.

The browser remains headless by default. At audit start, the engine tries bundled Playwright Chromium, system Chrome, and system Edge. If none is available and `autoInstallBrowser` is true, it downloads Playwright Chromium once into plugin-owned browser storage and reports progress. The audited project remains read-only. Environments that prohibit browser downloads must provision an approved Chromium browser and disable automatic installation explicitly.

## Rollback

If a released payload fails:

1. Disable or remove the affected catalog entries through the marketplace’s normal review process.
2. Do not rewrite the release tag.
3. Fix the source repository, increment the version, regenerate all payloads, and repeat the full verification and submission sequence.
4. Tell affected users to update the marketplace and plugin. Copilot caches installed plugins, so a local development payload must be reinstalled to pick up changes.

## Known verification boundary

The source repository can prove compilation, unit behavior, real browser integration, payload structure, offline packaged dependency installation, MCP startup, tool discovery, workbook generation, and target-project isolation. It cannot prove installation inside every managed enterprise client configuration. Claude Code, Copilot CLI, and Copilot in VS Code must still be exercised manually in the intended organisation environment before broad release.

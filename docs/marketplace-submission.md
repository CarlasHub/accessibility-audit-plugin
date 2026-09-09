# Marketplace and directory submission

This repository is the CarlasHub source of truth for Accessibility Audit. It can produce local and Git-distributed plugin payloads now. Publishing, opening a marketplace pull request, or submitting to a directory remains an explicit release action by a repository owner.

## What is ready

- Portable plugin metadata in `plugin.json` and `mcp.json`.
- A root `action.yml` and committed, self-contained `action/dist` bundle for GitHub Actions Marketplace.
- Client manifests for Codex, Claude, and Cursor.
- A discoverable skill, command, rules, local stdio MCP server, and validated WCAG 2.2 workbook.
- Generated Claude Code, GitHub Copilot CLI, and GitHub Copilot in VS Code payloads under `marketplace/carlashub-plugin-marketplace`.
- MIT licence, privacy notice, terms, security policy, support guidance, and contributor guidance.
- Automated package, runtime, workbook, and documentation validation.

## Build the release candidate

Use Node.js 22 or later from a clean checkout:

```sh
npm ci
npm run check
npm run test:integration
npm run build:action
npm run test:action
npm run build:marketplace
npm run validate:marketplace
npm run test:marketplace
npm run test:marketplace-compatibility
npm pack --dry-run
git diff --exit-code -- action/dist
```

The browser integration suite requires Playwright Chromium. Install it with `npx playwright install chromium` when the release environment does not already provide a supported browser.

Generated payloads must not be edited by hand. Re-run `npm run build:marketplace` after changing source metadata, instructions, runtime code, dependencies, or the workbook.

## Publish from GitHub

1. Review the final diff and confirm that it contains no credentials, cookies, private URLs, captured page content, or private screenshots.
2. Merge the approved change to the default branch.
3. Create an immutable version tag and GitHub release from the tested commit.
4. Attach the generated release archive when a client or marketplace requires a downloadable package.
5. Follow each client marketplace's current review process, using this repository and release tag as the source.

The public listing should link to [Privacy](../PRIVACY.md), [Terms](../TERMS.md), [Security](../SECURITY.md), and [Support](../SUPPORT.md). Use the repository issue tracker for non-sensitive bugs and the security policy for vulnerabilities.

### GitHub Actions Marketplace

1. Make the repository public after the security and privacy review passes.
2. Confirm that the root `action.yml`, committed `action/dist`, README usage example, licence, support, privacy, and security files are present.
3. Draft a `v1.0.0` GitHub release from the tested commit.
4. Select **Publish this Action to the GitHub Marketplace**, accept the GitHub Marketplace Developer Agreement, and choose **Code quality** plus **Testing** where those categories are available.
5. Create or move the `v1` tag to the same commit so users can follow compatible `v1.x.x` releases.
6. Run `.github/workflows/accessibility-audit.yml` manually against a public, non-sensitive page and retain the workflow result as listing evidence.

See [GitHub Action usage](github-action.md) for the consumer contract and [GitHub Developer Program application](github-developer-program.md) for the application evidence and owner-only steps.

## OpenAI Plugin Directory boundary

The repository MCP server is a local stdio process. For an OpenAI Plugin Directory submission that includes MCP functionality, deploy the same tool contract as a stable public HTTPS remote MCP server first. Do not point a directory listing at a developer laptop, a temporary tunnel, or an unauthenticated service that can reach private audit targets.

Before submission, prepare:

- a verified developer or business account;
- a public HTTPS MCP endpoint and documented authentication model;
- production privacy and terms URLs;
- a square icon, listing screenshots, concise descriptions, category, and support contact;
- representative prompts and expected tool behavior;
- test credentials only when reviewers need them, with no access to private customer data;
- evidence that target allowlisting, credential handling, output retention, and abuse controls work in the hosted environment.

A skills-only submission is not equivalent to the local plugin because this skill depends on the MCP audit tool. Submit the complete experience only after the hosted MCP service exists and has passed the same behavioral and report-validation checks.

## Suggested reviewer test cases

1. Audit one non-sensitive public staging page and confirm the pre-run scope and auditor prompt.
2. Audit two explicit pages and confirm that the plugin does not crawl beyond them.
3. Generate and open the ZIP; verify all six workbook sheets and relative evidence links.
4. Confirm that review and manual records are not presented as proven failures or automated passes.
5. Cancel a run once and confirm that valid partial JSON, XLSX, and ZIP outputs are preserved.
6. Supply a disallowed host and confirm the request is rejected before browser testing.
7. Confirm that credentials are redacted from logs and are absent from the workbook and JSON output.

Use synthetic or intentionally public test pages. Never attach private screenshots, cookies, authorization headers, or proprietary page content to a public submission.

## Rollback

If a released payload fails, disable or remove the affected listing through the marketplace's normal process, keep the original tag immutable, fix the source, increment the version, rebuild every payload, and repeat the complete verification sequence.

# Contributing

## Engineering requirements

- Preserve the distinction between confirmed, review, blocker, and manual results.
- Do not convert heuristics or mocked behavior into confirmed accessibility verdicts.
- Keep the target repository read-only and audit output isolated.
- Keep Notes remediation-only.
- Add or update failure-case tests for behavior changes.
- Update README, manifests, embedded instructions, commands, rules, and skill references when the public interface changes.

## Development setup

```sh
npm ci
npx playwright install chromium
npm run check
npm run test:integration
```

## Pull requests

Describe the verified behavior, files changed, commands run, results, limitations, and manual verification. Do not include generated audit artifacts, private URLs, or captured customer data.

Before opening a pull request:

```sh
npm run check
npm run test:integration
npm run build:marketplace
npm run validate:marketplace
npm run test:marketplace
npm run test:rai-marketplace
npm pack --dry-run
```

Generated files under `marketplace/rai-ops-plugin-marketplace/accessibility-audit` must be produced by `npm run build:marketplace`, not edited manually. Keep the source version, client manifests, catalog fragments, install manifest, checksum, and packaged runtime aligned. The marketplace smoke test proves packaged installation and MCP protocol startup; it does not prove that Claude, Cursor, Codex, or Copilot client UI integrations behave correctly.

Changes to workbook output must verify required sheets, formulas, row population, relative Image Inventory links, absence of embedded audit images, and rendered readability.

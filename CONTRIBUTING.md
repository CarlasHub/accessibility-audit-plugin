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
npm pack --dry-run
```

Changes to workbook output must verify required sheets, formulas, row population, Image Inventory embedding, and rendered readability.

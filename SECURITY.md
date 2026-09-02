# Security policy

## Supported version

Security fixes are applied to the latest released version.

## Reporting a vulnerability

Do not open a public issue containing credentials, private URLs, captured page content, screenshots, or exploit details. Contact the repository owner privately through the GitHub security advisory flow. Include the affected version, reproduction steps, impact, and a minimal sanitized example.

## Data handling

The plugin visits explicitly supplied URLs and writes reports, JSON evidence, and screenshots to the configured local output directory. Those artifacts can contain confidential page content, user identifiers, or authenticated information. Store, share, and delete them according to the audited project’s policy.

The plugin does not upload audit artifacts, collect credentials, or intentionally modify the audited repository. Same-origin link checks reuse the Playwright context for access to authorized pages and skip known logout, delete, remove, unsubscribe, and download targets.

## Dependency and release checks

Before release, run:

```sh
npm ci
npm audit
npm run check
npm run test:integration
npm pack --dry-run
```

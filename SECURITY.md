# Security policy

## Supported version

Security fixes are applied to the latest released version.

## Reporting a vulnerability

Do not open a public issue containing credentials, private URLs, captured page content, screenshots, or exploit details. Contact the repository owner privately through the GitHub security advisory flow. Include the affected version, reproduction steps, impact, and a minimal sanitized example.

## Data handling

The plugin visits explicitly supplied URLs and writes reports, JSON evidence, and screenshots to the configured local output directory. Those artifacts can contain confidential page content, user identifiers, or authenticated information. Store, share, and delete them according to the audited project’s policy.

The local plugin does not upload audit artifacts, ask for sign-in credentials, or intentionally modify the audited repository. The maintained reusable GitHub workflow stores evidence in an access-controlled workflow artifact and offers a separate `publish-report` input for an explicitly public GitHub Pages deployment; that input is disabled by default and its write permissions are confined to the skipped-by-default publishing job. Treat Pages as public unless the caller's repository and organization settings demonstrably enforce a narrower audience. Disabling the input does not withdraw a previous deployment, so remove or disable the Pages site when hosted evidence must be deleted.

For protected pages, an operator may explicitly provide the path to a local Playwright storage-state file containing an already-authorized session. Treat that file as a live secret: keep it outside source control and report directories, restrict access, use least privilege, and remove or revoke it after use. Never include its contents in a prompt or public report, and never publish an authenticated audit through GitHub Pages. See [Auditing authenticated pages safely](docs/authenticated-pages.md). Same-origin link checks reuse the Playwright context for access to authorized pages and skip known logout, delete, remove, unsubscribe, and download targets.

## Dependency and release checks

Before release, run:

```sh
npm ci
npm run audit:dependencies
npm run check
npm run test:integration
npm run package:release-bundles
npm pack --dry-run
```

Release bundles include SHA-256 files and a reproducible CycloneDX 1.6 SBOM containing production dependencies only. The tag must exactly equal `v<package.json version>` or the workflow stops before packaging and attestation. A valid version tag generates GitHub build-provenance and SBOM attestations with job-scoped `id-token: write` and `attestations: write` permissions; ordinary verification and plugin workflows remain read-only. The workflow retains a reviewed release candidate but never publishes a GitHub release automatically. Before attaching an archive to a release, verify both its checksum and repository identity with `gh attestation verify <archive> --repo CarlasHub/accessibility-audit-plugin`.

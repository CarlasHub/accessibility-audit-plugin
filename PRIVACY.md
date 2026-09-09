# Privacy notice

Last updated: 9 September 2026

Accessibility Audit is an open-source CarlasHub plugin that runs locally unless a distributor explicitly hosts it as a service. The local plugin does not send telemetry or audit results to CarlasHub.

## Data the plugin processes

When instructed by the user, the plugin may process:

- the explicit page URLs or page-list file supplied for an audit;
- page content, accessibility metadata, network status, and browser-rendered state from those pages;
- optional authentication headers or cookies supplied for the audit session;
- screenshots, selectors, test evidence, and user-supplied report metadata.

This data is used only to run the requested checks and generate local JSON, XLSX, screenshot, and ZIP outputs. Authentication values are kept in memory for the run and are not intentionally written to reports or logs.

## Storage and retention

Outputs are written to the location selected by the user. CarlasHub does not receive or retain local audit output. Users control access, sharing, retention, and deletion of those files. Marketplace clients, source-control hosts, package registries, browsers, and audited websites may apply their own privacy practices.

## Network access

The plugin connects to the target URLs chosen by the user and may download Playwright Chromium when no supported browser is available and automatic installation is enabled. Normal package installation may contact npm and source-control services.

## User responsibilities

Only audit pages you are authorized to access. Do not place production credentials, unnecessary personal data, or confidential evidence in public issue reports. Review generated output before sharing it.

## Changes and contact

Material changes to this notice will be recorded in the repository. For privacy questions, open a non-sensitive issue at <https://github.com/CarlasHub/accessibility-audit-plugin/issues>. Report vulnerabilities through [SECURITY.md](SECURITY.md), not through a public issue.

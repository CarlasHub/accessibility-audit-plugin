# Privacy notice

Last updated: 12 October 2026

Accessibility Audit includes an open-source local plugin, a GitHub Action, and a public setup builder with an optional GitHub connector. The local plugin does not send telemetry or audit results to CarlasHub. The public builder and connector help select pages and install a workflow; they do not run audits or receive reports.

## Data the plugin processes

When instructed by the user, the plugin may process:

- the seed URL and same-origin links read during guided discovery, or the explicit page URLs or page-list file supplied for a manual audit;
- page content, accessibility metadata, network status, and browser-rendered state from those pages;
- optional authentication headers or cookies supplied for the audit session;
- screenshots, selectors, test evidence, and user-supplied report metadata.

This data is used only to run the requested checks and generate local JSON, XLSX, screenshot, and ZIP outputs. Authentication values are kept in memory for the run and are not intentionally written to reports or logs.

## Data the GitHub Action processes

The Action processes the explicit URLs and settings in the caller's workflow, the page content and browser state needed for the audit, and the resulting evidence. It runs in the caller's GitHub repository. The normal reusable workflow stores results in that repository's access-controlled Actions artifact; optional GitHub Pages publication is off by default and should be treated as public unless the repository's settings demonstrably provide a narrower audience.

The Action does not crawl for additional audit pages. Only the explicit URLs in the workflow are audited.

## Data the public builder and connector process

The browser may store the current website address, manually entered URLs, selected setup route, and repository draft in site storage so setup can be resumed. A connected GitHub session uses browser session storage and is removed when it expires or the user disconnects. Users can remove saved drafts by clearing site data for `carlashub.github.io`.

Anonymous discovery sends the starting public URL to the connector. The connector fetches bounded public HTML on that exact origin, extracts and classifies links, removes common tracking variants, and returns a signed candidate list. The signed discovery result expires after 15 minutes. A source network address may be processed to enforce the limit of five discovery requests per minute.

Connected setup processes GitHub OAuth state, App installation and repository metadata, the selected URLs, and the request to create and start the managed workflow. OAuth state expires after ten minutes. The GitHub access token is kept server-side behind a random opaque connector session that expires after one hour; it is never returned to the page. The connector writes only `.github/workflows/accessibility-audit.yml`, does not accept arbitrary file content from the browser, and does not receive the resulting audit or report.

## Storage and retention

Local outputs are written to the location selected by the user. GitHub Action outputs remain in the caller's repository under its access and retention settings. CarlasHub does not receive or retain either form of audit output. Users control access, sharing, retention, and deletion of those files.

Expired connector state and sessions are removed by the service's configured time-to-live. Browser drafts remain until they are cleared or replaced. GitHub App access can be limited to selected repositories and revoked from the user's GitHub settings.

## Network access

The plugin and Action connect to the target URLs chosen by the user and may download Playwright browsers when no supported browser is available and automatic installation is enabled. Normal package installation may contact npm and source-control services. The public builder and connector use GitHub for repository authorization and workflow operations and Cloudflare for the bounded connector service. Those providers, browsers, package registries, and audited websites apply their own privacy practices.

## User responsibilities

Only audit pages you are authorized to access. Do not place production credentials, unnecessary personal data, or confidential evidence in public issue reports. Review generated output before sharing it.

## Changes and contact

Material changes to this notice will be recorded in the repository. For privacy questions, open a non-sensitive issue at <https://github.com/CarlasHub/accessibility-audit-plugin/issues>. Report vulnerabilities through [SECURITY.md](SECURITY.md), not through a public issue.

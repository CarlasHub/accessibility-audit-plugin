# Public builder guide

The [public Accessibility Audit builder](https://carlashub.github.io/accessibility-audit-plugin/) is the easiest way to prepare and start the GitHub Action. It discovers pages before GitHub authorization, lets the user approve the exact audit scope, and keeps every audit and report in the user's own repository.

## Fastest path

1. In **Add pages**, enter one public website address and choose **Find pages**, or choose **Enter page URLs myself** and add up to 20 exact URLs.
2. In **Choose pages**, review the visible checklist. Content pages are selected by default; likely job, category, tag, archive, utility, and query-variant pages stay visible but unchecked. Only checked pages will be audited.
3. In **Repository**, choose **Use my repository (recommended)**, connect GitHub, and select a public or private repository you control.
4. In **Review**, confirm the exact pages, destination, permissions, privacy, and cost boundary, then choose **Start accessibility audit**.
5. The connector creates or updates its managed `.github/workflows/accessibility-audit.yml` file and immediately starts the **Accessibility audit** workflow.
6. Open the repository's **Actions** tab, choose the new run, and download its report artifact when it finishes.

The owner maintains one CarlasHub GitHub App. Visitors do **not** create their own App: each visitor authorizes that App and chooses which repositories it may access.

## Other setup paths

- **Enter page URLs myself** keeps the original form for up to 20 explicit public URLs.
- **Create a repository first** opens the starter template in a new tab and retains the exact checked-page selection in the builder tab. After GitHub creates the repository, return to the builder, grant the CarlasHub GitHub App access to the new repository if needed, choose **Refresh repositories**, and select it. The connector then writes those pages into the managed workflow and starts the Action. GitHub's repository template form itself cannot receive a visitor's dynamic page selection.
- **Preview or download the workflow instead** provides a no-sign-in fallback. This route requires the user to add the file to a repository and start the workflow from GitHub.

The discovery service finds possible pages only. The installed Action does not crawl: it audits exactly the checked URLs written into the workflow.

## Discovery limits and filtering

Discovery is deliberately bounded so one visitor cannot consume unlimited shared resources.

| Boundary | Limit |
| --- | --- |
| Processed HTML pages | 40 |
| Total outbound requests, including redirects | 45 |
| Displayed candidate URLs | 60 |
| Link depth from the starting page | 3 |
| HTML response size | 750 KB |
| Overall discovery time | 25 seconds |
| Pages selected for one audit | 20 |
| Discovery requests from one source address | 5 per minute |

Discovery accepts public HTTP or HTTPS HTML on the starting URL's exact origin. It removes fragments and common tracking parameters, deduplicates equivalent URLs, and blocks local, private, reserved, or otherwise non-public network destinations. Excluded page types remain available so the user—not an automated guess—makes the final scope decision.

## GitHub permissions and safeguards

- GitHub authorization is requested only after the user chooses connected repository automation.
- The browser receives an opaque connector session, not the GitHub token. The server-side session expires after one hour; the signed discovery result expires after 15 minutes.
- Repository choices are limited to non-archived repositories the user can write and has shared with the App.
- The connector writes only `.github/workflows/accessibility-audit.yml`.
- It updates workflows marked as managed by this builder, but refuses to replace a different file at that path.
- Workflow content is generated and validated by the connector; the page cannot submit an arbitrary repository file.
- A newly saved managed workflow is dispatched immediately. If GitHub has not indexed the file yet, the connector retries before reporting a recoverable start error.

## Privacy, storage, and cost boundary

The browser retains the current site address, entered URLs, destination choice, and repository draft so setup can be resumed. The connected GitHub session is held in session storage and removed when it expires or the user disconnects. Clear the site's browser data to remove saved drafts.

The connector processes the discovery URL, public page links, selected URLs, GitHub OAuth state, installation/repository metadata, and the managed workflow request. It does not run audits, receive reports, or store audit evidence. GitHub Actions runs the audit inside the selected repository, where that repository's access controls, retention settings, and Actions allowance apply.

CarlasHub keeps the shared connector on the Cloudflare Workers Free plan. If the shared allowance or rate limit is reached, automated discovery or repository setup stops instead of moving the audit onto a paid CarlasHub service; visitors can still use the manual URL and workflow-download route. A visitor's GitHub plan and Actions usage are controlled by GitHub and remain that visitor's responsibility.

## Troubleshooting

### No pages were found

Confirm the address is public, uses HTTP or HTTPS, returns HTML, and does not require a sign-in, CAPTCHA, private network, or anti-bot exception. Try the canonical homepage rather than a redirected or tracking URL. If discovery is unavailable, choose **Enter page URLs myself**.

### A checkbox or candidate page is missing

Refresh the live builder rather than an old downloaded copy. The current checklist uses a visible native checkbox for every discovered page. Discovery may stop at its documented page, request, depth, size, or time boundary; add an omitted page through the manual form.

### No repository is listed

Choose **Manage repository access**, grant the CarlasHub App access to at least one writable repository, return to the still-open builder tab, and choose **Refresh repositories**. Archived or read-only repositories are not offered.

### The workflow was not changed

A different file already exists at `.github/workflows/accessibility-audit.yml`. The builder will not overwrite it. Review that file yourself, move or rename it if appropriate, then retry; alternatively preview or download the generated workflow and merge the intended changes manually.

### The workflow was saved but did not start

Open the selected repository and choose **Actions → Accessibility audit → Run workflow**. This is the manual recovery path after the connector's automatic dispatch retries. Repository policy may require Actions to be enabled or approved.

### The shared service reached a limit

Wait for the displayed retry period, or use **Enter page URLs myself** with **Preview or download the workflow instead**. The Action itself remains available because it runs in the user's repository rather than on the connector.

For product support, use [SUPPORT.md](../SUPPORT.md). For data handling, see [PRIVACY.md](../PRIVACY.md). Report vulnerabilities privately through [SECURITY.md](../SECURITY.md).

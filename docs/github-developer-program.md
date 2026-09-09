# GitHub Developer Program status

As of 9 September 2026, GitHub confirms that **CarlasHub is already a GitHub Developer Program member**. The public [CarlasHub profile](https://github.com/CarlasHub) displays the **Developer Program Member** highlight, so no new application is required for this Action.

The evidence below can be used to keep the existing Developer Program account information current or to describe the project publicly.

## Integration evidence

- **Name:** CarlasHub WCAG Accessibility Audit
- **Repository:** `https://github.com/CarlasHub/accessibility-audit-plugin`
- **Owner:** CarlasHub
- **Licence:** MIT
- **Integration:** A JavaScript GitHub Action that audits explicit web pages and writes Excel, JSON, screenshot, and ZIP evidence to a workflow run.
- **GitHub API use:** With an explicitly supplied `GITHUB_TOKEN`, it lists pull-request comments and creates or updates one marked audit summary through the GitHub REST API.
- **Permissions:** `contents: read`; `pull-requests: write` only when comments are enabled.
- **Support:** Public issues for sanitized bugs and feature requests; private security advisories for vulnerabilities; keep a monitored support email in the existing Developer Program account details.
- **Privacy and terms:** Repository-root `PRIVACY.md` and `TERMS.md`.

## Project description

> CarlasHub WCAG Accessibility Audit is an open-source GitHub Action that runs repeatable accessibility checks against explicitly supplied web pages. It produces a validated Excel report, structured JSON, screenshot evidence, and a portable archive in GitHub Actions. When enabled, it uses the GitHub REST API to create or update a concise pull-request audit summary. The project applies least-privilege permissions, keeps human-review findings separate from confirmed automated evidence, and is released under the MIT License.

## Recognition checklist

1. GitHub Developer Program membership is active and its badge is public.
2. The repository, documentation, `v1.0.0` release, and movable `v1` tag are public.
3. Accept the GitHub Marketplace Developer Agreement in GitHub's release editor.
4. Publish `v1.0.0` to GitHub Marketplace as a free Action under **Code quality** and **Testing**.
5. Pin the public repository to the CarlasHub profile and link the Marketplace listing from the repository About section.

Acceptance of GitHub's agreements belongs to the account owner and is intentionally not automated by this repository.

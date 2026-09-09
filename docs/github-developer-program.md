# GitHub Developer Program application

CarlasHub can use this Action as the working GitHub API integration for a GitHub Developer Program application. GitHub currently requires an integration in production or development that uses the GitHub API and an email address where users can obtain support.

## Integration evidence

- **Name:** CarlasHub WCAG Accessibility Audit
- **Repository:** `https://github.com/CarlasHub/accessibility-audit-plugin`
- **Owner:** CarlasHub
- **Licence:** MIT
- **Integration:** A JavaScript GitHub Action that audits explicit web pages and writes Excel, JSON, screenshot, and ZIP evidence to a workflow run.
- **GitHub API use:** With an explicitly supplied `GITHUB_TOKEN`, it lists pull-request comments and creates or updates one marked audit summary through the GitHub REST API.
- **Permissions:** `contents: read`; `pull-requests: write` only when comments are enabled.
- **Support:** Public issues for sanitized bugs and feature requests; private security advisories for vulnerabilities; a support email must be supplied in the application.
- **Privacy and terms:** Repository-root `PRIVACY.md` and `TERMS.md`.

## Suggested application description

> CarlasHub WCAG Accessibility Audit is an open-source GitHub Action that runs repeatable accessibility checks against explicitly supplied web pages. It produces a validated Excel report, structured JSON, screenshot evidence, and a portable archive in GitHub Actions. When enabled, it uses the GitHub REST API to create or update a concise pull-request audit summary. The project applies least-privilege permissions, keeps human-review findings separate from confirmed automated evidence, and is released under the MIT License.

## Owner checklist

1. Publish the repository and its documentation publicly.
2. Publish the tested `v1.0.0` release to GitHub Marketplace as a free Action and point the movable `v1` tag to the same commit.
3. Choose a monitored support email that can be disclosed to GitHub users. Do not use a no-reply address.
4. Confirm two-factor authentication is enabled on the submitting account.
5. Sign in at `https://github.com/developer/register`, enter the repository and support details, review the current terms, and submit.
6. After acceptance, pin the public repository to the CarlasHub profile and link the Marketplace listing from the repository About section.

The support email, acceptance of GitHub's agreements, and final form submission belong to the account owner and are intentionally not automated by this repository.

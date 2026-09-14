# GitHub and Marketplace public profile

As of 9 September 2026, GitHub confirms that **CarlasHub is already a GitHub Developer Program member**. The public [CarlasHub profile](https://github.com/CarlasHub) displays the **Developer Program Member** highlight, so no new application is required for this Action.

The details below keep the Action's public identity accurate across the repository, GitHub Marketplace, and the Developer Program account.

## Integration evidence

- **Name:** CarlasHub WCAG Accessibility Audit
- **Repository:** `https://github.com/CarlasHub/accessibility-audit-plugin`
- **Owner:** CarlasHub
- **Licence:** MIT
- **Positioning:** An evidence-backed accessibility pre-audit for WCAG 2.2 A/AA; it does not certify conformance.
- **Integration:** A JavaScript GitHub Action that tests explicit web pages and writes accessible HTML, validated Excel, structured JSON, screenshot, and ZIP evidence to a workflow run.
- **Marketplace:** `https://github.com/marketplace/actions/carlashub-wcag-accessibility-audit`
- **Website:** `https://carlashub.github.io/accessibility-audit-plugin/`
- **GitHub API use:** With an explicitly supplied `GITHUB_TOKEN`, it lists pull-request comments and creates or updates one marked audit summary through the GitHub REST API.
- **Permissions:** `contents: read`; `pull-requests: write` only when comments are enabled.
- **Support:** Public issues for sanitized bugs and feature requests; private security advisories for vulnerabilities; keep a monitored support email in the existing Developer Program account details.
- **Privacy and terms:** Repository-root `PRIVACY.md` and `TERMS.md`.

## Project description

> CarlasHub Accessibility Audit is an open-source, evidence-backed accessibility pre-audit for GitHub Actions and AI coding assistants. It tests explicitly supplied pages against supported WCAG 2.2 A/AA checks, separates confirmed failures from review candidates and coverage blockers, and exports accessible HTML, validated Excel, structured JSON, screenshots, and a portable evidence archive. It supports human evaluation without claiming that automation certifies conformance.

## Recognition checklist

1. GitHub Developer Program membership is active and its badge is public.
2. The repository, documentation, current release, Marketplace listing, website, and movable `v1` tag are public.
3. Complete GitHub's account verification and enable two-factor authentication for the owner account.
4. Confirm the GitHub Marketplace Developer Agreement is accepted in GitHub's release editor.
5. Keep the free Marketplace Action under **Code quality** and **Testing**, with the same description and links as the repository.
6. Pin the public repository to the CarlasHub profile and keep the website in the repository About section.

Account verification, two-factor authentication, and acceptance of GitHub's agreements belong to the account owner and are intentionally not automated by this repository.

# Auditing authenticated pages safely

Playwright storage state can contain live cookies and tokens. Treat the state file and every report from an authenticated page as confidential material.

## Use a least-privilege session

1. Get approval to audit the protected environment and the exact hosts in scope.
2. Sign in locally through an organization-approved Playwright workflow. Use a dedicated, least-privilege test account when possible; do not give the plugin a username, password, one-time code, API key, or recovery secret.
3. Save the browser state outside the audited repository and outside the audit output directory. This plugin's own repository ignores common `.auth/` locations and `audit-session*.json` names as defence in depth for development, but those rules do not protect another checkout and an ignore rule is never secure storage.
4. Restrict the file so only the audit operator can read it. On POSIX systems, use `chmod 600 <state-file>`; on other systems, use the equivalent user-only access control.
5. Set `storageState` to the local file path, or pass the path with `--storage-state`. For MCP audits, provide only the path in the tool input. Never paste the file contents into chat, configuration, logs, tickets, or reports.

Before an audit starts, the plugin safely checks that the saved state is a private, regular Playwright JSON file under 10 MiB, uses only the supported Playwright `cookies` and `origins`/`localStorage` shape, contains host-scoped session data, and has no cookie or origin scope outside the approved audit hosts. Public-suffix cookie domains and unknown fields are rejected. On POSIX systems the file must be owner-only (for example, mode `600`).

The state file must also be outside the report directory and its sibling portable-ZIP path, including when either path is reached through a symbolic link. After validation, the plugin binds the exact state bytes to the confirmation and keeps a private in-memory snapshot for every browser context; it never asks Playwright to reopen the path. If the file changes before execution, CLI and MCP runs stop before creating output and require a fresh summary and confirmation. The pre-audit summary reports that the check passed without displaying the file path, host list, or contents. Host allowlists, staging-only enforcement, supplied-pages-only scope, consent handling, and destructive-link protections still apply.

## Keep the security boundary explicit

- Use short-lived sessions and the minimum permissions needed to view the supplied pages.
- Prefer staging or a dedicated test environment. Keep `stagingOnly` enabled whenever the target supports it.
- Confirm every host and page in the pre-audit summary before starting.
- Do not put credentials or tokens in a URL, page-list file, journey, filename, prompt, or environment value used as ordinary audit input.
- Keep state files away from source control, shared folders, build artifacts, and the configured report directory.
- Assume screenshots, page text, URLs, and findings from an authenticated run may reveal private information. Store and share the entire output directory according to the target system's data policy.

## After the audit

Revoke or sign out the test session when practical, delete the local state file using your organization's approved process, and rotate the test account session if the file may have been exposed. Retain reports only for the required review period.

If a protected page redirects to sign-in or returns unauthorized content, stop and create a fresh approved state file. Do not work around access controls, broaden the account's permissions, or place secrets in a journey step.

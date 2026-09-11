# GitHub repository connector

This optional Cloudflare Worker lets a visitor choose one of their repositories from the public GitHub Pages builder. It creates the standard accessibility-audit workflow only when that file is absent, then dispatches the workflow in the visitor's repository.

The Worker does not run audits, receive reports, or pay for GitHub Actions. GitHub Actions usage and artifacts stay in the repository owner's account. The Worker stores an opaque, one-hour session in Cloudflare KV; the GitHub token never reaches the browser.

The public builder continues to offer the manual GitHub workflow editor and workflow download when this connector is not configured.

## 1. Register the GitHub App

In **GitHub → Settings → Developer settings → GitHub Apps**, create a new GitHub App with:

- **GitHub App name:** a unique name, for example `CarlasHub Accessibility Audit`
- **Homepage URL:** `https://carlashub.github.io/accessibility-audit-plugin/`
- **Callback URL:** `https://YOUR-WORKER.workers.dev/auth/github/callback`
- **Setup URL:** `https://carlashub.github.io/accessibility-audit-plugin/?github=installed`
- **Redirect on update:** enabled
- **Webhook:** inactive
- **Where can this GitHub App be installed?:** Any account

Request only these repository permissions:

- **Actions:** Read and write
- **Contents:** Read and write
- **Workflows:** Read and write
- **Metadata:** Read-only (GitHub supplies this automatically)

Enable **Request user authorization (OAuth) during installation**. Do not request repository Administration permission. GitHub's installation screen will let each user grant access to all repositories or only selected repositories.

Record the App's slug, OAuth client ID, and client secret. Never commit the client secret.

## 2. Create the free Worker resources

Authenticate Wrangler and create the KV namespace:

```sh
npx wrangler login
npx wrangler kv namespace create SESSIONS --config connector/wrangler.jsonc
```

Put the returned namespace ID in `connector/wrangler.jsonc`, and replace `REPLACE_WITH_GITHUB_APP_SLUG` with the App slug.

Add the secrets interactively:

```sh
npx wrangler secret put GITHUB_CLIENT_ID --config connector/wrangler.jsonc
npx wrangler secret put GITHUB_CLIENT_SECRET --config connector/wrangler.jsonc
npx wrangler secret put STATE_SECRET --config connector/wrangler.jsonc
```

Use a long, random value for `STATE_SECRET`. Deploy the connector:

```sh
npm run connector:deploy
```

If this is the first deployment, copy the resulting `workers.dev` address into the GitHub App's Callback URL.

## 3. Connect the GitHub Pages builder

Edit `site/public/config.js`:

```js
globalThis.__A11Y_AUDIT_CONNECTOR__ = Object.freeze({
  apiBaseUrl: 'https://YOUR-WORKER.workers.dev',
  githubAppSlug: 'YOUR-GITHUB-APP-SLUG'
});
```

Commit and push the change. The existing GitHub Pages workflow publishes the site. When both values are valid, **Choose from my GitHub repositories** appears in the existing-repository flow.

## Security behaviour

- Only the configured GitHub Pages origin and the local preview origin may call the API.
- OAuth state is signed and expires after ten minutes.
- Connector sessions expire after one hour and are held in KV under random identifiers.
- Repository options are limited to non-archived repositories the user can write and has shared with the App.
- The Worker writes only `.github/workflows/accessibility-audit.yml`.
- An existing, different workflow is never overwritten. The user receives a conflict message and can use the manual editor.
- The Worker generates the workflow server-side and never accepts arbitrary file content from the page.
- Each audit runs on the repository owner's GitHub Actions allowance.

For a deployment with no central CarlasHub service allowance at all, keep the manual editor flow or have each user deploy their own Worker. The shared free Worker uses only authentication/API requests; it does not perform browser audits.

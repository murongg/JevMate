# Deploy JevRepoTriage to Cloudflare

You need a Cloudflare account, permission to create/install a GitHub App, and a TypeSafe API key with Jev access. Choose public GitHub login with per-user keys, or legacy admin mode with one installation and a repository allowlist. The steps below bootstrap legacy mode; then follow [public GitHub login](#public-github-login) to enable accounts.

## 1. Install dependencies and authenticate

```sh
npm ci
npx wrangler login
```

## 2. Create storage and queues

```sh
npx wrangler d1 create jevrepotriage
npx wrangler queues create jevrepotriage-tasks
npx wrangler queues create jevrepotriage-dead
```

Copy the D1 `database_id` into `wrangler.jsonc`, replacing the zero UUID. If these names are already in use, choose your own and update all matching producer/consumer/database entries. The dead-letter queue has no consumer; exhausted tasks remain visible as failed jobs in the inbox. You can requeue a failed job there after fixing its cause.

When upgrading an existing deployment from the former JevMate branding, retain its current Worker name, D1 database and queue names. The new names above are defaults for fresh installations; changing resource names does not migrate stored data or secrets.

## 3. Set an admin token and deploy the initial endpoint

Generate a token locally:

```sh
openssl rand -hex 32
npx wrangler secret put ADMIN_TOKEN
npm run db:remote
npm run deploy
```

Paste the generated value into Wrangler's prompt, then keep it in your password manager. Do not put it in a URL, commit it, or pass it through a frontend environment variable.

The initial deployment can serve the inbox and `/health` before GitHub/Jev are configured. Copy the `https://jevrepotriage.<your-subdomain>.workers.dev` URL printed by Wrangler. Use your actual generated URL throughout the following steps.

## 4. Register a GitHub App

In GitHub's developer settings, create a GitHub App:

- Name: a unique name such as your own JevRepoTriage instance name.
- Homepage: your Worker URL.
- Webhook URL: `<worker-url>/webhooks/github`.
- Webhook secret: another random value (generate with `openssl rand -hex 32`).
- Repository permissions: **Issues: Read and write**. Metadata read access is supplied by GitHub. No Contents or Pull Requests access is required by this MVP.
- Subscribe to **Issues** events.
- Install the App on only the repositories you intend to manage.

Legacy mode does not require OAuth. For public GitHub login, configure the callback and client credentials described below.

Copy the App ID. Open the installation settings page and copy the installation ID from its URL. Generate and download the App private key.

## 5. Convert and store the App private key

JevRepoTriage uses Web Crypto via `jose` and expects **PKCS8** (`BEGIN PRIVATE KEY`). GitHub may download a PKCS1 (`BEGIN RSA PRIVATE KEY`) key; convert it locally:

```sh
openssl pkcs8 -topk8 -nocrypt -in /path/to/github-app.pem -out /path/to/jevrepotriage-pkcs8.pem
npx wrangler secret put GITHUB_PRIVATE_KEY < /path/to/jevrepotriage-pkcs8.pem
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put TYPESAFE_API_KEY
```

Enter the matching GitHub webhook secret and TypeSafe API key at their prompts. Never commit either PEM file. Do not copy the keys into the frontend.

## 6. Configure the installation and repository allowlist

Edit the `vars` section of `wrangler.jsonc`:

```json
{
  "GITHUB_APP_ID": "your-numeric-app-id",
  "GITHUB_INSTALLATION_ID": "your-numeric-installation-id",
  "ALLOWED_REPOS": "your-owner/your-repo,your-owner/another-repo",
  "JEV_MODEL": "jev-latest"
}
```

App/installation IDs and repository names are configuration, not credentials. An empty allowlist rejects all repository operations. The installation ID must match the signed webhook's installation. Pin a versioned model ID when you need controlled model upgrades; use a version your TypeSafe account supports.

Review `policy.json`. Every label you want to apply must already exist in the target repository. Create them manually in GitHub or map the policy to your existing labels. All listed repositories use the same taxonomy in v0.1.

```sh
npm run check
npm run deploy
```

## Public GitHub login

Apply all D1 migrations before enabling this mode. `0002.sql` adds separate account tables; it does not delete legacy jobs or history.

1. In the GitHub App **General** settings, set **Redirect URI** to `<worker-url>/auth/callback` with wildcard matching off. Set **Setup URL** to `<worker-url>/` so installation returns to the workspace.
2. In **Advanced**, make the App public so any account can install it. Keep Issues read/write and Metadata read; no additional repository permissions are needed. Login happens before installation, so OAuth during installation is optional and not required.
3. Copy the App **Client ID** (different from App ID), generate a **Client Secret**, and save them as Worker secrets. Generate a separate 32-byte hex encryption key locally and save it as `CREDENTIAL_KEY`.

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
openssl rand -hex 32
npx wrangler secret put CREDENTIAL_KEY
```

Set these non-secret variables in your Wrangler configuration:

```json
{
  "AUTH_MODE": "github",
  "APP_URL": "https://jevrepotriage.<your-subdomain>.workers.dev",
  "GITHUB_APP_ID": "your-numeric-app-id",
  "GITHUB_APP_SLUG": "your-app-slug",
  "DAILY_ANALYSIS_LIMIT": "200",
  "JEV_MODEL": "jev-latest"
}
```

`WEBHOOK_SECRET` must still match the App. In GitHub mode, `ADMIN_TOKEN`, `ALLOWED_REPOS`, `GITHUB_INSTALLATION_ID` and the platform `TYPESAFE_API_KEY` do not grant user access or fund new analyses. Existing legacy queue messages may finish using the old credentials. Retain them until that queue is drained. New jobs and label writes use the owning user’s GitHub token.

```sh
npm run check
npm run db:remote
npm run deploy
```

Sign in with GitHub, open **Account & repositories**, save your Jev key, install the App on selected repositories, refresh the repository list and connect a repository. Import an issue to verify analysis; applying labels remains an explicit action. Refreshing the page restores the session. Signing out clears that browser session. Removing the Jev key also pauses all that user’s connections; reconnect them after saving a new key.

Credentials are encrypted using AES-GCM with per-user context. Back up `CREDENTIAL_KEY` securely and keep it stable: replacing it without a data migration makes existing encrypted credentials unreadable. Secrets never belong in source control or frontend environment variables. Sessions use Secure/HttpOnly/SameSite cookies, CSRF tokens and seven-day expiration. OAuth uses PKCE and one-use browser-bound state. Revoking GitHub authorization invalidates sessions and pauses connections.

Every read/import/apply and background analysis checks current repository access with GitHub. Sharing an App installation does not share account history. Two users connecting the same repository each incur their own Jev calls. GitHub itself enforces the user’s ability to write labels. The policy remains deployment-wide.

Limits: 100 connected repositories per user, 60 API requests per user/minute, 10 OAuth starts per IP/minute, and 200 model evaluations per user/UTC day by default (`DAILY_ANALYSIS_LIMIT`, 1–10000). Cached decisions do not consume the daily quota. Repository discovery is bounded to 10 installation pages and 30 repository-list requests; unusually large installations receive an explicit error instead of silently exposing partial access. Cloudflare usage is still billed to the operator.

Legacy history stays in its original tables and is never assigned to the first GitHub user. Personal workspaces start empty; reconnect and import issues as needed. To roll back the login mode, set `AUTH_MODE` to `legacy` and redeploy; retain all account tables and the encryption secret. This preserves both histories without exposing personal data through the admin API.

Use HTTPS for production. For local OAuth, register an exact local callback and use the matching `APP_URL`; HTTPS local development is preferable for Secure cookies. Do not send production OAuth codes to a development origin.

## Smoke checks

1. Open `<worker-url>/health`; expect `{"ok":true,"service":"JevRepoTriage"}`. This checks the endpoint, not credentials.
2. Open the root page and enter your admin token. Confirm the repository dropdown matches your allowlist.
3. Use a test repository and create a synthetic issue. In the GitHub App's recent webhook deliveries, confirm a `202` response. The job should appear in JevRepoTriage after refreshing, followed by a suggestion. A `ping` returns `200`.
4. Read the original report and choose an existing label. Click **Confirm and add labels**. Confirm that it appears on GitHub and existing labels remain.
5. Create another synthetic issue, wait for analysis, then edit its body before applying the original suggestion. The stale suggestion must be rejected; refresh/import to inspect the new analysis.
6. If analysis fails, inspect the failed job and deployment secrets, then choose **Requeue**.

The model's probability calibration and usefulness require a separate evaluation on your task. These smoke checks only validate wiring and basic operations.

## Local development

Copy `.dev.vars.example` to `.dev.vars`. For real local API calls, use the same installation settings and real keys locally. JSON-escape line breaks in the PEM as `\n`; the adapter normalizes them. `.dev.vars` overrides Wrangler variables locally and is ignored by Git.

```sh
npm run db:local
npm run dev
```

For a UI-only preview with clearly synthetic records, see [local preview](preview.md). It does not call Jev or GitHub.

## Operations and limitations

- GitHub webhook responses wait for durable queue enqueue, not model completion. Failed enqueue returns `503`; use GitHub redelivery if needed. GitHub does not guarantee automatic retry for every failed webhook.
- Queues delivery is at least once. Completed jobs are deduplicated, and concurrent analysis is leased. A Worker crash may require waiting two minutes for the analysis lease to expire.
- Label writes preserve the originally approved label set after uncertain failures. Retry the same operation. Additive GitHub label writes are safe to repeat; arbitrary comments would not have this property and are intentionally absent.
- The write freshness check happens immediately before label validation/write. GitHub does not provide an atomic content-compare-and-label endpoint, so an edit during the final network gap is still possible.
- New webhook analyses fetch the latest issue content to reduce out-of-order event problems. Old snapshots remain in history and cannot apply after a content change.
- Historical import is explicit and limited to one 25-entry GitHub page. GitHub's results include PRs; JevRepoTriage filters them out. Changing repository data can move page boundaries; repeated snapshots are deduplicated.
- Importing is asynchronous; refresh the inbox after completion. Jobs exhausting queue retries can be requeued manually.
- Never share an admin token with someone who should not have access to every configured repository.
- This initial version does not include automated backups or data retention. Configure D1 backups/retention to match your deployment requirements.

## Official references

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [D1](https://developers.cloudflare.com/d1/)
- [Queues](https://developers.cloudflare.com/queues/)
- [GitHub webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- [GitHub App JWT authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
- [TypeSafe HTTP API](https://docs.typesafe.ai/api)

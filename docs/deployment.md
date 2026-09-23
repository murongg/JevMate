# Deploy JevMate to Cloudflare

You need a Cloudflare account, permission to create/install a GitHub App, and a TypeSafe API key with Jev access. Configure one GitHub installation per deployment. Multiple allowlisted repositories from that installation are supported.

## 1. Install dependencies and authenticate

```sh
npm ci
npx wrangler login
```

## 2. Create storage and queues

```sh
npx wrangler d1 create jevmate
npx wrangler queues create jevmate-tasks
npx wrangler queues create jevmate-dead
```

Copy the D1 `database_id` into `wrangler.jsonc`, replacing the zero UUID. If these names are already in use, choose your own and update all matching producer/consumer/database entries. The dead-letter queue has no consumer; exhausted tasks remain visible as failed jobs in the inbox. You can requeue a failed job there after fixing its cause.

## 3. Set an admin token and deploy the initial endpoint

Generate a token locally:

```sh
openssl rand -hex 32
npx wrangler secret put ADMIN_TOKEN
npm run db:remote
npm run deploy
```

Paste the generated value into Wrangler's prompt, then keep it in your password manager. Do not put it in a URL, commit it, or pass it through a frontend environment variable.

The initial deployment can serve the inbox and `/health` before GitHub/Jev are configured. Copy the `https://jevmate.<your-subdomain>.workers.dev` URL printed by Wrangler. Use your actual generated URL throughout the following steps.

## 4. Register a GitHub App

In GitHub's developer settings, create a GitHub App:

- Name: a unique name such as your own JevMate instance name.
- Homepage: your Worker URL.
- Webhook URL: `<worker-url>/webhooks/github`.
- Webhook secret: another random value (generate with `openssl rand -hex 32`).
- Repository permissions: **Issues: Read and write**. Metadata read access is supplied by GitHub. No Contents or Pull Requests access is required by this MVP.
- Subscribe to **Issues** events.
- Install the App on only the repositories you intend to manage.

No user OAuth callback is required: the MVP uses GitHub App installation credentials plus a separate admin token for its private inbox. It does not sign users into GitHub or create user access tokens.

Copy the App ID. Open the installation settings page and copy the installation ID from its URL. Generate and download the App private key.

## 5. Convert and store the App private key

JevMate uses Web Crypto via `jose` and expects **PKCS8** (`BEGIN PRIVATE KEY`). GitHub may download a PKCS1 (`BEGIN RSA PRIVATE KEY`) key; convert it locally:

```sh
openssl pkcs8 -topk8 -nocrypt -in /path/to/github-app.pem -out /path/to/jevmate-pkcs8.pem
npx wrangler secret put GITHUB_PRIVATE_KEY < /path/to/jevmate-pkcs8.pem
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

## Smoke checks

1. Open `<worker-url>/health`; expect `{"ok":true,"service":"JevMate"}`. This checks the endpoint, not credentials.
2. Open the root page and enter your admin token. Confirm the repository dropdown matches your allowlist.
3. Use a test repository and create a synthetic issue. In the GitHub App's recent webhook deliveries, confirm a `202` response. The job should appear in JevMate after refreshing, followed by a suggestion. A `ping` returns `200`.
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
- Historical import is explicit and limited to one 25-entry GitHub page. GitHub's results include PRs; JevMate filters them out. Changing repository data can move page boundaries; repeated snapshots are deduplicated.
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

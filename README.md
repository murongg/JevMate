# JevMate

A self-hosted GitHub issue triage assistant powered by **Jev**, built with React and Cloudflare Workers.

[中文文档](README.zh-CN.md) · [Deployment](docs/deployment.md) · [Contributing](CONTRIBUTING.md)

Jev suggests a category, module, and missing report details. You review the original issue, adjust the labels, and explicitly confirm before JevMate adds them to GitHub.

## What ships in v0.1

- Signed GitHub webhooks for opened, edited, and reopened issues.
- Cloudflare Queues processing, retries, and visible failed jobs.
- Jev Choice decisions plus independent completeness checks.
- React inbox with original text, model confidence, label selection, dismissal, and history.
- Import existing open issues, one GitHub page at a time (25 entries including PRs; PRs are skipped).
- Explicit repository allowlist and one GitHub App installation per deployment.
- Additive label updates, content freshness checks, and stable retry behavior after uncertain write failures.

This is an early MVP. There is no automatic commenting, issue closing, duplicate detection, PR review, user account system, or automatic labeling. The source is open; Jev is an external hosted model and requires your own API access. JevMate is an independent community project, not an official TypeSafe or GitHub product.

## Architecture

```text
GitHub App → Worker (signature verification) → Queues
                                                ↓
                           GitHub current issue → Jev → D1
                                                        ↑
React inbox → authenticated Worker API → review / apply labels
```

The frontend and API deploy together as one Worker with Static Assets. D1 stores issue snapshots, decisions, job states, and approved labels. A single admin token grants access to all repositories configured in that deployment; do not treat this as a multi-tenant service.

## Run locally

Requires Node.js 22.12+ (tested with Node 24), npm, and a Cloudflare account for deployment. Local development does not require a cloud deployment.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

Set a random `ADMIN_TOKEN` of at least 32 characters in `.dev.vars` to open the inbox at `http://localhost:8787`. A blank allowlist gives an empty inbox. Configure GitHub/Jev credentials before importing or analyzing real issues.

For React hot reload, keep the Worker running and use `npm run dev:web` in a second terminal; Vite proxies `/api` to port 8787.

## Deploy

Follow [the deployment guide](docs/deployment.md) to create a GitHub App, D1 database, queues and secrets. There is no hard-coded account, repository or API credential in this project.

```sh
npm run check
npm run db:remote
npm run deploy
```

These commands assume the resources and configuration have already been set up. Cloudflare and Jev usage may incur charges; no free-tier guarantee is made.

## Languages

The interface defaults to **English**, regardless of browser language. Use the language selector on the sign-in page or workspace header to switch between English and Simplified Chinese. An explicit choice is saved locally; if browser storage is unavailable, it lasts for the current page only.

Switching languages preserves your session and label selections. Issue content, repository names, custom policy names, and GitHub label identifiers are not translated. Page metadata, interface text, numbers, confidence values, and known error messages follow the selected language. Unknown server diagnostics remain intact for troubleshooting. See [localization](docs/localization.md) to add a language.

## Configure decisions

Edit [`policy.json`](policy.json), then rebuild/deploy:

- `categories`: named categories, descriptions, and an optional existing GitHub label.
- `modules`: repository areas; the default module labels are null until you map them to your own labels.
- `missingInfoLabel`: label suggested when a bug report lacks details.
- `missingBelow`: probability threshold for flagging missing details; this is a heuristic to evaluate on your own reports.

Keep `bug` as the bug category and `unknown` as the unknown module. Labels are never created automatically. Create `bug`, `enhancement`, `question`, `documentation`, and `needs-info` in your repositories, or change the policy to match existing labels. The initial policy is shared across the deployment's repositories.

Confidence is shown as reported by the model, not as an independently measured accuracy guarantee. Model outputs are validated before a suggestion is stored. Inputs over 16,000 characters are rejected rather than silently truncated.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

Tests use synthetic fixtures, mock external APIs, and a local Miniflare D1 database. They exercise webhook signing, queue failure/replay, decision validation, additive writes, stale content, approval recovery and frontend confirmation. They do not prove a live GitHub/Jev integration has been provisioned correctly. See [deployment smoke checks](docs/deployment.md#smoke-checks) after configuring real credentials.

## Data and access

Issue titles and bodies are sent to TypeSafe for analysis and stored in your D1 database. Private repositories need the same consideration as any other third-party model integration. API tokens and App keys stay in Worker secrets. The admin token is kept only in the current page's memory, not browser storage. Refreshing the page signs you out. Issue bodies render as plain text to prevent embedded HTML execution.

Revoking repository access or changing the allowlist stops new operations but does not delete stored records. Remove retained data deliberately if your retention policy requires it. The MVP has no automatic retention schedule.

## License

MIT. See [LICENSE](LICENSE).

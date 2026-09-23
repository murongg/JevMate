# Contributing to JevRepoTriage

Use Node.js 22.12+ and `npm ci`. Run `npm run check` before submitting a change.

- Write a failing test before changing behavior. Use synthetic fixtures only.
- Keep GitHub transport (`src/github.ts`), model decisions (`src/triage.ts`), job processing, and review actions separate.
- Preserve the manual approval boundary, signature checks, repository allowlist, additive label writes and freshness checks.
- Never render issue HTML directly, commit secrets, or include real private issue content in tests/logs.
- Keep interface copy in `web/locales/`. English defines the message keys; other catalogs must implement all keys. Do not translate issue text or GitHub label identifiers. See `docs/localization.md`.
- Document migration and configuration changes. Apply local D1 migrations when modifying the schema.
- Describe the concrete change and verification evidence in pull requests. Do not add fake adoption metrics or performance claims.

For a security issue, use the repository's private vulnerability reporting channel when enabled. Do not put credentials or private issue content in a public report. A dedicated security contact will be added when the repository is published.

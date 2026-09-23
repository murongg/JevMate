# Local UI preview

Use this only with a local database and synthetic data. It needs no GitHub/Jev key and makes no model calls.

1. Copy `.dev.vars.example` to `.dev.vars`. Set:

```dotenv
ADMIN_TOKEN="jevrepotriage-local-preview-token-not-for-production"
ALLOWED_REPOS="example/demo"
JEV_MODEL="synthetic-preview"
```

Leave GitHub and Jev credentials empty. Never use the example admin token in a public deployment.

2. Run:

```sh
npm run db:local
npx wrangler d1 execute DB --local --file scripts/preview.sql
npm run dev
```

3. Open `http://localhost:8787`, enter the synthetic preview token, and inspect the inbox. All sample titles are marked 演示 and their model is `synthetic-preview`.

You can test search, filters, detail navigation, label selection and dismissal locally. Applying labels or importing issues requires real credentials and will produce a configuration error in this preview. The external write path is covered with mocked GitHub responses in automated tests.

Reset only the sample rows when needed:

```sh
npx wrangler d1 execute DB --local --command "DELETE FROM analyses WHERE repo='example/demo'"
npx wrangler d1 execute DB --local --file scripts/preview.sql
```

Use your real `.dev.vars` values and allowlist when you move from preview to integration testing. `.dev.vars` and local D1 state are ignored by Git.

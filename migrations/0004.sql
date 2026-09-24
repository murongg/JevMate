CREATE TABLE pr_analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  files TEXT NOT NULL,
  decision TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  review_body TEXT,
  review_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX pr_analyses_repo_page ON pr_analyses(user_id,repo_id,created_at DESC,id DESC);

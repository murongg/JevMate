CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  credentials TEXT,
  credential_version INTEGER NOT NULL DEFAULT 0,
  refresh_lock INTEGER NOT NULL DEFAULT 0,
  jev_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE oauth_states (
  id TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE connections (
  user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(user_id,repo_id)
);
CREATE INDEX connections_event ON connections(installation_id,repo_id,enabled);
CREATE TABLE account_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX account_jobs_user ON account_jobs(user_id,created_at);
CREATE TABLE account_analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  decision TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  chosen TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX account_analyses_user ON account_analyses(user_id,created_at);
CREATE TABLE account_events (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  cursor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  lock_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE usage_limits (
  id TEXT PRIMARY KEY,
  used INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

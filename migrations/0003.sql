CREATE INDEX account_analyses_repo_page ON account_analyses(user_id,repo_id,created_at DESC,id DESC);
CREATE INDEX account_jobs_repo_page ON account_jobs(user_id,repo_id,status,created_at DESC);
CREATE INDEX analyses_repo_page ON analyses(repo,created_at DESC,id DESC);
CREATE INDEX jobs_repo_page ON jobs(repo,status,created_at DESC);

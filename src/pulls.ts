import { z } from 'zod';
import type { accountAccess } from './access';
import { jevKey } from './access';
import { GitHub } from './github';
import { consumeLimit, dailyLimit } from './limits';
import { evaluatePull, preparePullEvidence, type PullDecision } from './pull-triage';
import { HttpError, repository, type Env } from './schema';
import { hash } from './vault';

type Access = Awaited<ReturnType<typeof accountAccess>>;
interface PullAnalysis {
  id: string;
  user_id: string;
  repo_id: string;
  repo: string;
  number: number;
  head_sha: string;
  title: string;
  body: string;
  files: string;
  decision: string;
  status: 'pending' | 'publishing' | 'published' | 'stale';
  review_body: string | null;
  review_id: string | null;
  created_at: string;
}
function connectedRepo(access: Access, name: string) {
  const repo = access.connected.find((item) => item.name === repository.parse(name).toLowerCase());
  if (!repo) throw new HttpError(403, 'Connect an authorized repository before reviewing PRs.');
  return repo;
}
function view(row: PullAnalysis) {
  return {
    id: row.id,
    repo: row.repo,
    number: row.number,
    headSha: row.head_sha,
    title: row.title,
    body: row.body,
    files: JSON.parse(row.files) as {
      filename: string;
      status: string;
      additions: number;
      deletions: number;
    }[],
    decision: JSON.parse(row.decision) as PullDecision,
    status: row.status,
    reviewBody: row.review_body,
    reviewId: row.review_id,
    createdAt: row.created_at,
  };
}
async function ownedAnalysis(env: Env, userId: string, id: string, access: Access) {
  const row = await env.DB.prepare('SELECT * FROM pr_analyses WHERE id=? AND user_id=?')
    .bind(id, userId)
    .first<PullAnalysis>();
  if (!row) throw new HttpError(404, 'PR assessment not found.');
  const repo = access.connected.find((item) => item.id === row.repo_id);
  if (!repo) throw new HttpError(403, 'Repository access is no longer available.');
  return { row, repo };
}
export async function pullsApi(
  req: Request,
  env: Env,
  body: () => Promise<unknown>,
  userId: string,
  access: Access,
): Promise<Response> {
  const url = new URL(req.url);
  const github = new GitHub(env, access.token);
  if (url.pathname === '/api/pulls' && req.method === 'GET') {
    const repo = connectedRepo(access, url.searchParams.get('repo') || '');
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .parse(url.searchParams.get('page') || 1);
    const pulls = await github.pulls(repo.name, page);
    const rows = await env.DB.prepare(
      'SELECT id,number,head_sha,status FROM pr_analyses WHERE user_id=? AND repo_id=? AND number IN (SELECT value FROM json_each(?))',
    )
      .bind(userId, repo.id, JSON.stringify(pulls.map((pull) => pull.number)))
      .all<Pick<PullAnalysis, 'id' | 'number' | 'head_sha' | 'status'>>();
    return Response.json({
      page,
      items: pulls.map((pull) => {
        const analysis = rows.results.find(
          (row) => row.number === pull.number && row.head_sha === pull.head.sha,
        );
        return {
          number: pull.number,
          title: pull.title,
          body: pull.body || '',
          draft: pull.draft,
          headSha: pull.head.sha,
          analyzed: !!analysis,
          analysisId: analysis?.id || null,
          status: analysis?.status || null,
        };
      }),
    });
  }
  const analyze = url.pathname.match(/^\/api\/pulls\/([1-9]\d*)\/analyze$/);
  if (analyze && req.method === 'POST') {
    const input = z.object({ repo: repository }).parse(await body());
    const repo = connectedRepo(access, input.repo);
    const number = Number(analyze[1]);
    if (!Number.isSafeInteger(number)) throw new HttpError(400, 'Invalid PR number.');
    const pull = await github.pull(repo.name, number);
    if (pull.state !== 'open') throw new HttpError(409, 'This PR is no longer open.');
    const id = await hash(JSON.stringify([userId, repo.id, number, pull.head.sha]));
    const existing = await env.DB.prepare('SELECT * FROM pr_analyses WHERE id=? AND user_id=?')
      .bind(id, userId)
      .first<PullAnalysis>();
    if (existing) return Response.json(view(existing));
    const key = await jevKey(env, userId);
    if (pull.changed_files === undefined || pull.changed_files > 50)
      throw new HttpError(422, 'PR analysis supports 1 to 50 changed files.');
    const files = await github.pullFiles(repo.name, number);
    const evidence = preparePullEvidence(pull, files);
    const latest = await github.pull(repo.name, number);
    if (latest.state !== 'open' || latest.head.sha !== pull.head.sha)
      throw new HttpError(409, 'PR changed while its diff was loading. Analyze the latest commit.');
    await consumeLimit(env, 'analysis:' + userId, dailyLimit(env), 86400000);
    const decision = await evaluatePull(evidence, { ...env, TYPESAFE_API_KEY: key });
    const summary = files.map(({ filename, status, additions, deletions }) => ({
      filename,
      status,
      additions,
      deletions,
    }));
    await env.DB.prepare(
      'INSERT INTO pr_analyses(id,user_id,repo_id,repo,number,head_sha,title,body,files,decision) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    )
      .bind(
        id,
        userId,
        repo.id,
        repo.name,
        number,
        pull.head.sha,
        pull.title,
        pull.body || '',
        JSON.stringify(summary),
        JSON.stringify(decision),
      )
      .run();
    const row = await env.DB.prepare('SELECT * FROM pr_analyses WHERE id=? AND user_id=?')
      .bind(id, userId)
      .first<PullAnalysis>();
    return Response.json(view(row!));
  }
  const record = url.pathname.match(/^\/api\/pulls\/([A-Za-z0-9_-]{43})$/);
  if (record && req.method === 'GET') {
    const { row } = await ownedAnalysis(env, userId, record[1], access);
    return Response.json(view(row));
  }
  const publish = url.pathname.match(/^\/api\/pulls\/([A-Za-z0-9_-]{43})\/publish$/);
  if (publish && req.method === 'POST') {
    const input = z.object({ body: z.string().trim().min(1).max(5000) }).parse(await body());
    const { row, repo } = await ownedAnalysis(env, userId, publish[1], access);
    if (row.status !== 'pending')
      throw new HttpError(
        409,
        'This PR assessment is already published or requires manual verification.',
      );
    const current = await github.pull(repo.name, row.number);
    if (current.state !== 'open' || current.head.sha !== row.head_sha) {
      await env.DB.prepare("UPDATE pr_analyses SET status='stale' WHERE id=? AND status='pending'")
        .bind(row.id)
        .run();
      throw new HttpError(
        409,
        'PR changed since analysis. Analyze the latest commit before publishing.',
      );
    }
    const claim = await env.DB.prepare(
      "UPDATE pr_analyses SET status='publishing',review_body=? WHERE id=? AND user_id=? AND status='pending'",
    )
      .bind(input.body, row.id, userId)
      .run();
    if (!claim.meta.changes) throw new HttpError(409, 'PR review is already being published.');
    try {
      const reviewId = await github.reviewPull(
        repo.name,
        row.number,
        `${input.body}\n\n<!-- JevRepoTriage:${row.id} -->`,
      );
      await env.DB.prepare("UPDATE pr_analyses SET status='published',review_id=? WHERE id=?")
        .bind(reviewId, row.id)
        .run();
      return Response.json({ ok: true, reviewId });
    } catch (error) {
      if (error instanceof HttpError && error.status >= 400 && error.status < 500)
        await env.DB.prepare("UPDATE pr_analyses SET status='pending',review_body=NULL WHERE id=?")
          .bind(row.id)
          .run();
      // Unknown outcomes stay locked so a retry cannot create a duplicate GitHub review.
      throw error;
    }
  }
  throw new HttpError(404, 'Endpoint not found.');
}

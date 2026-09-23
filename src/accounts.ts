import { z } from 'zod';
import { HttpError, repository, type Env, type Analysis } from './schema';
import { requireSession } from './oauth';

import { seal } from './vault';
import { accountAccess, jevKey } from './access';
import type { AccessibleRepo } from './identity';
import { consumeLimit, dailyLimit } from './limits';
import { GitHub } from './github';
import { allowedLabels, policy } from './policy';
import { applyLabels } from './review';
import { queueAccountJob } from './account-jobs';
function installUrl(env: Env) {
  if (!/^[a-z0-9-]+$/.test(env.GITHUB_APP_SLUG || '')) return null;
  return `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`;
}
function visibleRepoIds(url: URL, connected: AccessibleRepo[]) {
  const requested = url.searchParams.get('repo');
  // Existing API clients may omit repo; the dashboard always sends it before pagination.
  if (requested === null) return connected.map((r) => r.id);
  const name = repository.parse(requested).toLowerCase();
  const match = connected.find((r) => r.name === name);
  if (!match) throw new HttpError(403, 'Repository access is no longer available.');
  return [match.id];
}
export async function accountsApi(
  req: Request,
  env: Env,
  body: () => Promise<unknown>,
): Promise<Response> {
  const session = await requireSession(req, env),
    url = new URL(req.url),
    userId = session.user_id;
  await consumeLimit(env, 'api:' + userId, 60, 60000);
  if (url.pathname === '/api/session' && req.method === 'GET')
    return Response.json({
      user: { id: userId, login: session.login },
      csrf: session.csrf,
      keyConfigured: !!session.jev_key,
      installUrl: installUrl(env),
      dailyLimit: dailyLimit(env),
    });
  if (url.pathname === '/api/account/key' && req.method === 'POST') {
    const input = z
      .object({
        key: z
          .string()
          .trim()
          .min(16)
          .max(512)
          .refine((v) => !/[\r\n]/.test(v)),
      })
      .parse(await body());
    const check = await fetch('https://api.typesafe.ai/v1/models', {
      headers: { Authorization: 'Bearer ' + input.key },
      signal: AbortSignal.timeout(15000),
    });
    if (!check.ok)
      throw new HttpError(
        check.status === 401 || check.status === 403 ? 400 : 502,
        'Jev key could not be verified. Check the key and try again.',
      );
    await env.DB.prepare('UPDATE accounts SET jev_key=? WHERE id=?')
      .bind(await seal(env.CREDENTIAL_KEY!, 'jev:' + userId, input.key), userId)
      .run();
    return Response.json({ ok: true, keyConfigured: true });
  }
  if (url.pathname === '/api/account/key/remove' && req.method === 'POST') {
    await env.DB.batch([
      env.DB.prepare('UPDATE accounts SET jev_key=NULL WHERE id=?').bind(userId),
      env.DB.prepare('UPDATE connections SET enabled=0 WHERE user_id=?').bind(userId),
    ]);
    return Response.json({ ok: true, keyConfigured: false });
  }
  if (url.pathname === '/api/connections/disconnect' && req.method === 'POST') {
    const input = z.object({ repoId: z.string().regex(/^\d+$/) }).parse(await body());
    await env.DB.prepare('UPDATE connections SET enabled=0 WHERE user_id=? AND repo_id=?')
      .bind(userId, input.repoId)
      .run();
    return Response.json({ ok: true });
  }
  const access = await accountAccess(env, userId),
    names = access.connected.map((r) => r.name),
    ids = access.connected.map((r) => r.id);
  if (url.pathname === '/api/config' && req.method === 'GET')
    return Response.json({
      repos: names,
      labels: allowedLabels(policy),
      model: env.JEV_MODEL || 'jev-latest',
    });
  if (url.pathname === '/api/connections' && req.method === 'GET')
    return Response.json({
      repositories: access.available.map((r) => ({ ...r, connected: ids.includes(r.id) })),
      installUrl: installUrl(env),
    });
  if (url.pathname === '/api/connections' && req.method === 'POST') {
    const input = z.object({ repoId: z.string().regex(/^\d+$/) }).parse(await body());
    const repo = access.available.find((r) => r.id === input.repoId);
    if (!repo)
      throw new HttpError(
        403,
        'This repository is not accessible to your GitHub account and this App.',
      );
    await jevKey(env, userId);
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM connections WHERE user_id=? AND enabled=1',
    )
      .bind(userId)
      .first<number>('n');
    if ((count || 0) >= 100 && !ids.includes(repo.id))
      throw new HttpError(409, 'A personal workspace supports up to 100 connected repositories.');
    await env.DB.prepare(
      'INSERT INTO connections(user_id,repo_id,installation_id,repo,enabled) VALUES(?,?,?,?,1) ON CONFLICT(user_id,repo_id) DO UPDATE SET installation_id=excluded.installation_id,repo=excluded.repo,enabled=1',
    )
      .bind(userId, repo.id, repo.installationId, repo.name)
      .run();
    return Response.json({ ok: true });
  }
  if (url.pathname === '/api/issues' && req.method === 'GET') {
    const scopedIds = visibleRepoIds(url, access.connected);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(url.searchParams.get('page') || 1);
    const rows = await env.DB.prepare(
      'SELECT * FROM account_analyses WHERE user_id=? AND repo_id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?',
    )
      .bind(userId, JSON.stringify(scopedIds), (page - 1) * 50)
      .all<Analysis & { repo_id: string }>();
    return Response.json({
      items: rows.results.map((r) => ({
        ...r,
        repo: access.connected.find((repo) => repo.id === r.repo_id)!.name,
        decision: JSON.parse(r.decision),
        chosen: r.chosen ? JSON.parse(r.chosen) : null,
      })),
      page,
    });
  }
  if (url.pathname === '/api/jobs' && req.method === 'GET') {
    const scopedIds = visibleRepoIds(url, access.connected);
    const rows = await env.DB.prepare(
      "SELECT * FROM account_jobs WHERE user_id=? AND repo_id IN (SELECT value FROM json_each(?)) AND status!='done' ORDER BY created_at DESC LIMIT 50",
    )
      .bind(userId, JSON.stringify(scopedIds))
      .all();
    return Response.json({
      items: rows.results.map((r) => ({
        ...r,
        repo: access.connected.find((repo) => repo.id === r.repo_id)!.name,
      })),
    });
  }
  if (url.pathname === '/api/scan' && req.method === 'POST') {
    const input = z
      .object({ repo: repository, page: z.number().int().min(1).max(1000).default(1) })
      .parse(await body());
    const repo = access.connected.find((r) => r.name === input.repo.toLowerCase());
    if (!repo)
      throw new HttpError(403, 'Connect an authorized repository before importing issues.');
    await jevKey(env, userId);
    const issues = await new GitHub(env, access.token).list(repo.name, input.page);
    for (const issue of issues)
      await queueAccountJob(env, `scan-${crypto.randomUUID()}`, userId, repo, issue.number);
    return Response.json({ queued: issues.length, page: input.page }, { status: 202 });
  }
  const retry = url.pathname.match(/^\/api\/jobs\/([\w-]+)\/retry$/);
  if (retry && req.method === 'POST') {
    const row = await env.DB.prepare('SELECT * FROM account_jobs WHERE id=? AND user_id=?')
      .bind(retry[1], userId)
      .first<{ repo_id: string; number: number }>();
    if (!row) throw new HttpError(404, 'Task not found.');
    const repo = access.connected.find((r) => r.id === row.repo_id);
    if (!repo) throw new HttpError(403, 'Repository access is no longer available.');
    await jevKey(env, userId);
    await queueAccountJob(env, retry[1], userId, repo, row.number);
    return Response.json({ queued: true }, { status: 202 });
  }
  const action = url.pathname.match(/^\/api\/issues\/([a-f0-9]{64})\/(apply|dismiss)$/);
  if (action && req.method === 'POST') {
    const row = await env.DB.prepare('SELECT * FROM account_analyses WHERE id=? AND user_id=?')
      .bind(action[1], userId)
      .first<Analysis & { repo_id: string }>();
    if (!row) throw new HttpError(404, 'Suggestion not found.');
    const repo = access.connected.find((r) => r.id === row.repo_id);
    if (!repo) throw new HttpError(403, 'Repository access is no longer available.');
    if (action[2] === 'apply') {
      const input = z
        .object({ labels: z.array(z.string().max(50)).min(1).max(20) })
        .parse(await body());
      await applyLabels(env, row.id, input.labels, {
        userId,
        repo,
        github: new GitHub(env, access.token),
      });
    } else {
      const change = await env.DB.prepare(
        "UPDATE account_analyses SET status='dismissed' WHERE id=? AND user_id=? AND status='pending'",
      )
        .bind(row.id, userId)
        .run();
      if (!change.meta.changes)
        throw new HttpError(409, 'Only pending suggestions can be dismissed.');
    }
    return Response.json({ ok: true });
  }
  throw new HttpError(404, 'Endpoint not found.');
}

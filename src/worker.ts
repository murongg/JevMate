import { z } from 'zod';
import { oauth } from './oauth';
import { accountsApi } from './accounts';
import { accountWebhook, processAccountJob, fanout } from './account-jobs';
import { authorized, verifyWebhook } from './auth';
import { GitHub } from './github';
import { enqueue, processJob } from './jobs';
import { allowedLabels, policy } from './policy';
import { applyLabels } from './review';
import {
  allowedRepos,
  assertRepo,
  HttpError,
  problem,
  repository,
  type Analysis,
  type Env,
  type Job,
} from './schema';

const event = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({ full_name: repository }),
  issue: z.object({ number: z.number().int().positive(), pull_request: z.unknown().optional() }),
});
async function readBody(req: Request, limit = 262144): Promise<string> {
  if (Number(req.headers.get('Content-Length')) > limit)
    throw new HttpError(413, 'Request is too large.');
  if (!req.body) return '';
  const reader = req.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new HttpError(413, 'Request is too large.');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}
async function jsonBody(req: Request): Promise<unknown> {
  try {
    return JSON.parse(await readBody(req, 8192));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON body.');
  }
}
async function webhook(req: Request, env: Env) {
  const raw = await readBody(req);
  if (!(await verifyWebhook(raw, req.headers.get('X-Hub-Signature-256'), env.WEBHOOK_SECRET)))
    throw new HttpError(401, 'Invalid webhook signature.');
  const kind = req.headers.get('X-GitHub-Event');
  if (kind === 'ping') return Response.json({ ok: true });
  if (env.AUTH_MODE !== 'github' && kind !== 'issues') return Response.json({ ignored: true });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid webhook JSON.');
  }
  if (env.AUTH_MODE === 'github')
    return accountWebhook(kind, payload, req.headers.get('X-GitHub-Delivery'), env);
  const input = event.parse(payload);
  if (String(input.installation.id) !== env.GITHUB_INSTALLATION_ID)
    throw new HttpError(403, 'Installation is not allowed.');
  assertRepo(env, input.repository.full_name);
  if (!['opened', 'edited', 'reopened'].includes(input.action) || input.issue.pull_request)
    return Response.json({ ignored: true });
  const delivery = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[\w-]+$/)
    .parse(req.headers.get('X-GitHub-Delivery'));
  await enqueue(env, `github-${delivery}`, input.repository.full_name, input.issue.number);
  return Response.json({ queued: true }, { status: 202 });
}
async function api(req: Request, env: Env, url: URL): Promise<Response> {
  if (env.AUTH_MODE === 'github') return accountsApi(req, env, () => jsonBody(req));
  if (!(await authorized(req, env.ADMIN_TOKEN)))
    throw new HttpError(401, 'Enter the deployment admin token.');
  const repos = allowedRepos(env);
  const requestedRepo = ['/api/issues', '/api/jobs'].includes(url.pathname)
    ? url.searchParams.get('repo')
    : null;
  const visibleRepos =
    requestedRepo === null ? repos : [repository.parse(requestedRepo).toLowerCase()];
  if (requestedRepo !== null && !repos.includes(visibleRepos[0]))
    throw new HttpError(403, 'Repository is not allowed by this deployment.');
  if (req.method === 'GET' && url.pathname === '/api/config')
    return Response.json({
      repos,
      labels: allowedLabels(policy),
      model: env.JEV_MODEL || 'jev-latest',
    });
  if (req.method === 'GET' && url.pathname === '/api/issues') {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(url.searchParams.get('page') || 1);
    if (!visibleRepos.length) return Response.json({ items: [], page });
    // Filter before LIMIT so retained snapshots from removed repositories cannot hide current ones.
    const result = await env.DB.prepare(
      `SELECT * FROM analyses WHERE repo IN (${visibleRepos.map(() => '?').join(',')}) ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?`,
    )
      .bind(...visibleRepos, (page - 1) * 50)
      .all<Analysis>();
    return Response.json({
      items: result.results
        .filter((row) => visibleRepos.includes(row.repo))
        .map((row) => ({
          ...row,
          decision: JSON.parse(row.decision),
          chosen: row.chosen ? JSON.parse(row.chosen) : null,
        })),
      page,
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/jobs') {
    if (!visibleRepos.length) return Response.json({ items: [] });
    const result = await env.DB.prepare(
      `SELECT * FROM jobs WHERE status!='done' AND repo IN (${visibleRepos.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(...visibleRepos)
      .all<Job>();
    return Response.json({
      items: result.results.filter((row) => visibleRepos.includes(row.repo)),
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/scan') {
    const input = z
      .object({ repo: repository, page: z.number().int().min(1).max(1000).default(1) })
      .parse(await jsonBody(req));
    assertRepo(env, input.repo);
    const issues = await new GitHub(env).list(input.repo, input.page);
    // Each page is an explicit action; do not fan out over an entire installation unexpectedly.
    for (const issue of issues)
      await enqueue(env, `scan-${crypto.randomUUID()}`, input.repo, issue.number);
    return Response.json({ queued: issues.length, page: input.page }, { status: 202 });
  }
  const retry = url.pathname.match(/^\/api\/jobs\/([\w-]+)\/retry$/);
  if (req.method === 'POST' && retry) {
    const job = await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(retry[1]).first<Job>();
    if (!job) throw new HttpError(404, 'Task not found.');
    assertRepo(env, job.repo);
    await enqueue(env, job.id, job.repo, job.number);
    return Response.json({ queued: true }, { status: 202 });
  }
  const match = url.pathname.match(/^\/api\/issues\/([a-f0-9]{64})\/(apply|dismiss)$/);
  if (req.method === 'POST' && match) {
    if (match[2] === 'apply') {
      const input = z
        .object({ labels: z.array(z.string().max(50)).min(1).max(20) })
        .parse(await jsonBody(req));
      await applyLabels(env, match[1], input.labels);
    } else {
      const row = await env.DB.prepare('SELECT * FROM analyses WHERE id=?')
        .bind(match[1])
        .first<Analysis>();
      if (!row) throw new HttpError(404, 'Suggestion not found.');
      assertRepo(env, row.repo);
      const changed = await env.DB.prepare(
        "UPDATE analyses SET status='dismissed' WHERE id=? AND status='pending'",
      )
        .bind(row.id)
        .run();
      if (!changed.meta.changes)
        throw new HttpError(409, 'Only pending suggestions can be dismissed.');
    }
    return Response.json({ ok: true });
  }
  throw new HttpError(404, 'Endpoint not found.');
}
function secure(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, headers });
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/auth/')) return secure(await oauth(req, env));
      if (url.pathname === '/health' && req.method === 'GET')
        return secure(Response.json({ ok: true, service: 'JevRepoTriage' }));
      if (url.pathname === '/webhooks/github' && req.method === 'POST')
        return secure(await webhook(req, env));
      if (url.pathname.startsWith('/api/')) return secure(await api(req, env, url));
      if (['GET', 'HEAD'].includes(req.method)) return secure(await env.ASSETS.fetch(req));
      return secure(Response.json({ error: 'Method not allowed.' }, { status: 405 }));
    } catch (error) {
      const status =
        error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500;
      const message = error instanceof z.ZodError ? 'Invalid request fields.' : problem(error);
      return secure(Response.json({ error: message }, { status }));
    }
  },
  async queue(
    batch: MessageBatch<{ id: string; kind?: 'account' | 'event' }>,
    env: Env,
  ): Promise<void> {
    for (const message of batch.messages) {
      try {
        if (message.body.kind === 'event') await fanout(env, message.body.id);
        else if (message.body.kind === 'account') await processAccountJob(env, message.body.id);
        else await processJob(env, message.body.id);
        message.ack();
      } catch {
        message.retry({ delaySeconds: Math.min(300, 30 * 2 ** Math.min(message.attempts, 3)) });
      }
    }
  },
};

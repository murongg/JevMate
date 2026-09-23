import { z } from 'zod';
import { GitHub } from './github';
import { accountAccess, jevKey, type Connection } from './access';
import { revoke, type AccessibleRepo } from './identity';
import { HttpError, problem, type Env } from './schema';
import { policy } from './policy';
import { evaluate, accountFingerprint } from './triage';
import { consumeLimit, dailyLimit } from './limits';
import { hash } from './vault';
export async function queueAccountJob(
  env: Env,
  id: string,
  userId: string,
  repo: AccessibleRepo,
  number: number,
) {
  await env.DB.prepare(
    'INSERT INTO account_jobs(id,user_id,repo_id,installation_id,repo,number) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
  )
    .bind(id, userId, repo.id, repo.installationId, repo.name, number)
    .run();
  const status = await env.DB.prepare('SELECT status FROM account_jobs WHERE id=? AND user_id=?')
    .bind(id, userId)
    .first<string>('status');
  if (status === 'done') return;
  await env.TASKS.send({ id, kind: 'account' });
}
export async function processAccountJob(env: Env, id: string) {
  const now = Date.now();
  const job = await env.DB.prepare(
    "UPDATE account_jobs SET status='processing',attempts=attempts+1,lock_until=? WHERE id=? AND status!='done' AND lock_until<=? RETURNING *",
  )
    .bind(now + 180000, id, now)
    .first<Connection & { id: string; number: number }>();
  if (!job) {
    const status = await env.DB.prepare('SELECT status FROM account_jobs WHERE id=?')
      .bind(id)
      .first<string>('status');
    if (status && status !== 'done') throw new HttpError(409, 'Task is already processing.');
    return;
  }
  try {
    const access = await accountAccess(env, job.user_id),
      repo = access.connected.find(
        (r) => r.id === job.repo_id && r.installationId === job.installation_id,
      );
    if (!repo) throw new HttpError(403, 'Repository access is no longer available.');
    const key = await jevKey(env, job.user_id);
    const issue = await new GitHub(env, access.token).issue(repo.name, job.number);
    if (issue.state === 'open' && !issue.pull_request) {
      const id = await accountFingerprint(
        job.user_id,
        repo.id,
        job.number,
        issue.title,
        issue.body || '',
      );
      const existing = await env.DB.prepare(
        'SELECT status FROM account_analyses WHERE id=? AND user_id=?',
      )
        .bind(id, job.user_id)
        .first<{ status: string }>();
      if (!existing || existing.status === 'stale') {
        await consumeLimit(env, 'analysis:' + job.user_id, dailyLimit(env), 86400000);
        const decision = await evaluate(issue, policy, { ...env, TYPESAFE_API_KEY: key });
        await env.DB.prepare(
          "INSERT INTO account_analyses(id,user_id,repo_id,repo,number,title,body,decision) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET decision=excluded.decision,repo=excluded.repo,status='pending',chosen=NULL,lock_until=0 WHERE account_analyses.status='stale'",
        )
          .bind(
            id,
            job.user_id,
            repo.id,
            repo.name,
            job.number,
            issue.title,
            issue.body || '',
            JSON.stringify(decision),
          )
          .run();
      }
    }
    await env.DB.prepare("UPDATE account_jobs SET status='done',error=NULL,lock_until=0 WHERE id=?")
      .bind(job.id)
      .run();
  } catch (error) {
    await env.DB.prepare("UPDATE account_jobs SET status='failed',error=?,lock_until=0 WHERE id=?")
      .bind(problem(error), job.id)
      .run();
    throw error;
  }
}
const numberId = z.number().int().positive();
export async function accountWebhook(
  kind: string | null,
  payload: unknown,
  delivery: string | null,
  env: Env,
) {
  if (kind === 'github_app_authorization') {
    const p = z
      .object({ action: z.literal('revoked'), sender: z.object({ id: numberId }) })
      .parse(payload);
    await revoke(env, String(p.sender.id));
    return Response.json({ ok: true });
  }
  if (kind === 'installation') {
    const p = z
      .object({ action: z.string(), installation: z.object({ id: numberId }) })
      .parse(payload);
    if (['deleted', 'suspend'].includes(p.action))
      await env.DB.prepare('UPDATE connections SET enabled=0 WHERE installation_id=?')
        .bind(String(p.installation.id))
        .run();
    return Response.json({ ok: true });
  }
  if (kind === 'installation_repositories') {
    const p = z
      .object({
        installation: z.object({ id: numberId }),
        repositories_removed: z.array(z.object({ id: numberId })).default([]),
      })
      .parse(payload);
    if (p.repositories_removed.length)
      await env.DB.prepare(
        'UPDATE connections SET enabled=0 WHERE installation_id=? AND repo_id IN (SELECT value FROM json_each(?))',
      )
        .bind(
          String(p.installation.id),
          JSON.stringify(p.repositories_removed.map((r) => String(r.id))),
        )
        .run();
    return Response.json({ ok: true });
  }
  if (kind !== 'issues') return Response.json({ ignored: true });
  const p = z
    .object({
      action: z.string(),
      installation: z.object({ id: numberId }),
      repository: z.object({ id: numberId, full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }),
      issue: z.object({ number: numberId, pull_request: z.unknown().optional() }),
    })
    .parse(payload);
  if (!['opened', 'edited', 'reopened'].includes(p.action) || p.issue.pull_request)
    return Response.json({ ignored: true });
  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM connections c JOIN accounts a ON a.id=c.user_id WHERE c.enabled=1 AND c.installation_id=? AND c.repo_id=? AND a.credentials IS NOT NULL AND a.jev_key IS NOT NULL',
  )
    .bind(String(p.installation.id), String(p.repository.id))
    .first<number>('n');
  if (!count) return Response.json({ ignored: true });
  const id =
    'event-' +
    z
      .string()
      .min(1)
      .max(128)
      .regex(/^[\w-]+$/)
      .parse(delivery);
  await env.DB.prepare(
    'INSERT INTO account_events(id,installation_id,repo_id,repo,number) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
  )
    .bind(
      id,
      String(p.installation.id),
      String(p.repository.id),
      p.repository.full_name.toLowerCase(),
      p.issue.number,
    )
    .run();
  await env.TASKS.send({ id, kind: 'event' });
  return Response.json({ queued: true }, { status: 202 });
}
export async function fanout(env: Env, id: string) {
  const now = Date.now();
  const event = await env.DB.prepare(
    "UPDATE account_events SET status='processing',lock_until=? WHERE id=? AND status!='done' AND lock_until<=? RETURNING *",
  )
    .bind(now + 120000, id, now)
    .first<{
      id: string;
      installation_id: string;
      repo_id: string;
      repo: string;
      number: number;
      cursor: string;
    }>();
  if (!event) {
    const status = await env.DB.prepare('SELECT status FROM account_events WHERE id=?')
      .bind(id)
      .first<string>('status');
    if (status && status !== 'done') throw new HttpError(409, 'Event is processing.');
    return;
  }
  try {
    const rows = await env.DB.prepare(
      'SELECT c.* FROM connections c JOIN accounts a ON a.id=c.user_id WHERE c.installation_id=? AND c.repo_id=? AND c.enabled=1 AND c.user_id>? AND a.credentials IS NOT NULL AND a.jev_key IS NOT NULL ORDER BY c.user_id LIMIT 50',
    )
      .bind(event.installation_id, event.repo_id, event.cursor)
      .all<Connection>();
    const jobs = await Promise.all(
      rows.results.map(async (c) => ({
        id: 'account-' + (await hash(event.id + ':' + c.user_id)),
        owner: c.user_id,
      })),
    );
    if (jobs.length) {
      await env.DB.batch(
        jobs.map((job) =>
          env.DB.prepare(
            'INSERT INTO account_jobs(id,user_id,installation_id,repo_id,repo,number) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
          ).bind(job.id, job.owner, event.installation_id, event.repo_id, event.repo, event.number),
        ),
      );
      // Advance the cursor only after durable enqueue; retries reuse the same per-user job IDs.
      await env.TASKS.sendBatch(
        jobs.map((job) => ({ body: { id: job.id, kind: 'account' as const } })),
      );
    }
    const done = rows.results.length < 50;
    await env.DB.prepare('UPDATE account_events SET status=?,cursor=?,lock_until=0 WHERE id=?')
      .bind(done ? 'done' : 'queued', rows.results.at(-1)?.user_id || event.cursor, id)
      .run();
    if (!done) await env.TASKS.send({ id, kind: 'event' });
  } catch (error) {
    await env.DB.prepare("UPDATE account_events SET status='failed',lock_until=0 WHERE id=?")
      .bind(id)
      .run();
    throw error;
  }
}

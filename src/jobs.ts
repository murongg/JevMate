import { GitHub } from './github';
import { policy } from './policy';
import { assertRepo, HttpError, problem, type Env, type Job } from './schema';
import { evaluate, fingerprint } from './triage';

export async function enqueue(env: Env, id: string, repo: string, number: number) {
  await env.DB.prepare('INSERT INTO jobs(id,repo,number) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING')
    .bind(id, repo.toLowerCase(), number)
    .run();
  const row = await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<Job>();
  if (!row || row.status === 'done') return;
  // Re-enqueue an unfinished delivery: a previous attempt may have committed D1 then failed to reach Queues.
  try {
    await env.TASKS.send({ id });
  } catch {
    throw new HttpError(503, 'Task could not be queued. Redeliver the webhook or retry this task.');
  }
}
export async function processJob(env: Env, id: string) {
  const now = Date.now();
  const job = await env.DB.prepare(
    "UPDATE jobs SET status='processing', attempts=attempts+1, lock_until=? WHERE id=? AND status!='done' AND lock_until<=? RETURNING *",
  )
    .bind(now + 120000, id, now)
    .first<Job>();
  if (!job) {
    const existing = await env.DB.prepare('SELECT status FROM jobs WHERE id=?')
      .bind(id)
      .first<{ status: string }>();
    if (existing && existing.status !== 'done')
      throw new HttpError(409, 'Task is already processing.');
    return;
  }
  try {
    assertRepo(env, job.repo);
    // Fetch current content instead of trusting potentially late or out-of-order event payloads.
    const issue = await new GitHub(env).issue(job.repo, job.number);
    if (issue.state === 'open' && !issue.pull_request) {
      const id = await fingerprint(job.repo, job.number, issue.title, issue.body || '');
      const exists = await env.DB.prepare('SELECT id,status FROM analyses WHERE id=?')
        .bind(id)
        .first();
      if (!exists || exists.status === 'stale') {
        const decision = await evaluate(issue, policy, env);
        await env.DB.prepare(
          "INSERT INTO analyses(id,repo,number,title,body,decision) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET decision=excluded.decision,status='pending',chosen=NULL,lock_until=0 WHERE analyses.status='stale'",
        )
          .bind(id, job.repo, job.number, issue.title, issue.body || '', JSON.stringify(decision))
          .run();
      }
    }
    await env.DB.prepare("UPDATE jobs SET status='done',error=NULL,lock_until=0 WHERE id=?")
      .bind(job.id)
      .run();
  } catch (error) {
    await env.DB.prepare("UPDATE jobs SET status='failed',error=?,lock_until=0 WHERE id=?")
      .bind(problem(error), job.id)
      .run();
    throw error;
  }
}

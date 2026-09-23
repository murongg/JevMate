import { GitHub } from './github';
import { allowedLabels, policy } from './policy';
import { assertRepo, HttpError, type Analysis, type Env } from './schema';
import { fingerprint, accountFingerprint } from './triage';
import type { AccessibleRepo } from './identity';

export async function applyLabels(
  env: Env,
  id: string,
  labels: string[],
  context?: { userId: string; repo: AccessibleRepo; github: GitHub },
) {
  const table = context ? 'account_analyses' : 'analyses';
  if (!labels.length || labels.some((label) => !allowedLabels(policy).includes(label)))
    throw new HttpError(400, 'Select at least one configured label.');
  const chosen = JSON.stringify([...new Set(labels)].sort());
  const row = context
    ? await env.DB.prepare('SELECT * FROM account_analyses WHERE id=? AND user_id=? AND repo_id=?')
        .bind(id, context.userId, context.repo.id)
        .first<Analysis>()
    : await env.DB.prepare('SELECT * FROM analyses WHERE id=?').bind(id).first<Analysis>();
  if (!row) throw new HttpError(404, 'Suggestion not found.');
  if (!context) assertRepo(env, row.repo);
  const repoName = context?.repo.name || row.repo;
  if (row.status === 'applied') {
    if (row.chosen !== chosen) throw new HttpError(409, 'Different labels were already applied.');
    return;
  }
  if (row.status !== 'pending' && row.status !== 'applying')
    throw new HttpError(409, 'This suggestion is no longer actionable.');
  if (row.status === 'applying' && row.chosen !== chosen)
    throw new HttpError(
      409,
      'Retry the original approved labels; the previous GitHub request may have succeeded.',
    );
  const now = Date.now();
  const locked = await env.DB.prepare(
    `UPDATE ${table} SET status='applying',chosen=?,lock_until=? WHERE id=? AND (status='pending' OR (status='applying' AND chosen=? AND lock_until<=?)) RETURNING id`,
  )
    .bind(chosen, now + 300000, id, chosen, now)
    .first();
  if (!locked)
    throw new HttpError(409, 'Another label operation is running. Retry in five minutes.');
  try {
    const github = context?.github || new GitHub(env);
    const current = await github.issue(repoName, row.number);
    if (
      current.state !== 'open' ||
      current.pull_request ||
      (context
        ? await accountFingerprint(
            context.userId,
            context.repo.id,
            row.number,
            current.title,
            current.body || '',
          )
        : await fingerprint(row.repo, row.number, current.title, current.body || '')) !== row.id
    ) {
      await env.DB.prepare(`UPDATE ${table} SET status='stale',lock_until=0 WHERE id=?`)
        .bind(id)
        .run();
      throw new HttpError(
        409,
        'Issue changed or closed. Import it again to review current content.',
      );
    }
    const existing = await github.labels(repoName);
    if (labels.some((label) => !existing.includes(label))) {
      await env.DB.prepare(
        `UPDATE ${table} SET status='pending',chosen=NULL,lock_until=0 WHERE id=?`,
      )
        .bind(id)
        .run();
      throw new HttpError(
        422,
        'A selected label does not exist in GitHub. Create it or update policy.json.',
      );
    }
    await github.addLabels(repoName, row.number, JSON.parse(chosen));
    await env.DB.prepare(`UPDATE ${table} SET status='applied',lock_until=0 WHERE id=?`)
      .bind(id)
      .run();
  } catch (error) {
    // Preserve chosen labels after uncertain network outcomes. Repeating the same additive POST is idempotent.
    await env.DB.prepare(`UPDATE ${table} SET lock_until=0 WHERE id=?`).bind(id).run();
    throw error;
  }
}

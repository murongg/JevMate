import { GitHub } from './github';
import { allowedLabels, policy } from './policy';
import { assertRepo, HttpError, type Analysis, type Env } from './schema';
import { fingerprint } from './triage';

export async function applyLabels(env: Env, id: string, labels: string[]) {
  if (!labels.length || labels.some((label) => !allowedLabels(policy).includes(label)))
    throw new HttpError(400, 'Select at least one configured label.');
  const chosen = JSON.stringify([...new Set(labels)].sort());
  const row = await env.DB.prepare('SELECT * FROM analyses WHERE id=?').bind(id).first<Analysis>();
  if (!row) throw new HttpError(404, 'Suggestion not found.');
  assertRepo(env, row.repo);
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
    "UPDATE analyses SET status='applying',chosen=?,lock_until=? WHERE id=? AND (status='pending' OR (status='applying' AND chosen=? AND lock_until<=?)) RETURNING id",
  )
    .bind(chosen, now + 300000, id, chosen, now)
    .first();
  if (!locked)
    throw new HttpError(409, 'Another label operation is running. Retry in five minutes.');
  try {
    const github = new GitHub(env);
    const current = await github.issue(row.repo, row.number);
    if (
      current.state !== 'open' ||
      current.pull_request ||
      (await fingerprint(row.repo, row.number, current.title, current.body || '')) !== row.id
    ) {
      await env.DB.prepare("UPDATE analyses SET status='stale',lock_until=0 WHERE id=?")
        .bind(id)
        .run();
      throw new HttpError(
        409,
        'Issue changed or closed. Import it again to review current content.',
      );
    }
    const existing = await github.labels(row.repo);
    if (labels.some((label) => !existing.includes(label))) {
      await env.DB.prepare(
        "UPDATE analyses SET status='pending',chosen=NULL,lock_until=0 WHERE id=?",
      )
        .bind(id)
        .run();
      throw new HttpError(
        422,
        'A selected label does not exist in GitHub. Create it or update policy.json.',
      );
    }
    await github.addLabels(row.repo, row.number, JSON.parse(chosen));
    await env.DB.prepare("UPDATE analyses SET status='applied',lock_until=0 WHERE id=?")
      .bind(id)
      .run();
  } catch (error) {
    // Preserve chosen labels after uncertain network outcomes. Repeating the same additive POST is idempotent.
    await env.DB.prepare('UPDATE analyses SET lock_until=0 WHERE id=?').bind(id).run();
    throw error;
  }
}

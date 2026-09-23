import { HttpError, type Env } from './schema';
import { accessibleRepos, accountToken } from './identity';
import { unseal } from './vault';
export interface Connection {
  user_id: string;
  repo_id: string;
  installation_id: string;
  repo: string;
  enabled: number;
}
export async function accountAccess(env: Env, userId: string) {
  const token = await accountToken(env, userId),
    available = await accessibleRepos(env, token);
  const rows = await env.DB.prepare('SELECT * FROM connections WHERE user_id=? AND enabled=1')
    .bind(userId)
    .all<Connection>();
  const connected = available.filter((repo) =>
    rows.results.some((c) => c.repo_id === repo.id && c.installation_id === repo.installationId),
  );
  return { token, available, connected };
}
export async function jevKey(env: Env, userId: string) {
  const value = await env.DB.prepare('SELECT jev_key FROM accounts WHERE id=?')
    .bind(userId)
    .first<string>('jev_key');
  if (!value) throw new HttpError(409, 'Add your own Jev API key in Account settings first.');
  return unseal(env.CREDENTIAL_KEY!, 'jev:' + userId, value);
}

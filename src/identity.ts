import { z } from 'zod';
import { HttpError, repository, type Env } from './schema';
import { seal, unseal } from './vault';
export interface Account {
  id: string;
  login: string;
  credentials: string | null;
  credential_version: number;
  refresh_lock: number;
  jev_key: string | null;
}
export interface Credentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  refreshExpiresAt: number;
}
const oauthResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive().optional(),
  refresh_token_expires_in: z.number().positive().optional(),
});
export async function exchange(env: Env, fields: Record<string, string>): Promise<Credentials> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID!,
      client_secret: env.GITHUB_CLIENT_SECRET!,
      ...fields,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new HttpError(502, 'GitHub authorization is unavailable. Try again.');
  const raw = (await res.json()) as Record<string, unknown>;
  if (raw.error) throw new HttpError(401, 'GitHub authorization expired. Sign in again.');
  const data = oauthResponse.parse(raw),
    now = Date.now();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    // GitHub can disable token expiration; preserve that setting without serializing Infinity.
    expiresAt: data.expires_in ? now + data.expires_in * 1000 : Number.MAX_SAFE_INTEGER,
    refreshExpiresAt: now + (data.refresh_token_expires_in || 0) * 1000,
  };
}
export async function revoke(env: Env, userId: string, version?: number) {
  const update =
    version === undefined
      ? env.DB.prepare(
          'UPDATE accounts SET credentials=NULL,credential_version=credential_version+1,refresh_lock=0 WHERE id=?',
        ).bind(userId)
      : env.DB.prepare(
          'UPDATE accounts SET credentials=NULL,credential_version=credential_version+1,refresh_lock=0 WHERE id=? AND credential_version=?',
        ).bind(userId, version);
  await env.DB.batch([
    update,
    env.DB.prepare(
      'DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND credentials IS NULL)',
    ).bind(userId, userId),
    env.DB.prepare(
      'UPDATE connections SET enabled=0 WHERE user_id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND credentials IS NULL)',
    ).bind(userId, userId),
  ]);
}
export async function accountToken(env: Env, userId: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const account = await env.DB.prepare('SELECT * FROM accounts WHERE id=?')
      .bind(userId)
      .first<Account>();
    if (!account?.credentials)
      throw new HttpError(401, 'GitHub authorization expired. Sign in again.');
    const creds = JSON.parse(
      await unseal(env.CREDENTIAL_KEY!, 'github:' + userId, account.credentials),
    ) as Credentials;
    if (creds.expiresAt > Date.now() + 60000) return creds.accessToken;
    if (!creds.refreshToken || creds.refreshExpiresAt <= Date.now()) {
      await revoke(env, userId, account.credential_version);
      throw new HttpError(401, 'GitHub authorization expired. Sign in again.');
    }
    const claim = await env.DB.prepare(
      'UPDATE accounts SET refresh_lock=? WHERE id=? AND credential_version=? AND refresh_lock<? RETURNING id',
    )
      .bind(Date.now() + 30000, userId, account.credential_version, Date.now())
      .first();
    if (!claim) {
      // A workspace loads several endpoints at once; allow the owner’s 15-second refresh to finish.
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 250 * 2 ** attempt)));
      continue;
    }
    try {
      const refreshed = await exchange(env, {
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
      });
      // Compare-and-swap prevents an in-flight refresh from restoring credentials after revocation or a newer login.
      const saved = await env.DB.prepare(
        'UPDATE accounts SET credentials=?,credential_version=credential_version+1,refresh_lock=0 WHERE id=? AND credential_version=?',
      )
        .bind(
          await seal(env.CREDENTIAL_KEY!, 'github:' + userId, JSON.stringify(refreshed)),
          userId,
          account.credential_version,
        )
        .run();
      if (!saved.meta.changes)
        throw new HttpError(409, 'GitHub authorization changed. Refresh and retry.');
      return refreshed.accessToken;
    } catch (error) {
      await env.DB.prepare('UPDATE accounts SET refresh_lock=0 WHERE id=? AND credential_version=?')
        .bind(userId, account.credential_version)
        .run();
      if (error instanceof HttpError && error.status === 401)
        await revoke(env, userId, account.credential_version);
      throw error;
    }
  }
  throw new HttpError(503, 'GitHub authorization is refreshing. Please retry shortly.');
}
export async function userRequest(token: string, path: string): Promise<unknown> {
  const res = await fetch('https://api.github.com' + path, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'JevMate',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) throw new HttpError(401, 'GitHub authorization expired. Sign in again.');
  if (!res.ok)
    throw new HttpError(
      502,
      `GitHub returned HTTP ${res.status}. Check installation permissions, rate limits and repository access.`,
    );
  return res.json();
}
export interface AccessibleRepo {
  id: string;
  installationId: string;
  name: string;
}
const installationPage = z.object({
  installations: z.array(
    z.object({
      id: z.number().int().positive(),
      app_id: z.number().int().positive(),
      suspended_at: z.string().nullable().optional(),
    }),
  ),
});
const repoPage = z.object({
  repositories: z.array(z.object({ id: z.number().int().positive(), full_name: repository })),
});
export async function accessibleRepos(env: Env, token: string): Promise<AccessibleRepo[]> {
  const installs: { id: number }[] = [];
  for (let page = 1; page <= 10; page++) {
    const data = installationPage.parse(
      await userRequest(token, `/user/installations?per_page=100&page=${page}`),
    );
    installs.push(
      ...data.installations.filter(
        (x) => String(x.app_id) === env.GITHUB_APP_ID && !x.suspended_at,
      ),
    );
    if (data.installations.length < 100) break;
    if (page === 10)
      throw new HttpError(422, 'Too many installations to list safely. Contact the operator.');
  }
  const repos: AccessibleRepo[] = [];
  let requests = 0;
  for (const installation of installs) {
    for (let page = 1; page <= 20; page++) {
      if (++requests > 30)
        throw new HttpError(422, 'Too many repositories to list safely. Contact the operator.');
      const data = repoPage.parse(
        await userRequest(
          token,
          `/user/installations/${installation.id}/repositories?per_page=100&page=${page}`,
        ),
      );
      repos.push(
        ...data.repositories.map((r) => ({
          id: String(r.id),
          installationId: String(installation.id),
          name: r.full_name.toLowerCase(),
        })),
      );
      if (data.repositories.length < 100) break;
      if (page === 20)
        throw new HttpError(422, 'Too many repositories to list safely. Contact the operator.');
    }
  }
  return repos;
}

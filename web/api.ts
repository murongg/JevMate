import type { Call, Config, Review, Snapshot } from './types';
import type { Job } from '../src/schema';
export function client(token: string, csrf?: string): Call {
  return async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrf && body !== undefined ? { 'X-CSRF-Token': csrf } : {}),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(
        data && typeof data === 'object' && 'error' in data
          ? String(data.error)
          : `Request failed (${res.status}).`,
      );
    return data as T;
  };
}
export async function snapshot(call: Call, page: number, preferredRepo = ''): Promise<Snapshot> {
  const config = await call<Config>('/api/config');
  const repo = config.repos.includes(preferredRepo) ? preferredRepo : config.repos[0] || '';
  if (!repo) return { config, repo, items: [], jobs: [], page: 1 };
  const currentPage = repo === preferredRepo ? page : 1;
  const scope = encodeURIComponent(repo);
  // Scope on the server before LIMIT/OFFSET so a busy repository cannot hide another one's records.
  const [issues, jobs] = await Promise.all([
    call<{ items: Review[]; page: number }>(`/api/issues?page=${currentPage}&repo=${scope}`),
    call<{ items: Job[] }>(`/api/jobs?repo=${scope}`),
  ]);
  return { config, repo, items: issues.items, jobs: jobs.items, page: currentPage };
}

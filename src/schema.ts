import { z } from 'zod';

export interface Env {
  DB: D1Database;
  TASKS: Queue<{ id: string; kind?: 'account' | 'event' }>;
  ASSETS: Fetcher;
  ADMIN_TOKEN: string;
  WEBHOOK_SECRET: string;
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_PRIVATE_KEY: string;
  ALLOWED_REPOS: string;
  TYPESAFE_API_KEY: string;
  JEV_MODEL: string;
  AUTH_MODE?: 'legacy' | 'github';
  APP_URL?: string;
  APP_LEGACY_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_APP_SLUG?: string;
  CREDENTIAL_KEY?: string;
  DAILY_ANALYSIS_LIMIT?: string;
}
export const repository = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .max(200);
export const githubIssue = z.object({
  number: z.number().int().positive(),
  title: z.string().max(1000),
  body: z.string().nullable(),
  state: z.enum(['open', 'closed']),
  pull_request: z.unknown().optional(),
  labels: z.array(z.object({ name: z.string() })).default([]),
});
export type Issue = z.infer<typeof githubIssue>;
export interface Job {
  id: string;
  repo: string;
  number: number;
  status: string;
  attempts: number;
  error: string | null;
  lock_until: number;
}
export interface Analysis {
  id: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  decision: string;
  status: 'pending' | 'applying' | 'applied' | 'dismissed' | 'stale';
  chosen: string | null;
  lock_until: number;
  created_at: string;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function allowedRepos(env: Env): string[] {
  return (env.ALLOWED_REPOS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => repository.parse(s));
}
export function assertRepo(env: Env, repo: string) {
  if (!allowedRepos(env).includes(repo.toLowerCase()))
    throw new HttpError(403, 'Repository is not allowed by this deployment.');
}
export function problem(error: unknown): string {
  return error instanceof HttpError
    ? error.message
    : 'Operation failed. Check deployment configuration and retry.';
}

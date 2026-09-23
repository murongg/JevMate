import type { Analysis, Job } from '../src/schema';
import type { Decision } from '../src/triage';
export type Review = Omit<Analysis, 'decision' | 'chosen'> & {
  decision: Decision;
  chosen: string[] | null;
};
export interface Config {
  repos: string[];
  labels: string[];
  model: string;
}
export interface Snapshot {
  config: Config;
  repo: string;
  items: Review[];
  jobs: Job[];
  page: number;
}
export type Call = <T>(path: string, body?: unknown) => Promise<T>;

export interface UserSession {
  user: { id: string; login: string };
  csrf: string;
  keyConfigured: boolean;
  installUrl: string | null;
  dailyLimit: number;
}
export interface ConnectedRepository {
  id: string;
  installationId: string;
  name: string;
  connected: boolean;
}

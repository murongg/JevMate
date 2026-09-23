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
  items: Review[];
  jobs: Job[];
  page: number;
}
export type Call = <T>(path: string, body?: unknown) => Promise<T>;

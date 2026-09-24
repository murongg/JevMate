import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import { githubIssue, HttpError, type Env, type Issue } from './schema';

const pull = z.object({
  number: z.number().int().positive(),
  title: z.string().max(1000),
  body: z.string().nullable(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean().default(false),
  head: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
  changed_files: z.number().int().nonnegative().optional(),
});
const pullFile = z.object({
  filename: z.string().min(1).max(1000),
  status: z.string().max(50),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().optional(),
});
export type Pull = z.infer<typeof pull>;
export type PullFile = z.infer<typeof pullFile>;

export class GitHub {
  private token?: string;
  constructor(
    private env: Env,
    private userToken?: string,
  ) {}
  private async installationToken(): Promise<string> {
    if (this.userToken) return this.userToken;
    if (this.token) return this.token;
    if (
      !/^\d+$/.test(this.env.GITHUB_INSTALLATION_ID) ||
      !this.env.GITHUB_PRIVATE_KEY ||
      !this.env.GITHUB_APP_ID
    )
      throw new HttpError(
        503,
        'Configure the GitHub App ID, installation ID and PKCS8 private key.',
      );
    const pem = this.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');
    const key = await importPKCS8(pem, 'RS256');
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(this.env.GITHUB_APP_ID)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 540)
      .sign(key);
    const res = await fetch(
      `https://api.github.com/app/installations/${this.env.GITHUB_INSTALLATION_ID}/access_tokens`,
      {
        method: 'POST',
        headers: this.headers(jwt),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) throw new HttpError(502, `GitHub App authentication returned HTTP ${res.status}.`);
    this.token = z.object({ token: z.string().min(1) }).parse(await res.json()).token;
    return this.token;
  }
  private headers(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'JevRepoTriage',
      'Content-Type': 'application/json',
    };
  }
  private async request(path: string, body?: unknown): Promise<unknown> {
    const token = await this.installationToken();
    const res = await fetch(`https://api.github.com${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: this.headers(token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok)
      throw new HttpError(
        502,
        `GitHub returned HTTP ${res.status}. Check installation permissions, rate limits and repository access.`,
      );
    return res.json();
  }
  async issue(repo: string, number: number): Promise<Issue> {
    return githubIssue.parse(await this.request(`/repos/${repo}/issues/${number}`));
  }
  async list(repo: string, page: number): Promise<{ number: number }[]> {
    const rows = z
      .array(
        z.object({ number: z.number().int().positive(), pull_request: z.unknown().optional() }),
      )
      .parse(
        await this.request(
          `/repos/${repo}/issues?state=open&per_page=25&page=${page}&sort=created&direction=desc`,
        ),
      );
    return rows.filter((row) => !row.pull_request);
  }
  async labels(repo: string): Promise<string[]> {
    const names: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const rows = z
        .array(z.object({ name: z.string() }))
        .parse(await this.request(`/repos/${repo}/labels?per_page=100&page=${page}`));
      names.push(...rows.map((v) => v.name));
      if (rows.length < 100) return names;
    }
    throw new HttpError(422, 'Repository exceeds the supported 1,000-label limit.');
  }
  async addLabels(repo: string, number: number, labels: string[]) {
    // POST adds labels; PUT would replace labels already set by maintainers.
    await this.request(`/repos/${repo}/issues/${number}/labels`, { labels });
  }
  async pulls(repo: string, page: number): Promise<Pull[]> {
    return z
      .array(pull)
      .parse(
        await this.request(
          `/repos/${repo}/pulls?state=open&per_page=25&page=${page}&sort=updated&direction=desc`,
        ),
      );
  }
  async pull(repo: string, number: number): Promise<Pull> {
    return pull.parse(await this.request(`/repos/${repo}/pulls/${number}`));
  }
  async pullFiles(repo: string, number: number): Promise<PullFile[]> {
    return z
      .array(pullFile)
      .parse(await this.request(`/repos/${repo}/pulls/${number}/files?per_page=100&page=1`));
  }
  async reviewPull(repo: string, number: number, body: string): Promise<string> {
    if (!this.userToken) throw new HttpError(503, 'GitHub user authorization is required.');
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}/reviews`, {
      method: 'POST',
      headers: this.headers(this.userToken),
      body: JSON.stringify({ event: 'COMMENT', body }),
      signal: AbortSignal.timeout(15000),
    });
    // A rejected 4xx request cannot have created a review; 5xx/network failures are uncertain.
    if (!res.ok)
      throw new HttpError(
        res.status >= 400 && res.status < 500 && res.status !== 429 ? res.status : 502,
        `GitHub review submission returned HTTP ${res.status}. Check Pull requests permissions.`,
      );
    const response = z.object({ id: z.number().int().positive() }).parse(await res.json());
    return String(response.id);
  }
}

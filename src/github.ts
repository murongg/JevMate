import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import { githubIssue, HttpError, type Env, type Issue } from './schema';

export class GitHub {
  private token?: string;
  constructor(private env: Env) {}
  private async installationToken(): Promise<string> {
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
      'User-Agent': 'JevMate',
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
}

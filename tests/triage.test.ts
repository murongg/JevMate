import { describe, expect, it } from 'vitest';
import { buildQuestions, parseDecision, fingerprint } from '../src/triage';
import { policy } from '../src/policy';

import { result } from './fixtures';

describe('typed triage decisions', () => {
  it('uses constrained criteria and independent completeness questions', () => {
    const q = buildQuestions(policy);
    expect(q.category.type).toBe('choice');
    expect(Object.keys(q.category.criteria)).toEqual(Object.keys(policy.categories));
    expect(q.reproduction.type).toBe('noul');
  });
  it('suggests missing-info only for bugs and preserves actual model and usage', () => {
    const decision = parseDecision(result(), policy);
    expect(decision.labels).toEqual(['bug', 'needs-info']);
    expect(decision.missing).toEqual(['reproduction']);
    expect(decision.model).toBe('jev-test');
    expect(decision.inputTokens).toBe(100);
    const other = result();
    other.answers.category.choice = 'enhancement';
    expect(parseDecision(other, policy).labels).toEqual(['enhancement']);
  });
  it('rejects invented options, missing distributions and invalid probabilities', () => {
    const invalid = result();
    invalid.answers.category.choice = 'admin';
    expect(() => parseDecision(invalid, policy)).toThrow();
    const bad = result();
    bad.answers.version.noul = 1.5;
    expect(() => parseDecision(bad, policy)).toThrow();
    const sum = result();
    sum.answers.category.probabilities.bug = 0.1;
    expect(() => parseDecision(sum, policy)).toThrow();
  });
  it('fingerprints content rather than timestamps changed by adding labels', async () => {
    expect(await fingerprint('example/repo', 1, 'title', 'body')).toBe(
      await fingerprint('example/repo', 1, 'title', 'body'),
    );
    expect(await fingerprint('example/repo', 1, 'title', 'body')).not.toBe(
      await fingerprint('example/repo', 1, 'title', 'edited'),
    );
  });
});

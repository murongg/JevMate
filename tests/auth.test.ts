import { expect, it } from 'vitest';
import { verifyWebhook, authorized } from '../src/auth';

import { signature } from './fixtures';

it('verifies raw webhook bytes and rejects tampering or missing signatures', async () => {
  const body = '{"example":true}';
  expect(await verifyWebhook(body, await signature(body), 'synthetic-secret')).toBe(true);
  expect(await verifyWebhook(body + ' ', await signature(body), 'synthetic-secret')).toBe(false);
  expect(await verifyWebhook(body, null, 'synthetic-secret')).toBe(false);
  expect(await verifyWebhook(body, 'sha256=xyz', 'synthetic-secret')).toBe(false);
});
it('fails closed without a strong admin token and rejects cross-origin mutations', async () => {
  const token = 'synthetic-admin-token-that-is-long-enough';
  const req = (origin?: string) =>
    new Request('https://example.test/api/scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) },
    });
  expect(await authorized(req(), token)).toBe(true);
  expect(await authorized(req('https://attacker.test'), token)).toBe(false);
  expect(await authorized(req(), '')).toBe(false);
  expect(await authorized(new Request('https://example.test/api/issues'), token)).toBe(false);
});

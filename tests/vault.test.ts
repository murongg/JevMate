import { expect, it } from 'vitest';
import { seal, unseal } from '../src/vault';
const key = '11'.repeat(32);
it('encrypts credentials with per-purpose context and rejects tampering', async () => {
  const secret = 'synthetic-provider-key';
  const cipher = await seal(key, 'account:101', secret);
  expect(cipher).not.toContain(secret);
  expect(await unseal(key, 'account:101', cipher)).toBe(secret);
  await expect(unseal(key, 'account:102', cipher)).rejects.toThrow();
  await expect(unseal('22'.repeat(32), 'account:101', cipher)).rejects.toThrow();
  const bytes = cipher.split('.');
  bytes[1] = (bytes[1][0] === 'A' ? 'B' : 'A') + bytes[1].slice(1);
  await expect(unseal(key, 'account:101', bytes.join('.'))).rejects.toThrow();
});

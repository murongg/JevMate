const encoder = new TextEncoder();
function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
async function key(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('Configure a 32-byte CREDENTIAL_KEY.');
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(secret.match(/../g)!, (h) => parseInt(h, 16)),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}
export function randomToken() {
  return base64(crypto.getRandomValues(new Uint8Array(32)));
}
export async function hash(value: string) {
  return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
export async function seal(secret: string, context: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    await key(secret),
    encoder.encode(value),
  );
  return base64(iv) + '.' + base64(new Uint8Array(ciphertext));
}
export async function unseal(secret: string, context: string, value: string) {
  const parts = value.split('.');
  if (parts.length !== 2) throw new Error('Invalid encrypted credential.');
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(parts[0]), additionalData: encoder.encode(context) },
      await key(secret),
      decode(parts[1]),
    ),
  );
}

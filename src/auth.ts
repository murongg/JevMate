const encode = (s: string) => new TextEncoder().encode(s);
export async function verifyWebhook(
  body: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (h) => parseInt(h, 16));
  const key = await crypto.subtle.importKey(
    'raw',
    encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, bytes, encode(body));
}
export async function authorized(req: Request, token: string): Promise<boolean> {
  if (!token || token.length < 32) return false;
  const origin = req.headers.get('Origin');
  if (origin && origin !== new URL(req.url).origin) return false;
  const provided = req.headers.get('Authorization') || '';
  const [a, b] = await Promise.all(
    [provided, `Bearer ${token}`].map((s) => crypto.subtle.digest('SHA-256', encode(s))),
  );
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}

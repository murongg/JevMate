export function result() {
  return {
    model: 'jev-test',
    usage: { input_tokens: 100, output_tokens: 10 },
    answers: {
      category: {
        type: 'choice',
        choice: 'bug',
        confidence: 0.87,
        probabilities: {
          bug: 0.9,
          enhancement: 0.03,
          question: 0.03,
          documentation: 0.02,
          other: 0.02,
        },
      },
      module: {
        type: 'choice',
        choice: 'unknown',
        confidence: 0.1,
        probabilities: { frontend: 0.1, backend: 0.1, tooling: 0.1, unknown: 0.7 },
      },
      reproduction: { type: 'noul', noul: 0.1 },
      version: { type: 'noul', noul: 0.8 },
      expected: { type: 'noul', noul: 0.9 },
    },
  };
}

export async function signature(body: string, secret = 'synthetic-secret') {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return (
    'sha256=' + Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('')
  );
}

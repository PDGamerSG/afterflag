export function encode(codec, { title, body }) {
  if (codec === 'v1') return JSON.stringify({ version: 1, title, body });
  if (codec === 'v2') return JSON.stringify({ version: 2, document: { title, body } });
  throw new Error('Unknown export codec.');
}

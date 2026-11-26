import { createHash } from 'node:crypto';

const text = (value) => Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
const digest = (value) => createHash('sha256').update(value).digest('hex');

function encode(codec, document) {
  if (codec === 'v1') {
    return Buffer.from(JSON.stringify({ version: 1, title: document.title, body: document.body }));
  }
  if (codec === 'v2') {
    return Buffer.from(JSON.stringify({
      version: 2,
      document: { title: document.title, body: document.body },
      format: 'afterflag-export'
    }));
  }
  throw new Error('unsupported codec ' + codec);
}

function decode(codec, bytes) {
  const value = JSON.parse(text(bytes));
  if (codec === 'v1' && value.version === 1) {
    return 'export:' + value.title + ':' + value.body;
  }
  if (codec === 'v2' && value.version === 2 && value.document) {
    return 'export:' + value.document.title + ':' + value.document.body;
  }
  throw new Error('expected ' + codec + ', received version ' + value.version);
}

export const adapter = {
  fixture(kind = 'legacy') {
    return kind === 'replacement'
      ? { title: 'Launch note', body: 'The new worker can safely ship.' }
      : { title: 'Migration guide', body: 'Keep the old decoder until the queue drains.' };
  },
  encode,
  expectedArtifact(document) {
    return 'export:' + document.title + ':' + document.body;
  },
  decoders(mode = 'bridge') {
    if (mode === 'candidate') return { v2: (bytes) => decode('v2', bytes) };
    if (mode === 'bridge') {
      return { v1: (bytes) => decode('v1', bytes), v2: (bytes) => decode('v2', bytes) };
    }
    return { v1: (bytes) => decode('v1', bytes) };
  },
  digest
};

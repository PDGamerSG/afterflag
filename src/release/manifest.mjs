import { readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = (input) => createHash('sha256').update(input).digest('hex');
export const replayStates = ['pending', 'held', 'retry', 'claimed', 'dead'];
const roles = ['producer', 'bridge', 'candidate'];
const key = /^[a-z][a-z0-9_-]{0,63}$/;
const maxModuleBytes = 256 * 1024;

export function validateManifest(manifest) {
  if (manifest?.version !== 1 || !key.test(manifest.id ?? '') ||
      typeof manifest.title !== 'string' || !manifest.title.trim() || manifest.title.length > 70) {
    throw new TypeError('Expected a version 1 release manifest with a short ID and title.');
  }
  const { codec, hold } = manifest.flags ?? {};
  const { old, new: next } = manifest.codecs ?? {};
  if (!key.test(codec ?? '') || !key.test(hold ?? '') || codec === hold) {
    throw new TypeError('Declare two different Flagsmith flag names.');
  }
  if (!key.test(old ?? '') || !key.test(next ?? '') || old === next) {
    throw new TypeError('Declare two different codec IDs.');
  }
  if (!roles.every((role) => typeof manifest.artifacts?.[role] === 'string' &&
      manifest.artifacts[role].endsWith('.mjs'))) {
    throw new TypeError('Declare local .mjs artifacts for the producer, bridge and candidate.');
  }
  if (!Array.isArray(manifest.replay) || manifest.replay.length !== replayStates.length ||
      !replayStates.every((state) => manifest.replay.includes(state))) {
    throw new TypeError('Declare replay coverage for pending, held, retry, claimed and dead jobs.');
  }
  const { retained, replacement } = manifest.specimens ?? {};
  for (const specimen of [retained, replacement]) {
    if (!key.test(specimen?.id ?? '') || !specimen.payload ||
        typeof specimen.payload !== 'object' || Array.isArray(specimen.payload) ||
        typeof specimen.expectedArtifact !== 'string' || specimen.expectedArtifact.length < 1) {
      throw new TypeError('Each specimen needs a job ID, JSON object and expected artifact.');
    }
  }
  if (retained.id === replacement.id || !Number.isSafeInteger(retained.delayMs) ||
      retained.delayMs < 60000 || retained.delayMs > 3600000) {
    throw new TypeError('Use different specimen IDs and give the retained job a 1–60 minute logical delay.');
  }
  return manifest;
}

export async function loadManifest(filename) {
  const manifestPath = await realpath(filename);
  const original = await readFile(manifestPath);
  if (original.length > maxModuleBytes) throw new Error('The manifest exceeds 256 KiB.');
  const manifest = validateManifest(JSON.parse(original));
  const root = dirname(manifestPath);
  const artifacts = {};
  for (const role of roles) {
    const filename = await realpath(resolve(root, manifest.artifacts[role]));
    if (relative(root, filename).split(sep)[0] === '..') {
      throw new Error('Runtime artifacts must be inside the manifest directory.');
    }
    const source = await readFile(filename);
    if (!source.length || source.length > maxModuleBytes) {
      throw new Error('A standalone runtime artifact must be 1–262144 bytes.');
    }
    artifacts[role] = { source: source.toString('base64'), digest: sha256(source) };
  }
  if (artifacts.bridge.digest === artifacts.candidate.digest) {
    throw new Error('Use distinct bridge and candidate artifacts.');
  }
  return { manifest, digest: sha256(original), artifacts };
}

export async function importArtifact(artifact) {
  const bytes = Buffer.from(artifact.source, 'base64');
  if (!bytes.length || bytes.length > maxModuleBytes || sha256(bytes) !== artifact.digest) {
    throw new Error('Runtime artifact fingerprint mismatch.');
  }
  return import('data:text/javascript;base64,' + artifact.source);
}

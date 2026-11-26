import assert from 'node:assert/strict';
import test from 'node:test';
import { loadManifest, validateManifest } from '../../src/release/manifest.mjs';

test('a checked-in contract binds distinct candidate and bridge module bytes', async () => {
  const run = await loadManifest('scenarios/document-export.json');
  assert.deepEqual(run.manifest.codecs, { old: 'v1', new: 'v2' });
  assert.equal(run.digest.length, 64);
  assert.notEqual(run.artifacts.bridge.digest, run.artifacts.candidate.digest);
});

test('missing replay coverage and identical codec IDs fail closed', () => {
  const valid = {
    version: 1, id: 'test', title: 'Example',
    flags: { codec: 'codec_v2', hold: 'hold' },
    codecs: { old: 'v1', new: 'v2' },
    artifacts: { producer: 'a.mjs', bridge: 'b.mjs', candidate: 'c.mjs' },
    specimens: {
      retained: { id: 'legacy', payload: {}, expectedArtifact: 'A', delayMs: 120000 },
      replacement: { id: 'next', payload: {}, expectedArtifact: 'B' }
    },
    replay: ['pending', 'held', 'retry', 'claimed', 'dead']
  };
  assert.throws(() => validateManifest({ ...valid, replay: ['pending'] }), /replay coverage/);
  assert.throws(() => validateManifest({ ...valid, codecs: { old: 'v1', new: 'v1' } }), /different/);
});

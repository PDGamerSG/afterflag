import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { createEvidence, verifyEvidence } from '../../src/release/evidence.mjs';

test('incomplete runs preserve their signed evidence and reject a false ready verdict', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const otherKey = generateKeyPairSync('ed25519').publicKey;
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const writer = createEvidence({ id: 'missing-provider', metadata: { source: 'test' } });
  writer.add('error', { message: 'Provider unavailable' });
  const report = writer.finish(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.equal(verifyEvidence(report, { publicPem }).status, 'incomplete');
  assert.throws(() => verifyEvidence(report, {
    publicPem: otherKey.export({ type: 'spki', format: 'pem' })
  }), /signature mismatch/);
  assert.throws(() => verifyEvidence(report, { source: 'different' }), /Source fingerprint mismatch/);
  report.conclusion.status = 'ready';
  assert.throws(() => verifyEvidence(report), /Evidence verdict or seal mismatch/);
});

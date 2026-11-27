import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { request, evaluatedFlag } from '../../src/flagsmith.mjs';

test('a valid disabled flag is distinguished from malformed evaluation', () => {
  const result = evaluatedFlag({ feature: { name: 'af_hold' }, enabled: false }, 'af_hold');
  assert.equal(result.enabled, false);
  for (const value of [{}, { enabled: false }, { feature: { name: 'af_hold' }, enabled: 'false' },
    { feature: { name: 'other' }, enabled: false }]) {
    assert.throws(() => evaluatedFlag(value, 'af_hold'), /explicit decision/);
  }
});

test('the provider has a bounded deadline and errors omit credential paths', async (t) => {
  const server = createServer((req, res) => {
    if (!req.url.includes('hang')) res.writeHead(401).end('{"detail":"secret"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  await assert.rejects(() => request(base, '/hang', { timeoutMs: 30 }), /unavailable/);
  await assert.rejects(() => request(base, '/secret-credential', { token: 'secret' }), (err) =>
    err.status === 401 && !JSON.stringify(err).includes('secret') && !err.message.includes('secret'));
});

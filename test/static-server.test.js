import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPureFrontendServer } from '../static-server.js';

function request(port, requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('pure frontend server serves the app and WASM without exposing API routes', async t => {
  const publicDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cliptrio-static-'));
  await fsp.writeFile(path.join(publicDir, 'index.html'), '<title>browser only</title>');
  await fsp.writeFile(path.join(publicDir, 'core.wasm'), Buffer.from([0, 97, 115, 109]));

  const server = createPureFrontendServer({ publicDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(publicDir, { recursive: true, force: true });
  });

  const page = await request(port, '/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body.toString(), /browser only/);

  const wasm = await request(port, '/core.wasm');
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers['content-type'], 'application/wasm');

  assert.equal((await request(port, '/api/health')).status, 404);
  assert.equal((await request(port, '/', 'POST')).status, 405);
});

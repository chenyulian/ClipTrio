import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClipTrioServer } from '../server-http.js';

function buildMultipart(parts, boundary = 'clip-trio-test-boundary') {
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename) {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
        `Content-Type: ${part.contentType || 'video/mp4'}\r\n\r\n`
      ));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`));
    }
    chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(String(part.data ?? '')));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function validParts(overrides = {}) {
  return [
    { name: 'clipLength', data: '3' },
    { name: 'exportLength', data: '5' },
    { name: 'top', filename: overrides.topName || 'top.mp4', data: overrides.topData || Buffer.from('top') },
    { name: 'middle', filename: overrides.middleName || 'middle.mov', data: overrides.middleData || Buffer.from('middle') },
    { name: 'bottom', filename: overrides.bottomName || 'bottom.m4v', data: overrides.bottomData || Buffer.from('bottom') }
  ];
}

function request(port, { path: requestPath = '/', method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

async function createHarness(overrides = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'clip-trio-http-'));
  const publicDir = path.join(root, 'public');
  const tmpRoot = path.join(root, 'jobs');
  await fsp.mkdir(publicDir, { recursive: true });
  await fsp.mkdir(tmpRoot, { recursive: true });
  await fsp.writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>test</title>');
  await fsp.writeFile(path.join(root, 'secret.txt'), 'not public');

  const server = createClipTrioServer({
    publicDir,
    tmpRoot,
    randomUUID: () => `job-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    probeVideo: async () => 5,
    renderVideo: async (files, fields, jobDir) => {
      const outputPath = path.join(jobDir, 'triptych.mp4');
      await fsp.writeFile(outputPath, Buffer.from('rendered-mp4'));
      return outputPath;
    },
    ...overrides
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  return {
    port,
    publicDir,
    tmpRoot,
    async close() {
      await new Promise(resolve => server.close(resolve));
      await fsp.rm(root, { recursive: true, force: true });
    }
  };
}

function json(response) {
  return JSON.parse(response.body.toString('utf8'));
}

test('health, static routing, method rejection, and path traversal are enforced over HTTP', async t => {
  const harness = await createHarness();
  t.after(() => harness.close());

  const health = await request(harness.port, { path: '/api/health' });
  assert.equal(health.status, 200);
  assert.deepEqual(json(health), { ok: true });

  const page = await request(harness.port);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body.toString(), /<title>test<\/title>/);

  await fsp.writeFile(path.join(harness.publicDir, 'ffmpeg-core.wasm'), Buffer.from([0, 97, 115, 109]));
  const wasm = await request(harness.port, { path: '/ffmpeg-core.wasm' });
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers['content-type'], 'application/wasm');

  const missing = await request(harness.port, { path: '/missing.js' });
  assert.equal(missing.status, 404);

  const traversal = await request(harness.port, { path: '/..%5csecret.txt' });
  assert.equal(traversal.status, 403);
  assert.equal(json(traversal).error, 'Forbidden');

  const encodedTraversal = await request(harness.port, { path: '/%2e%2e%5csecret.txt' });
  assert.equal(encodedTraversal.status, 403);

  const encodedSlashTraversal = await request(harness.port, { path: '/%2e%2e%2fsecret.txt' });
  assert.equal(encodedSlashTraversal.status, 403);

  const badEncoding = await request(harness.port, { path: '/%ZZ' });
  assert.equal(badEncoding.status, 400);

  const method = await request(harness.port, { method: 'DELETE' });
  assert.equal(method.status, 405);
});

test('a real multipart render request writes ordered slots, streams MP4, and removes its job directory', async t => {
  let observed;
  const harness = await createHarness({
    renderVideo: async (files, fields, jobDir) => {
      observed = {
        names: files.map(file => file.filename),
        data: await Promise.all(files.map(file => fsp.readFile(file.path, 'utf8'))),
        fields
      };
      const outputPath = path.join(jobDir, 'triptych.mp4');
      await fsp.writeFile(outputPath, Buffer.from('route-render-result'));
      return outputPath;
    }
  });
  t.after(() => harness.close());
  const multipart = buildMultipart(validParts());

  const response = await request(harness.port, {
    path: '/api/render',
    method: 'POST',
    headers: { 'content-type': multipart.contentType, 'content-length': multipart.body.length },
    body: multipart.body
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'video/mp4');
  assert.match(response.headers['content-disposition'], /clip-trio-/);
  assert.equal(response.body.toString(), 'route-render-result');
  assert.deepEqual(observed.names, ['top.mp4', 'middle.mov', 'bottom.m4v']);
  assert.deepEqual(observed.data, ['top', 'middle', 'bottom']);
  assert.equal(observed.fields.clipLength, '3');
  await waitFor(async () => (await fsp.readdir(harness.tmpRoot)).length === 0, 'render job was not cleaned up');
});

test('malformed multipart and invalid render inputs return actionable route errors without rendering', async t => {
  let renderCalls = 0;
  const harness = await createHarness({
    maxVideoBytes: 8,
    renderVideo: async () => {
      renderCalls += 1;
      throw new Error('should not render');
    }
  });
  t.after(() => harness.close());

  const noBoundary = await request(harness.port, {
    path: '/api/render', method: 'POST', headers: { 'content-type': 'multipart/form-data' }, body: Buffer.from('bad')
  });
  assert.equal(noBoundary.status, 400);
  assert.match(json(noBoundary).error, /multipart boundary/i);

  const malformed = await request(harness.port, {
    path: '/api/render', method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: Buffer.from('--x\r\ninvalid')
  });
  assert.equal(malformed.status, 400);
  assert.match(json(malformed).error, /Malformed multipart body/);

  const missingMultipart = buildMultipart(validParts().filter(part => part.name !== 'bottom'));
  const missing = await request(harness.port, {
    path: '/api/render', method: 'POST', headers: { 'content-type': missingMultipart.contentType }, body: missingMultipart.body
  });
  assert.equal(missing.status, 400);
  assert.match(json(missing).error, /top, middle, and bottom/);

  const extensionMultipart = buildMultipart(validParts({ topName: 'top.avi' }));
  const extension = await request(harness.port, {
    path: '/api/render', method: 'POST', headers: { 'content-type': extensionMultipart.contentType }, body: extensionMultipart.body
  });
  assert.equal(extension.status, 400);
  assert.match(json(extension).error, /Only MOV, MP4, and M4V/);

  const sizeMultipart = buildMultipart(validParts({ topData: Buffer.alloc(9) }));
  const size = await request(harness.port, {
    path: '/api/render', method: 'POST', headers: { 'content-type': sizeMultipart.contentType }, body: sizeMultipart.body
  });
  assert.equal(size.status, 400);
  assert.match(json(size).error, /Each video must be/);
  assert.equal(renderCalls, 0);
  await waitFor(async () => (await fsp.readdir(harness.tmpRoot)).length === 0, 'invalid jobs were not cleaned up');
});

test('total upload limit is enforced before multipart parsing and leaves no job directory', async t => {
  const harness = await createHarness({ maxUploadBytes: 64 });
  t.after(() => harness.close());
  const multipart = buildMultipart(validParts());
  const response = await request(harness.port, {
    path: '/api/render', method: 'POST', headers: { 'content-type': multipart.contentType }, body: multipart.body
  });
  assert.equal(response.status, 413);
  assert.equal(json(response).error, 'Upload is too large.');
  await waitFor(async () => (await fsp.readdir(harness.tmpRoot)).length === 0, 'oversized job was not cleaned up');
});

test('duration validation and render failures clean jobs without leaking internal details', async t => {
  let probeCalls = 0;
  const harness = await createHarness({
    probeVideo: async () => {
      probeCalls += 1;
      return probeCalls <= 3 ? 31 : 5;
    },
    renderVideo: async () => {
      throw new Error('ffmpeg failed at C:\\private\\jobs\\secret with command details');
    }
  });
  t.after(() => harness.close());
  const multipart = buildMultipart(validParts());
  const requestOptions = {
    path: '/api/render', method: 'POST', headers: { 'content-type': multipart.contentType }, body: multipart.body
  };

  const duration = await request(harness.port, requestOptions);
  assert.equal(duration.status, 400);
  assert.match(json(duration).error, /Max duration is 30s/);
  await waitFor(async () => (await fsp.readdir(harness.tmpRoot)).length === 0, 'duration failure job was not cleaned up');

  probeCalls = 3;
  const renderFailure = await request(harness.port, requestOptions);
  assert.equal(renderFailure.status, 400);
  assert.equal(json(renderFailure).error, 'Video render failed.');
  assert.doesNotMatch(renderFailure.body.toString(), /private|secret|ffmpeg|command/i);
  await waitFor(async () => (await fsp.readdir(harness.tmpRoot)).length === 0, 'render failure job was not cleaned up');
});

test('render proxy preserves upstream success and error responses', async t => {
  const upstreamCalls = [];
  const harness = await createHarness({
    renderProxyUrl: 'http://renderer.invalid/api/render',
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, body: Buffer.from(options.body), contentType: options.headers['content-type'] });
      if (upstreamCalls.length === 1) {
        return new Response(Buffer.from('proxied-video'), {
          status: 200,
          headers: {
            'content-type': 'video/mp4',
            'content-disposition': 'attachment; filename="upstream.mp4"'
          }
        });
      }
      return new Response(JSON.stringify({ error: 'upstream validation failed' }), {
        status: 422,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }
  });
  t.after(() => harness.close());
  const multipart = buildMultipart(validParts());
  const requestOptions = {
    path: '/api/render', method: 'POST', headers: { 'content-type': multipart.contentType }, body: multipart.body
  };

  const success = await request(harness.port, requestOptions);
  assert.equal(success.status, 200);
  assert.equal(success.body.toString(), 'proxied-video');
  assert.equal(success.headers['content-disposition'], 'attachment; filename="upstream.mp4"');

  const upstreamError = await request(harness.port, requestOptions);
  assert.equal(upstreamError.status, 422);
  assert.deepEqual(json(upstreamError), { error: 'upstream validation failed' });
  assert.equal(upstreamCalls[0].url, 'http://renderer.invalid/api/render');
  assert.deepEqual(upstreamCalls[0].body, multipart.body);
  assert.equal(upstreamCalls[0].contentType, multipart.contentType);
});

test('render proxy maps connection failures and timeouts without exposing internal errors', async t => {
  let calls = 0;
  const harness = await createHarness({
    renderProxyUrl: 'http://renderer.internal:3000/api/render',
    renderProxyTimeoutMs: 20,
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls === 1) throw new Error('connect ECONNREFUSED 10.1.2.3:3000');
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    }
  });
  t.after(() => harness.close());
  const multipart = buildMultipart(validParts());
  const requestOptions = {
    path: '/api/render', method: 'POST', headers: { 'content-type': multipart.contentType }, body: multipart.body
  };

  const failure = await request(harness.port, requestOptions);
  assert.equal(failure.status, 502);
  assert.doesNotMatch(failure.body.toString(), /ECONNREFUSED|10\.1\.2\.3|renderer\.internal/);

  const timeout = await request(harness.port, requestOptions);
  assert.equal(timeout.status, 504);
  assert.match(json(timeout).error, /代理超时/);
});

test('client disconnect from the proxy route aborts the upstream request', async t => {
  let fetchStartedResolve;
  const fetchStarted = new Promise(resolve => { fetchStartedResolve = resolve; });
  let upstreamAborted = false;
  const harness = await createHarness({
    renderProxyUrl: 'http://renderer.invalid/api/render',
    fetchImpl: async (_url, options) => {
      fetchStartedResolve();
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          upstreamAborted = true;
          reject(Object.assign(new Error('upstream aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
    }
  });
  t.after(() => harness.close());
  const multipart = buildMultipart(validParts());
  const client = http.request({
    host: '127.0.0.1', port: harness.port, path: '/api/render', method: 'POST',
    headers: { 'content-type': multipart.contentType, 'content-length': multipart.body.length }
  });
  client.on('error', () => {});
  client.end(multipart.body);
  await fetchStarted;
  client.destroy();
  await waitFor(() => upstreamAborted, 'proxy upstream request was not aborted');
});

test('client disconnect during render aborts work and removes the job directory', async t => {
  let renderStartedResolve;
  const renderStarted = new Promise(resolve => { renderStartedResolve = resolve; });
  let renderAborted = false;
  const harness = await createHarness({
    renderVideo: async (_files, _fields, _jobDir, options) => {
      renderStartedResolve();
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          renderAborted = true;
          reject(Object.assign(new Error('render aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
    }
  });
  t.after(() => harness.close());
  const multipart = buildMultipart(validParts());
  const client = http.request({
    host: '127.0.0.1', port: harness.port, path: '/api/render', method: 'POST',
    headers: { 'content-type': multipart.contentType, 'content-length': multipart.body.length }
  });
  client.on('error', () => {});
  client.end(multipart.body);
  await renderStarted;
  client.destroy();

  await waitFor(() => renderAborted, 'render did not receive abort signal');
  await waitFor(async () => (await fsp.readdir(harness.tmpRoot)).length === 0, 'disconnected render job was not cleaned up');
});

test('client disconnect during upload removes the pre-created job directory', async t => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const client = http.request({
    host: '127.0.0.1', port: harness.port, path: '/api/render', method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=partial', 'content-length': 10000 }
  });
  client.on('error', () => {});
  client.write(Buffer.from('--partial\r\nContent-Disposition: form-data; name="top"; filename="top.mp4"\r\n\r\npartial'));
  await waitFor(async () => (await fsp.readdir(harness.tmpRoot)).length === 1, 'upload job directory was not created');
  client.destroy();
  await waitFor(async () => (await fsp.readdir(harness.tmpRoot)).length === 0, 'disconnected upload job was not cleaned up');
});

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import {
  buildProxyResponseHeaders,
  collectRenderParts,
  getPublicRenderError,
  maxUploadBytes as defaultMaxUploadBytes,
  renderRequestError,
  validateVideoDuration
} from './server-core.js';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm'
};

export function getStaticContentType(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function abortError(message = 'Request aborted.') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function canWriteResponse(res) {
  return !res.destroyed && !res.writableEnded;
}

export function sendJson(res, status, data) {
  if (!canWriteResponse(res)) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

export function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

export function parseMultipart(buffer, contentType) {
  const match = /^multipart\/form-data\s*;[\s\S]*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  if (!match) throw renderRequestError('Missing multipart boundary.');

  const boundaryValue = match[1] || match[2];
  const boundary = Buffer.from(`--${boundaryValue}`);
  const closingBoundary = Buffer.from(`--${boundaryValue}--`);
  if (!buffer.length || buffer.indexOf(boundary) !== 0 || buffer.indexOf(closingBoundary) === -1) {
    throw renderRequestError('Malformed multipart body.');
  }

  const parts = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    if (!buffer.slice(cursor, cursor + boundary.length).equals(boundary)) {
      throw renderRequestError('Malformed multipart body.');
    }
    cursor += boundary.length;
    if (buffer.slice(cursor, cursor + 2).toString() === '--') break;
    if (buffer.slice(cursor, cursor + 2).toString() !== '\r\n') {
      throw renderRequestError('Malformed multipart body.');
    }
    cursor += 2;

    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd === -1) throw renderRequestError('Malformed multipart body.');
    const headerText = buffer.slice(cursor, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(Buffer.from(`\r\n--${boundaryValue}`), dataStart);
    if (nextBoundary === -1) throw renderRequestError('Malformed multipart body.');

    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headerText)?.[1] || '';
    const name = /name="([^"]+)"/i.exec(disposition)?.[1] || '';
    if (!name) throw renderRequestError('Malformed multipart body.');
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] || '';
    const contentTypeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    parts.push({
      name,
      filename,
      contentType: contentTypeMatch ? contentTypeMatch[1].trim() : '',
      data: buffer.slice(dataStart, nextBoundary)
    });
    cursor = nextBoundary + 2;
  }

  return parts;
}

export function readRequestBody(req, options = {}) {
  const maxBytes = options.maxBytes ?? defaultMaxUploadBytes;
  const signal = options.signal;

  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    const cleanup = () => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      signal?.removeEventListener('abort', onSignalAbort);
    };
    const finish = callback => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onData = chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        finish(() => reject(renderRequestError('Upload is too large.', 413)));
        req.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(() => resolve(Buffer.concat(chunks)));
    const onError = error => finish(() => reject(error));
    const onAborted = () => finish(() => reject(abortError()));
    const onSignalAbort = () => finish(() => reject(abortError()));

    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAborted);
    signal?.addEventListener('abort', onSignalAbort, { once: true });
    if (signal?.aborted) onSignalAbort();
  });
}

export function resolveStaticPath(requestUrl, host, publicDir) {
  let pathname;
  try {
    const parsedUrl = new URL(requestUrl, `http://${host || 'localhost'}`);
    pathname = decodeURIComponent(parsedUrl.pathname);
  } catch {
    throw renderRequestError('Bad request');
  }

  const pathSegments = pathname.replace(/\\/g, '/').split('/');
  if (pathSegments.includes('..')) throw renderRequestError('Forbidden', 403);

  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(publicDir, relative);
  const relativeFromPublic = path.relative(publicDir, filePath);
  if (relativeFromPublic.startsWith('..') || path.isAbsolute(relativeFromPublic)) {
    throw renderRequestError('Forbidden', 403);
  }
  return filePath;
}

function createJobLifecycle(req, res, jobDir, cleanupJobDir) {
  const controller = new AbortController();
  let cleanupPromise = null;
  const cleanup = () => {
    cleanupPromise ||= Promise.resolve(cleanupJobDir(jobDir)).catch(() => {});
    return cleanupPromise;
  };
  const disconnect = () => {
    if (!res.writableFinished) controller.abort();
  };
  req.once('aborted', disconnect);
  res.once('close', disconnect);
  return {
    signal: controller.signal,
    cleanup,
    dispose() {
      req.removeListener('aborted', disconnect);
      res.removeListener('close', disconnect);
    }
  };
}

export function createRequestHandler(options) {
  const {
    publicDir,
    tmpRoot,
    renderProxyUrl = '',
    renderProxyTimeoutMs = 130000,
    maxUploadBytes = defaultMaxUploadBytes,
    maxVideoBytes,
    fetchImpl = globalThis.fetch,
    randomUUID = crypto.randomUUID,
    probeVideo,
    renderVideo,
    cleanupJobDir = jobDir => fsp.rm(jobDir, { recursive: true, force: true }),
    createReadStream = fs.createReadStream
  } = options;

  async function handleLocalRender(req, res) {
    const jobDir = path.join(tmpRoot, randomUUID());
    await fsp.mkdir(jobDir, { recursive: true });
    const lifecycle = createJobLifecycle(req, res, jobDir, cleanupJobDir);

    try {
      const body = await readRequestBody(req, { maxBytes: maxUploadBytes, signal: lifecycle.signal });
      const parts = parseMultipart(body, req.headers['content-type']);
      const { fields, files: uploadedFiles } = collectRenderParts(parts, { maxVideoBytes });
      const files = [];

      for (const file of uploadedFiles) {
        const filePath = path.join(jobDir, `${file.slot}${file.extension}`);
        await fsp.writeFile(filePath, file.data);
        files[file.slot] = { path: filePath, filename: file.filename, size: file.size };
      }

      for (const file of files) {
        if (lifecycle.signal.aborted) throw abortError();
        const duration = await probeVideo(file.path, jobDir, { signal: lifecycle.signal });
        validateVideoDuration(file, duration);
        file.duration = duration;
      }

      const outputPath = await renderVideo(files, fields, jobDir, { signal: lifecycle.signal });
      if (lifecycle.signal.aborted) throw abortError();
      const stat = await fsp.stat(outputPath);
      res.writeHead(200, {
        'content-type': 'video/mp4',
        'content-length': stat.size,
        'content-disposition': `attachment; filename="clip-trio-${Date.now()}.mp4"`,
        'cache-control': 'no-store'
      });
      await pipeline(createReadStream(outputPath), res);
    } catch (error) {
      if (error?.name !== 'AbortError' && canWriteResponse(res)) {
        const publicError = getPublicRenderError(error);
        sendError(res, publicError.status, publicError.message);
      }
    } finally {
      lifecycle.dispose();
      await lifecycle.cleanup();
    }
  }

  async function handleRenderProxy(req, res) {
    const controller = new AbortController();
    const disconnect = () => {
      if (!res.writableFinished) controller.abort();
    };
    req.once('aborted', disconnect);
    res.once('close', disconnect);
    const timer = setTimeout(() => controller.abort(), renderProxyTimeoutMs);

    try {
      const body = await readRequestBody(req, { maxBytes: maxUploadBytes, signal: controller.signal });
      const upstream = await fetchImpl(renderProxyUrl, {
        method: 'POST',
        headers: {
          'content-type': req.headers['content-type'] || 'application/octet-stream',
          'content-length': String(body.length)
        },
        body,
        signal: controller.signal
      });
      const responseBody = Buffer.from(await upstream.arrayBuffer());
      if (controller.signal.aborted) throw abortError();
      res.writeHead(upstream.status, buildProxyResponseHeaders(upstream.headers, responseBody.length));
      res.end(responseBody);
    } catch (error) {
      if (canWriteResponse(res)) {
        const timedOut = error?.name === 'AbortError' && !req.aborted && !res.destroyed;
        sendError(res, timedOut ? 504 : 502, timedOut
          ? '渲染代理超时，请缩短片段或稍后重试。'
          : '渲染代理失败，无法连接渲染服务，请稍后重试。');
      }
    } finally {
      clearTimeout(timer);
      req.removeListener('aborted', disconnect);
      res.removeListener('close', disconnect);
    }
  }

  async function serveStatic(req, res) {
    try {
      const filePath = resolveStaticPath(req.url, req.headers.host, publicDir);
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw renderRequestError('Not found', 404);
      res.writeHead(200, { 'content-type': getStaticContentType(filePath) });
      await pipeline(createReadStream(filePath), res);
    } catch (error) {
      if (!res.headersSent && canWriteResponse(res)) {
        sendError(res, error?.status || 404, error?.expose ? error.message : 'Not found');
      }
    }
  }

  return async function requestHandler(req, res) {
    if (req.method === 'GET' && req.url === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/render') {
      if (renderProxyUrl) await handleRenderProxy(req, res);
      else await handleLocalRender(req, res);
      return;
    }
    if (req.method === 'GET') {
      await serveStatic(req, res);
      return;
    }
    sendError(res, 405, 'Method not allowed');
  };
}

export function createClipTrioServer(options) {
  const handler = createRequestHandler(options);
  return http.createServer((req, res) => {
    handler(req, res).catch(error => {
      if (canWriteResponse(res)) sendError(res, 500, 'Internal server error');
      options.onUnhandledError?.(error);
    });
  });
}

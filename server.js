import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  buildFinalRenderArgs,
  buildSegmentArgs,
  buildProxyResponseHeaders,
  collectRenderParts,
  getPublicRenderError,
  maxUploadBytes,
  normalizeRenderFields,
  validateVideoDuration
} from './server-core.js';
import { probeDuration, runCommand } from './server-process.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const tmpRoot = path.join(__dirname, 'tmp');
const port = Number(process.env.PORT || 3000);
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
const renderProxyUrl = process.env.RENDER_PROXY_URL || '';
const renderProxyTimeoutMs = Number(process.env.RENDER_PROXY_TIMEOUT_MS || 130000);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4'
};

await fsp.mkdir(tmpRoot, { recursive: true });

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function cleanupJobDir(jobDir) {
  return fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new Error('Missing multipart boundary.');
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = [];
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    cursor += boundary.length;
    if (buffer.slice(cursor, cursor + 2).toString() === '--') break;
    if (buffer.slice(cursor, cursor + 2).toString() === '\r\n') cursor += 2;

    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd === -1) break;
    const headerText = buffer.slice(cursor, headerEnd).toString('utf8');
    const nextBoundary = buffer.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;

    let dataEnd = nextBoundary;
    if (buffer.slice(dataEnd - 2, dataEnd).toString() === '\r\n') dataEnd -= 2;
    const data = buffer.slice(headerEnd + 4, dataEnd);
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headerText)?.[1] || '';
    const name = /name="([^"]+)"/i.exec(disposition)?.[1] || '';
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] || '';
    const contentTypeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    parts.push({
      name,
      filename,
      contentType: contentTypeMatch ? contentTypeMatch[1].trim() : '',
      data
    });
    cursor = nextBoundary;
  }

  return parts;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let failed = false;

    req.on('data', chunk => {
      if (failed) return;
      total += chunk.length;
      if (total > maxUploadBytes) {
        failed = true;
        reject(new Error('Upload is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on('error', error => {
      if (!failed) reject(error);
    });
  });
}

async function writeGradientMask(maskPath, width = 1080, height = 640) {
  const header = Buffer.from(`P5\n${width} ${height}\n255\n`, 'ascii');
  const pixels = Buffer.alloc(width * height);
  const start = 0.58;
  const span = 0.42;

  for (let y = 0; y < height; y += 1) {
    const normalizedY = y / (height - 1);
    const progress = Math.max(0, Math.min(1, (normalizedY - start) / span));
    const opacity = progress === 0 ? 0 : 0.012 + 0.34 * Math.pow(progress, 1.85);

    for (let x = 0; x < width; x += 1) {
      const dither = (((x * 13 + y * 17) % 7) - 3) / 255;
      const alpha = Math.max(0, Math.min(255, Math.round((opacity + dither) * 255)));
      pixels[y * width + x] = alpha;
    }
  }

  await fsp.writeFile(maskPath, Buffer.concat([header, pixels]));
}

async function renderMp4(files, fields, jobDir) {
  const { exportLength, clipLength, starts, captions, captionIndexes } = normalizeRenderFields(fields);
  const outputPath = path.join(jobDir, 'triptych.mp4');
  const maskPath = path.join(jobDir, 'caption-gradient.pgm');
  const segmentPaths = [];

  for (let index = 0; index < files.length; index += 1) {
    const segmentPath = path.join(jobDir, `segment-${index}.mp4`);
    segmentPaths.push(segmentPath);
    await runCommand(ffmpegPath, buildSegmentArgs({
      start: starts[index],
      clipLength,
      inputPath: files[index].path,
      outputPath: segmentPath
    }), jobDir, { label: 'FFmpeg segment render' });
  }

  if (captionIndexes.length) {
    await writeGradientMask(maskPath);
  }

  const args = buildFinalRenderArgs({
    segmentPaths,
    exportLength,
    captions,
    captionIndexes,
    maskPath,
    outputPath
  });
  await runCommand(ffmpegPath, args, jobDir, { label: 'FFmpeg final render' });
  return outputPath;
}

async function handleRender(req, res) {
  const jobId = crypto.randomUUID();
  const jobDir = path.join(tmpRoot, jobId);
  await fsp.mkdir(jobDir, { recursive: true });

  try {
    const body = await readRequestBody(req);
    const parts = parseMultipart(body, req.headers['content-type']);
    const { fields, files: uploadedFiles } = collectRenderParts(parts);
    const files = [];

    for (const file of uploadedFiles) {
      const filePath = path.join(jobDir, `${file.slot}${file.extension}`);
      await fsp.writeFile(filePath, file.data);
      files[file.slot] = { path: filePath, filename: file.filename, size: file.size };
    }

    for (const file of files) {
      const duration = await probeDuration(ffprobePath, file.path, jobDir);
      validateVideoDuration(file, duration);
      file.duration = duration;
    }

    const outputPath = await renderMp4(files, fields, jobDir);
    const stat = await fsp.stat(outputPath);
    res.writeHead(200, {
      'content-type': 'video/mp4',
      'content-length': stat.size,
      'content-disposition': `attachment; filename="clip-trio-${Date.now()}.mp4"`,
      'cache-control': 'no-store'
    });
    fs.createReadStream(outputPath).pipe(res);
    res.on('finish', () => {
      cleanupJobDir(jobDir);
    });
    res.on('close', () => {
      cleanupJobDir(jobDir);
    });
  } catch (error) {
    cleanupJobDir(jobDir);
    const publicError = getPublicRenderError(error);
    sendError(res, publicError.status, publicError.message);
  }
}

async function handleRenderProxy(req, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), renderProxyTimeoutMs);

  try {
    const body = await readRequestBody(req);
    const upstream = await fetch(renderProxyUrl, {
      method: 'POST',
      headers: {
        'content-type': req.headers['content-type'] || 'application/octet-stream',
        'content-length': String(body.length)
      },
      body,
      signal: controller.signal
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    const headers = buildProxyResponseHeaders(upstream.headers, responseBody.length);
    res.writeHead(upstream.status, headers);
    res.end(responseBody);
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    sendError(res, timedOut ? 504 : 502, timedOut
      ? '渲染代理超时，请缩短片段或稍后重试。'
      : `渲染代理失败：${error.message || '无法连接渲染服务。'}`);
  } finally {
    clearTimeout(timer);
  }
}

function resolveStaticPath(req, res) {
  let pathname;
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    sendError(res, 400, 'Bad request');
    return null;
  }

  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(publicDir, relative);
  const relativeFromPublic = path.relative(publicDir, filePath);
  if (relativeFromPublic.startsWith('..') || path.isAbsolute(relativeFromPublic)) {
    sendError(res, 403, 'Forbidden');
    return null;
  }

  return filePath;
}

function serveStatic(req, res) {
  const filePath = resolveStaticPath(req, res);
  if (!filePath) return;

  fs.createReadStream(filePath)
    .on('open', () => {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'content-type': mimeTypes[ext] || 'application/octet-stream' });
    })
    .on('error', () => {
      sendError(res, 404, 'Not found');
    })
    .pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/render') {
    if (renderProxyUrl) {
      handleRenderProxy(req, res);
      return;
    }
    handleRender(req, res);
    return;
  }
  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }
  sendError(res, 405, 'Method not allowed');
});

server.listen(port, () => {
  console.log(`ClipTrio running at http://localhost:${port}`);
});

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const tmpRoot = path.join(__dirname, 'tmp');
const port = Number(process.env.PORT || 3000);
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
const renderProxyUrl = process.env.RENDER_PROXY_URL || '';
const maxVideoBytes = 1024 * 1024 * 120;
const maxUploadBytes = 1024 * 1024 * 380;
const maxVideoSeconds = 30;
const maxExportSeconds = 10;
const maxClipSeconds = 8;
const labels = ['top', 'middle', 'bottom'];

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

function sanitizeCaption(value) {
  return Array.from(String(value || ''))
    .filter(char => /[A-Za-z0-9\u4e00-\u9fff ]/.test(char))
    .slice(0, 18)
    .join('')
    .trim();
}

function sanitizeNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function ffmpegText(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
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
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxUploadBytes) {
        reject(new Error('Upload is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

function probeDuration(filePath, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || 'Unable to inspect video duration.'));
        return;
      }
      const duration = Number(stdout.trim());
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error('Unable to inspect video duration.'));
        return;
      }
      resolve(duration);
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

function buildDrawText(caption, yExpression) {
  if (!caption) return '';
  const text = ffmpegText(caption);
  const font = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
  return `drawtext=fontfile=${font}:text='${text}':fontcolor=white@0.92:fontsize=34:x=(w-text_w)/2:y=${yExpression}`;
}

async function renderMp4(files, fields, jobDir) {
  const exportLength = sanitizeNumber(fields.exportLength, 5, 1, maxExportSeconds);
  const clipLength = sanitizeNumber(fields.clipLength, 3, 0.3, maxClipSeconds);
  const starts = labels.map((_, index) => sanitizeNumber(fields[`start${index}`], 0, 0, 9999));
  const captions = labels.map((_, index) => sanitizeCaption(fields[`caption${index}`]));
  const captionIndexes = captions.map((caption, index) => caption ? index : -1).filter(index => index >= 0);
  const outputPath = path.join(jobDir, 'triptych.mp4');
  const maskPath = path.join(jobDir, 'caption-gradient.pgm');
  const segmentPaths = [];

  for (let index = 0; index < files.length; index += 1) {
    const segmentPath = path.join(jobDir, `segment-${index}.mp4`);
    segmentPaths.push(segmentPath);
    await run(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-ss', String(starts[index]),
      '-t', String(clipLength),
      '-i', files[index].path,
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-crf', '20',
      segmentPath
    ], jobDir);
  }

  const args = ['-y', '-hide_banner'];
  segmentPaths.forEach(segmentPath => {
    args.push('-stream_loop', '-1', '-i', segmentPath);
  });
  if (captionIndexes.length) {
    await writeGradientMask(maskPath);
    args.push('-loop', '1', '-t', String(exportLength), '-i', maskPath);
  }
  args.push('-f', 'lavfi', '-t', String(exportLength), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

  const chains = [];

  if (captionIndexes.length === 1) {
    chains.push(`[3:v]format=gray[m${captionIndexes[0]}]`);
  } else if (captionIndexes.length > 1) {
    chains.push(`[3:v]format=gray,split=${captionIndexes.length}${captionIndexes.map(index => `[m${index}]`).join('')}`);
  }

  labels.forEach((_, index) => {
    chains.push(`[${index}:v]trim=duration=${exportLength},setpts=PTS-STARTPTS,scale=1080:640:force_original_aspect_ratio=increase,crop=1080:640,setsar=1,fps=30[base${index}]`);

    if (captions[index]) {
      chains.push(`color=c=black:s=1080x640:d=${exportLength},format=rgba[black${index}]`);
      chains.push(`[black${index}][m${index}]alphamerge[grad${index}]`);
      chains.push(`[base${index}][grad${index}]overlay=0:0,${buildDrawText(captions[index], 'h-72')}[v${index}]`);
    } else {
      chains.push(`[base${index}]copy[v${index}]`);
    }
  });

  const filterComplex = `${chains.join(';')};[v0][v1][v2]vstack=inputs=3,format=yuv420p[v]`;

  args.push(
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-map', `${captionIndexes.length ? 4 : 3}:a`,
    '-t', String(exportLength),
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', '4.1',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-crf', '18',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath
  );

  await run(ffmpegPath, args, jobDir);
  return outputPath;
}

async function handleRender(req, res) {
  const jobId = crypto.randomUUID();
  const jobDir = path.join(tmpRoot, jobId);
  await fsp.mkdir(jobDir, { recursive: true });

  try {
    const body = await readRequestBody(req);
    const parts = parseMultipart(body, req.headers['content-type']);
    const fields = {};
    const files = [];

    for (const part of parts) {
      if (part.filename) {
        const slot = labels.indexOf(part.name);
        if (slot === -1) continue;
        if (part.data.length > maxVideoBytes) {
          throw new Error(`Each video must be ${Math.round(maxVideoBytes / 1024 / 1024)}MB or smaller.`);
        }
        const ext = path.extname(part.filename).toLowerCase() || '.mov';
        const filePath = path.join(jobDir, `${slot}${ext}`);
        await fsp.writeFile(filePath, part.data);
        files[slot] = { path: filePath, filename: part.filename, size: part.data.length };
      } else {
        fields[part.name] = part.data.toString('utf8');
      }
    }

    if (files.filter(Boolean).length !== 3) {
      throw new Error('Please upload top, middle, and bottom videos.');
    }

    for (const file of files) {
      const duration = await probeDuration(file.path, jobDir);
      if (duration > maxVideoSeconds) {
        throw new Error(`Video "${file.filename}" is ${duration.toFixed(1)}s. Max duration is ${maxVideoSeconds}s.`);
      }
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
      fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    });
  } catch (error) {
    fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    const missingFfmpeg = error.code === 'ENOENT' || /not recognized|ENOENT|no such file/i.test(error.message);
    sendError(
      res,
      missingFfmpeg ? 500 : 400,
      missingFfmpeg
        ? '当前服务找不到 FFmpeg/FFprobe，无法导出 MP4。请使用 Docker 版服务，或安装 FFmpeg 并设置 FFMPEG_PATH/FFPROBE_PATH 后重启服务。'
        : error.message
    );
  }
}

async function handleRenderProxy(req, res) {
  try {
    const body = await readRequestBody(req);
    const upstream = await fetch(renderProxyUrl, {
      method: 'POST',
      headers: {
        'content-type': req.headers['content-type'] || 'application/octet-stream',
        'content-length': String(body.length)
      },
      body
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    const headers = {
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      'content-length': responseBody.length,
      'cache-control': upstream.headers.get('cache-control') || 'no-store'
    };
    const disposition = upstream.headers.get('content-disposition');
    if (disposition) headers['content-disposition'] = disposition;
    res.writeHead(upstream.status, headers);
    res.end(responseBody);
  } catch (error) {
    sendError(res, 502, `渲染代理失败：${error.message || '无法连接渲染服务。'}`);
  }
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safePath = path.normalize(relative).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

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

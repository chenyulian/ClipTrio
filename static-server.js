import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStaticContentType, resolveStaticPath } from './server-http.js';

const modulePath = fileURLToPath(import.meta.url);
const rootDir = path.dirname(modulePath);

export function createPureFrontendServer(options = {}) {
  const publicDir = options.publicDir || path.join(rootDir, 'public');

  return http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
      res.end('Method Not Allowed');
      return;
    }

    let filePath;
    try {
      filePath = resolveStaticPath(req.url || '/', req.headers.host, publicDir);
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw Object.assign(new Error('Not Found'), { code: 'ENOENT' });
    } catch (error) {
      const status = error?.status || (error?.code === 'ENOENT' ? 404 : 400);
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(status === 404 ? 'Not Found' : 'Bad Request');
      return;
    }

    res.writeHead(200, {
      'content-type': getStaticContentType(filePath),
      'cache-control': 'no-cache'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const port = Number(process.env.STATIC_PORT || 4173);
  const host = process.env.STATIC_HOST || '127.0.0.1';
  const server = createPureFrontendServer();
  server.listen(port, host, () => {
    console.log(`ClipTrio browser-only app running at http://${host}:${port}/`);
  });
}

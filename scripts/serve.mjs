#!/usr/bin/env node
/**
 * Zero-dependency static file server for local development.
 * Usage: node scripts/serve.mjs [port]      (default 8080)
 * Mirrors GitHub Pages behaviour: serves the repo root, index.html for directories.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT) || 8080;

/** Live version info from the working tree, for the landing-page footer. */
function localVersion() {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    return JSON.stringify(
      {
        commit: git(['rev-parse', '--short', 'HEAD']),
        fullCommit: git(['rev-parse', 'HEAD']),
        branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
        message: git(['log', '-1', '--format=%s']),
        commitTime: git(['log', '-1', '--format=%cI']),
        buildTime: new Date().toISOString(),
        dirty: git(['status', '--porcelain']).length > 0,
        local: true,
      },
      null,
      2,
    );
  } catch {
    return JSON.stringify({ commit: 'unknown', local: true });
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);

    // Serve a live version stamp locally. In production there is no build step,
    // so the landing page falls back to the GitHub commits API instead.
    if (pathname === '/version.json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(localVersion());
      return;
    }

    let filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root + sep) && filePath !== root) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { Location: pathname + '/' + url.search }).end();
        return;
      }
      filePath = join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info?.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Lab dev server: http://127.0.0.1:${port}/  (serving ${root})`);
});

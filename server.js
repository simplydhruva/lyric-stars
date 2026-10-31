// Tiny local server: serves web/, stores the lyric cache on disk, and runs the
// Windows media-session probe. Listens on 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5173;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(ROOT, 'web');
const DATA_DIR =
  process.env.LYRICSTARS_DATA ||
  path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'LyricStars');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const MAX_BODY = 2 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const CSP = [
  "default-src 'self'",
  "connect-src 'self' https://api.spotify.com https://accounts.spotify.com https://lrclib.net",
  "img-src 'self' data: https://i.scdn.co",
  "style-src 'self'",
  "script-src 'self'",
  "frame-ancestors 'none'",
].join('; ');

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

function send(res, status, body, headers = {}) {
  const isJson = body !== undefined && typeof body !== 'string';
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---- lyric cache --------------------------------------------------------

function cacheFile(key) {
  const name = crypto.createHash('sha1').update(key).digest('hex');
  return path.join(CACHE_DIR, `${name}.json`);
}

async function handleCache(req, res, key) {
  if (!key || key.length > 512) return send(res, 400, 'bad key');
  const file = cacheFile(key);
  if (req.method === 'GET') {
    try {
      const raw = await fs.readFile(file, 'utf8');
      return send(res, 200, JSON.parse(raw).value);
    } catch {
      return send(res, 404, 'miss');
    }
  }
  if (req.method === 'PUT') {
    const value = JSON.parse(await readBody(req));
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ key, value }));
    await fs.rename(tmp, file);
    return send(res, 204, '');
  }
  if (req.method === 'DELETE') {
    await fs.rm(file, { force: true });
    return send(res, 204, '');
  }
  send(res, 405, 'method not allowed');
}

async function cacheStats() {
  let count = 0;
  let bytes = 0;
  try {
    for (const f of await fs.readdir(CACHE_DIR)) {
      if (!f.endsWith('.json')) continue;
      count++;
      bytes += (await fs.stat(path.join(CACHE_DIR, f))).size;
    }
  } catch {}
  return { count, bytes, dir: CACHE_DIR };
}

// ---- media-session probe -----------------------------------------------

const probe = { child: null, latest: null, lastRequest: 0, error: null };

function ensureProbe() {
  probe.lastRequest = Date.now();
  if (probe.child || process.platform !== 'win32') return;
  const script = path.join(ROOT, 'tools', 'smtc-probe.ps1');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  probe.child = child;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      probe.latest = JSON.parse(line);
      probe.error = null;
    } catch {}
  });
  child.stderr.on('data', (d) => (probe.error = String(d).slice(0, 500)));
  child.on('exit', () => {
    probe.child = null;
  });
}

// Stop the probe when nobody has asked for it in a while.
setInterval(() => {
  if (probe.child && Date.now() - probe.lastRequest > 30_000) {
    probe.child.kill();
    probe.child = null;
    probe.latest = null;
  }
}, 10_000).unref();

// ---- static files -------------------------------------------------------

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB + path.sep)) return send(res, 403, 'forbidden');
  try {
    const st = await fs.stat(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'not found');
  }
}

// ---- router -------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    // Refuse other hostnames (protects against DNS rebinding).
    if (!ALLOWED_HOSTS.has(host)) return send(res, 403, 'forbidden host');
    // Spotify only accepts loopback IPs as redirect addresses, so always use 127.0.0.1.
    if (host.startsWith('localhost')) {
      res.writeHead(302, { Location: `http://${HOST}:${PORT}${req.url}` });
      return res.end();
    }
    const url = new URL(req.url, `http://${host}`);
    const p = url.pathname;

    if (p.startsWith('/api/')) {
      // Writes must come from our own page.
      const origin = req.headers.origin;
      if (req.method !== 'GET' && origin && origin !== `http://${HOST}:${PORT}`) {
        return send(res, 403, 'forbidden origin');
      }
      if (p.startsWith('/api/cache/')) return await handleCache(req, res, decodeURIComponent(p.slice(11)));
      if (p === '/api/cache' && req.method === 'DELETE') {
        await fs.rm(CACHE_DIR, { recursive: true, force: true });
        return send(res, 204, '');
      }
      if (p === '/api/cache-stats') return send(res, 200, await cacheStats());
      if (p === '/api/media-session') {
        if (process.platform !== 'win32') return send(res, 501, { ok: false, error: 'Windows only' });
        ensureProbe();
        return send(res, 200, probe.latest || { ok: false, starting: true, error: probe.error });
      }
      return send(res, 404, 'unknown api');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    await serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'server error');
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is Lyric Stars already running?`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log(`Lyric Stars running at http://${HOST}:${PORT}/`);
  console.log(`Cache folder: ${CACHE_DIR}`);
});

process.on('exit', () => probe.child?.kill());
process.on('SIGINT', () => process.exit(0));

// Tiny local server: serves web/, stores the lyric cache on disk, and runs the
// Windows media-session helper. Listens on 127.0.0.1 only.
// `npm start` runs it directly; the desktop app imports startServer().
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
export const DEFAULT_PORT = 5173; // Spotify's redirect address is fixed to this port
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(ROOT, 'web');
export const DEFAULT_DATA_DIR =
  process.env.LYRICSTARS_DATA ||
  path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'LyricStars');
// Set by startServer().
let PORT = DEFAULT_PORT;
let CACHE_DIR;
let TIMINGS_DIR; // user timings are kept apart so clearing the lyric cache never loses them
// The native helper (npm run helper) when built; the PowerShell probe otherwise.
let MEDIA_HELPER = path.join(ROOT, 'native', 'bin', 'lyricstars-media.exe');
let PROBE_SCRIPT = path.join(ROOT, 'tools', 'smtc-probe.ps1');
let ALLOWED_HOSTS;
let onLoginHandoff = null; // set by the desktop app
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
  return path.join(key.startsWith('timings:') ? TIMINGS_DIR : CACHE_DIR, `${name}.json`);
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
    let value;
    try {
      value = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, 'bad json');
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
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

// ---- media-session helper -----------------------------------------------

const probe = { child: null, kind: null, latest: null, lastRequest: 0, error: null };

function ensureProbe() {
  probe.lastRequest = Date.now();
  if (probe.child || process.platform !== 'win32') return;
  const native = existsSync(MEDIA_HELPER);
  // The helper exits when its stdin closes, so it never outlives this process.
  const child = native
    ? spawn(MEDIA_HELPER, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PROBE_SCRIPT], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  probe.child = child;
  probe.kind = native ? 'native' : 'powershell';
  child.on('error', (e) => (probe.error = String(e.message)));
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

async function handle(req, res) {
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
      if (p === '/api/health') return send(res, 200, { app: 'lyric-stars' });
      if (p === '/api/login-handoff' && req.method === 'POST') {
        // The desktop app opens Spotify login in the normal browser; the tab Spotify
        // returns to posts the code here so the app can finish the login itself.
        // Useless without the app's own PKCE verifier, which never leaves the app.
        if (origin !== `http://${HOST}:${PORT}`) return send(res, 403, 'forbidden origin');
        if (!onLoginHandoff) return send(res, 404, { ok: false });
        const body = JSON.parse(await readBody(req));
        const pick = (k) => (typeof body[k] === 'string' && body[k].length <= 2048 ? body[k] : undefined);
        const params = { code: pick('code'), state: pick('state'), error: pick('error') };
        if (!params.state?.startsWith('d.')) return send(res, 400, { ok: false });
        return send(res, 200, { ok: onLoginHandoff(params) === true });
      }
      if (p === '/api/media-session') {
        if (process.platform !== 'win32') return send(res, 501, { ok: false, error: 'Windows only' });
        ensureProbe();
        return send(res, 200, { ...(probe.latest || { ok: false, starting: true, error: probe.error }), helper: probe.kind });
      }
      return send(res, 404, 'unknown api');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    await serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'server error');
  }
}

export function stopProbe() {
  probe.child?.kill();
  probe.child = null;
}

// Resolves with the listening server; rejects with code EADDRINUSE if the port is taken.
export function startServer({ port = DEFAULT_PORT, dataDir = DEFAULT_DATA_DIR, mediaHelper, probeScript, onLoginHandoff: handoff } = {}) {
  PORT = port;
  onLoginHandoff = handoff || null;
  CACHE_DIR = path.join(dataDir, 'cache');
  TIMINGS_DIR = path.join(dataDir, 'timings');
  if (mediaHelper) MEDIA_HELPER = mediaHelper;
  if (probeScript) PROBE_SCRIPT = probeScript;
  ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  const server = http.createServer(handle);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => resolve(server));
  });
}

// True when another copy of Lyric Stars already serves the port.
export async function isOurServer(port = DEFAULT_PORT) {
  try {
    const res = await fetch(`http://${HOST}:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()).app === 'lyric-stars';
  } catch {
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  startServer({ port }).then(
    () => {
      console.log(`Lyric Stars running at http://${HOST}:${port}/`);
      console.log(`Cache folder: ${CACHE_DIR}`);
    },
    (e) => {
      console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Is Lyric Stars already running?` : e);
      process.exit(1);
    }
  );
  process.on('exit', stopProbe);
  process.on('SIGINT', () => process.exit(0));
}

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.js';

const PORT = 45000 + Math.floor(Math.random() * 1000); // the server only accepts requests for its own port
let server;
let dir;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ls-server-'));
  server = await startServer({ port: PORT, dataDir: dir });
});
after(async () => {
  await new Promise((r) => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});

test('cache PUT: bad JSON is 400, good JSON round-trips', async () => {
  const url = `http://127.0.0.1:${PORT}/api/cache/test-key`;
  let res = await fetch(url, { method: 'PUT', body: '{not json' });
  assert.equal(res.status, 400);
  res = await fetch(url, { method: 'PUT', body: JSON.stringify({ a: 1 }) });
  assert.equal(res.status, 204);
  res = await fetch(url);
  assert.deepEqual(await res.json(), { a: 1 });
});

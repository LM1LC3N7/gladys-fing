// -----------------------------------------------------------------------------
// The transport and the client on loopback servers: no real network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { FingClient } from '../src/fing/client.js';
import { CODES, isKeyRefused } from '../src/fing/errors.js';
import { httpRequest } from '../src/fing/http.js';
import { KEY, createFakeFing } from './helpers/fakeFing.js';

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

test('the client reads the fake Fing Agent on loopback', async () => {
  const fing = createFakeFing();
  const server = await fing.listen();
  try {
    const client = new FingClient({ host: '127.0.0.1', port: server.port, key: KEY });
    const { devices } = await client.devices();
    assert.equal(devices.length, 3);
    assert.match(fing.requests[0].headers['user-agent'], /^gladys-fing\//);
    const refused = new FingClient({ host: '127.0.0.1', port: server.port, key: 'wrong' });
    const err = await refused.devices().catch((e) => e);
    assert.equal(err.status, 401);
    assert.ok(isKeyRefused(err));
    assert.ok(!err.message.includes('wrong') && !err.message.includes('auth'));
  } finally {
    await server.close();
  }
});

test('the key is URL-encoded in the query', async () => {
  const fing = createFakeFing();
  const client = new FingClient({ host: 'h', port: 1, key: 'a&b=c', request: fing.request });
  await client.devices().catch(() => {});
  assert.equal(fing.requests[0].path, '/1/devices?auth=a%26b%3Dc');
});

test('a redirect is not followed (the URL holds the key)', async () => {
  let hits = 0;
  const server = await serve((req, res) => {
    hits += 1;
    res.writeHead(302, { location: 'http://example.invalid/steal' });
    res.end();
  });
  try {
    const client = new FingClient({ host: '127.0.0.1', port: server.port, key: KEY });
    const err = await client.devices().catch((e) => e);
    assert.equal(err.code, CODES.HTTP);
    assert.equal(err.status, 302);
    assert.equal(hits, 1);
  } finally {
    await server.close();
  }
});

test('429 carries Retry-After', async () => {
  const server = await serve((req, res) => {
    res.writeHead(429, { 'retry-after': '120' });
    res.end();
  });
  try {
    const client = new FingClient({ host: '127.0.0.1', port: server.port, key: KEY });
    const err = await client.devices().catch((e) => e);
    assert.equal(err.status, 429);
    assert.equal(err.retryAfterMs, 120_000);
    assert.equal(isKeyRefused(err), false);
  } finally {
    await server.close();
  }
});

test('an answer above the cap is cut', async () => {
  const server = await serve((req, res) => {
    res.writeHead(200);
    res.end(Buffer.alloc(2048, 'a'));
  });
  try {
    const err = await httpRequest(
      { host: '127.0.0.1', port: server.port, path: '/1/devices?auth=x' },
      { timeout: 5000, maxBytes: 1024 },
    ).catch((e) => e);
    assert.equal(err.code, CODES.TOO_LARGE);
  } finally {
    await server.close();
  }
});

test('no answer in time; nothing listening; not HTTP: codes, never the URL', async () => {
  const sockets = new Set();
  const keep = (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
  };
  const silent = net.createServer(keep);
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const garbage = net.createServer((socket) => {
    keep(socket);
    socket.end('garbage\r\n\r\n');
  });
  await new Promise((resolve) => garbage.listen(0, '127.0.0.1', resolve));
  // A port where nothing listens: one taken, then given back.
  const spare = net.createServer();
  await new Promise((resolve) => spare.listen(0, '127.0.0.1', resolve));
  const port = spare.address().port;
  await new Promise((resolve) => spare.close(resolve));
  try {
    const path = `/1/devices?auth=${KEY}`;
    const timeout = await httpRequest(
      { host: '127.0.0.1', port: silent.address().port, path },
      { timeout: 200, maxBytes: 1024 },
    ).catch((e) => e);
    assert.equal(timeout.code, CODES.TIMEOUT);
    const bad = await httpRequest(
      { host: '127.0.0.1', port: garbage.address().port, path },
      { timeout: 5000, maxBytes: 1024 },
    ).catch((e) => e);
    assert.equal(bad.code, CODES.BAD_ANSWER);
    const refused = await httpRequest(
      { host: '127.0.0.1', port, path },
      { timeout: 15_000, maxBytes: 1024 },
    ).catch((e) => e);
    assert.equal(refused.code, CODES.UNREACHABLE);
    for (const err of [timeout, bad, refused]) {
      assert.ok(!err.message.includes(KEY), err.message);
      assert.ok(!err.message.includes('127.0.0.1'), err.message);
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    silent.close();
    garbage.close();
  }
});

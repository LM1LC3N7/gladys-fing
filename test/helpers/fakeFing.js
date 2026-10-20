// -----------------------------------------------------------------------------
// A fake Fing Agent local API (in memory, or on loopback through listen()):
// GET /1/devices?auth=<key>. The shapes come from the models of
// fing-agent-pyapi; never checked against a real Fing Agent (TODO.md).
// -----------------------------------------------------------------------------

import http from 'node:http';
import { CODES, FingError } from '../../src/fing/errors.js';

export const KEY = 'fakeFingKey0123456789';

export function fingDevice(mac, name, options = {}) {
  return {
    mac,
    ip: options.ip ?? ['192.168.1.10'],
    state: options.state ?? 'UP',
    name,
    type: options.type ?? 'MOBILE',
    make: options.make ?? 'Apple',
    model: options.model ?? 'iPhone',
    contactId: options.contactId ?? 'contact-1',
    first_seen: '2026-01-10T08:00:00.000Z',
    last_changed: options.last_changed ?? '2026-10-17T07:59:12.000Z',
  };
}

export function createFakeFing() {
  const fake = {
    requests: [],
    networkId: 'net-0001',
    devices: [
      fingDevice('AA:BB:CC:00:00:01', 'Phone of Alice', { ip: ['192.168.1.10'] }),
      fingDevice('AA:BB:CC:00:00:02', 'NAS', {
        ip: ['192.168.1.2', 'fe80::1'],
        type: 'NAS',
        make: 'Synology',
        model: 'DS220+',
      }),
      fingDevice('AA:BB:CC:00:00:03', 'TV', {
        ip: ['192.168.1.30'],
        state: 'DOWN',
        type: 'TELEVISION',
        make: 'LG',
        model: 'OLED',
        last_changed: '2026-10-16T21:30:00.000Z',
      }),
    ],
    /** { status, headers, body } answered once each (FIFO). */
    failures: [],
    unreachable: false,
    /** A promise /1/devices waits for before answering (a slow reading). */
    gate: null,
  };

  const json = (status, value, headers = {}) => ({
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: Buffer.from(JSON.stringify(value)),
  });

  function answer(path) {
    const url = new URL(path, 'http://fing.invalid');
    if (fake.failures.length > 0) {
      const f = fake.failures.shift();
      return {
        status: f.status,
        headers: f.headers ?? {},
        body: Buffer.from(f.body ?? JSON.stringify({ error: 'failure' })),
      };
    }
    if (url.pathname !== '/1/devices') return json(404, { error: 'not found' });
    if (url.searchParams.get('auth') !== KEY) return json(401, { error: 'unauthorized' });
    return json(200, { networkId: fake.networkId, devices: fake.devices });
  }

  /** The transport of src/fing/http.js, in memory. */
  fake.request = async (target, options = {}) => {
    fake.requests.push({ ...target, headers: options.headers ?? {} });
    if (fake.gate) await fake.gate;
    if (fake.unreachable) throw new FingError(CODES.UNREACHABLE, 'ECONNREFUSED');
    return answer(target.path);
  };

  /** The same API on a loopback server: { port, close }. */
  fake.listen = async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        fake.requests.push({ path: req.url, headers: req.headers });
        const result = answer(req.url);
        res.writeHead(result.status, result.headers);
        res.end(result.body);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
      port,
      close: () =>
        new Promise((resolve) => {
          server.closeAllConnections?.();
          server.close(resolve);
        }),
    };
  };

  return fake;
}

// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and the fake Fing Agent,
// through the exact wiring of the container (src/handlers.js).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FingApp } from '../src/app.js';
import { ACTIONS, INTERVALS, SCENE_TRIGGERS } from '../src/constants.js';
import { buildDevice, buildNetworkDevice } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import { KEY, createFakeFing, fingDevice } from './helpers/fakeFing.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const T0 = Date.parse('2026-10-17T08:00:00Z');
const SELECTOR = 'fing';
const ids = createFakeGladys({ selector: SELECTOR });
const PHONE = 'aabbcc000001';
const NAS = 'aabbcc000002';
const TV = 'aabbcc000003';
const device = (mac, name = mac) => buildDevice(ids, { mac, name });
const featureId = (mac, key) => `ext:${SELECTOR}:device:${mac}:${key}`;
const BASE_CONFIG = { host: '192.168.1.5', api_key: KEY };
/** Every spelling of the MAC addresses of the fake: never in a log. */
const MAC_SPELLINGS = ['aabbcc', 'AA:BB:CC', 'aa:bb:cc'];

let running;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function setup({
  config = {},
  created = [PHONE, NAS, TV],
  network = true,
  fing,
  dataDir,
  now = T0,
} = {}) {
  const clock = { now };
  fing ??= createFakeFing();
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { ...BASE_CONFIG, ...config },
    devices: [...created.map((mac) => device(mac)), ...(network ? [buildNetworkDevice(ids)] : [])],
  });
  const timers = createFakeTimers();
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.stack ?? String(a)).join(' ')}`),
    ]),
  );
  const app = new FingApp({
    gladys,
    logger,
    request: fing.request,
    dataDir: dataDir ?? mkdtempSync(join(tmpdir(), 'fing-app-')),
    now: () => clock.now,
    timers,
  });
  running = app;
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  return { gladys, fing, timers, clock, logs, app };
}

const poll = (timers, ms = 60_000) => timers.run((delay) => delay === ms);
const last = (gladys, mac, key) => gladys.fake.lastState(featureId(mac, key));
const fingOf = (fing, mac) =>
  fing.devices.find((d) => d.mac.replaceAll(':', '').toLowerCase() === mac);
/** Emit `connected` again (Gladys came back) and wait for the restart. */
async function reconnect(gladys, app) {
  gladys.emit('connected');
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  await app.queue;
}
function assertClean(logs) {
  const text = logs.join('\n');
  assert.ok(!text.includes(KEY), 'the API key is never logged');
  assert.ok(!text.includes('auth='), 'the URL is never logged');
  for (const mac of MAC_SPELLINGS)
    assert.ok(!text.includes(mac), `a MAC address is logged: ${mac}`);
}

test('start: status, Discovery, states, counts, badges; read every 60 s', async () => {
  const { gladys, fing, timers, logs } = await setup();
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Fing answers: 2 of 3 devices online.',
      fr: 'Fing répond : 2 appareils en ligne sur 3.',
    },
  });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name, d.model]),
    [
      [`ext:${SELECTOR}:network:main`, 'Fing network', 'Fing network'],
      [`ext:${SELECTOR}:device:${PHONE}`, 'Phone of Alice', 'Apple iPhone'],
      [`ext:${SELECTOR}:device:${NAS}`, 'NAS', 'Synology DS220+'],
      [`ext:${SELECTOR}:device:${TV}`, 'TV', 'LG OLED'],
    ],
  );
  assert.equal(last(gladys, PHONE, 'online'), 1);
  assert.equal(last(gladys, TV, 'online'), 0);
  assert.equal(last(gladys, NAS, 'ip'), '192.168.1.2', 'the IPv4 first');
  assert.equal(last(gladys, TV, 'last_change'), '2026-10-16 21:30 UTC');
  assert.equal(gladys.fake.lastState(`ext:${SELECTOR}:network:main:online_count`), 2);
  assert.equal(gladys.fake.lastState(`ext:${SELECTOR}:network:main:total_count`), 3);
  assert.equal(gladys.fake.transports.length, 4);
  assert.ok(gladys.fake.transports.every((t) => t.transport === 'local'));
  assert.deepEqual(timers.delays(), [60_000]);
  assert.deepEqual(fing.requests[0], {
    host: '192.168.1.5',
    port: 49090,
    path: `/1/devices?auth=${KEY}`,
    headers: { 'user-agent': 'gladys-fing/0.1.0' },
  });
  await poll(timers);
  assert.equal(fing.requests.length, 2);
  assert.deepEqual(timers.delays(), [60_000]);
  assertClean(logs);
});

test('nothing but the name, model, IP and dates reaches Gladys (no contact, no network id)', async () => {
  const { gladys } = await setup();
  const sent = JSON.stringify([gladys.fake.states, gladys.fake.discoveredDevices]);
  for (const value of ['contact-1', 'net-0001', 'AA:BB:CC']) {
    assert.ok(!sent.includes(value), value);
  }
});

test('the external id is the MAC address: a rename or a new IP keeps the device', async () => {
  const { gladys, fing, timers } = await setup();
  const before = gladys.fake.discoveredDevices.map((d) => d.external_id);
  fingOf(fing, PHONE).name = 'Alice';
  fingOf(fing, PHONE).ip = ['192.168.1.99'];
  fingOf(fing, PHONE).mac = 'aa-bb-cc-00-00-01';
  await poll(timers);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    before,
  );
  assert.equal(gladys.fake.discoveredDevices[1].name, 'Alice', 'Discovery sent again');
  assert.equal(last(gladys, PHONE, 'ip'), '192.168.1.99');
  assert.equal(gladys.fake.sceneEvents.length, 0, 'not a new device');
});

test('triggers: online, offline, new device; once; never at the first reading; null, never undefined', async () => {
  const { gladys, fing, timers, logs } = await setup();
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first reading fires nothing');
  fingOf(fing, PHONE).state = 'DOWN';
  fingOf(fing, TV).state = 'UP';
  fing.devices.push({ mac: 'AA:BB:CC:00:00:09', state: 'UP' });
  await poll(timers);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data]),
    [
      [
        SCENE_TRIGGERS.DEVICE_OFFLINE,
        {
          device: `ext:${SELECTOR}:device:${PHONE}`,
          device_name: 'Phone of Alice',
          ip: '192.168.1.10',
          vendor: 'Apple',
        },
      ],
      [
        SCENE_TRIGGERS.DEVICE_ONLINE,
        {
          device: `ext:${SELECTOR}:device:${TV}`,
          device_name: 'TV',
          ip: '192.168.1.30',
          vendor: 'LG',
        },
      ],
      [
        SCENE_TRIGGERS.NEW_DEVICE,
        {
          device: `ext:${SELECTOR}:device:aabbcc000009`,
          device_name: 'Unknown device',
          ip: null,
          vendor: null,
        },
      ],
    ],
  );
  assert.equal(last(gladys, PHONE, 'online'), 0);
  await poll(timers);
  assert.equal(gladys.fake.sceneEvents.length, 3, 'once');
  assertClean(logs);
});

test('no event after an outage: the first reading after it is a new start', async () => {
  const { gladys, fing, timers } = await setup();
  fing.unreachable = true;
  await poll(timers);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.ok(gladys.fake.transports.some((t) => t.transport === 'unreachable'));
  fing.unreachable = false;
  fingOf(fing, PHONE).state = 'DOWN';
  await poll(timers);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.sceneEvents.length, 0);
  assert.equal(last(gladys, PHONE, 'online'), 0);
});

test('a refused key stops, is remembered in /data, and is tried again only on save', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'fing-refused-'));
  const fing = createFakeFing();
  fing.failures.push({ status: 401 });
  const { gladys, timers, app, logs } = await setup({ fing, dataDir });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the API key/);
  assert.deepEqual(timers.delays(), [], 'no retry');
  const stored = readFileSync(join(dataDir, 'fing.json'), 'utf8');
  assert.ok(!stored.includes(KEY), 'never the key in /data');
  assert.ok(!stored.includes('aabbcc'), 'never a MAC in /data');
  // A restart (new app, same /data) does not try again.
  await app.stop();
  const again = await setup({ fing, dataDir });
  assert.equal(fing.requests.length, 1);
  assert.match(again.gladys.fake.connectionStatus.message.en, /refused the API key/);
  // A reconnection to Gladys neither.
  await reconnect(again.gladys, again.app);
  assert.equal(fing.requests.length, 1);
  // The test button neither.
  assert.match((await again.gladys.fake.action(ACTIONS.TEST)).error, /refused the API key/);
  assert.equal(fing.requests.length, 1);
  // Saving the configuration does.
  await again.gladys.fake.configUpdated({ ...BASE_CONFIG });
  await again.app.queue;
  assert.equal(fing.requests.length, 2);
  assert.equal(again.gladys.fake.connectionStatus.connected, true);
  assertClean([...logs, ...again.logs]);
});

test('HTTP 429: a bounded pause kept in /data, not lifted by a reconnection nor the button', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'fing-429-'));
  const fing = createFakeFing();
  const { gladys, timers, app, clock } = await setup({ fing, dataDir });
  fing.failures.push({ status: 429, headers: { 'retry-after': '999999' } });
  await poll(timers);
  assert.deepEqual(timers.delays(), [INTERVALS.BUSY_MAX_MS], 'capped at 6 h');
  assert.match(gladys.fake.connectionStatus.message.en, /HTTP 429/);
  const requests = fing.requests.length;
  await reconnect(gladys, app);
  assert.equal(fing.requests.length, requests, 'no request during the pause');
  assert.match(gladys.fake.connectionStatus.message.en, /pause goes on/);
  assert.equal(gladys.fake.discoveredDevices.length, 4, 'Discovery from the last reading');
  assert.equal((await gladys.fake.action(ACTIONS.TEST)).success, false);
  assert.equal(fing.requests.length, requests);
  // A new app on the same /data keeps the pause.
  await app.stop();
  clock.now += 3600_000;
  const again = await setup({ fing, dataDir, now: clock.now });
  assert.equal(fing.requests.length, requests);
  assert.deepEqual(again.timers.delays(), [INTERVALS.BUSY_MAX_MS - 3600_000]);
  await again.timers.run();
  assert.equal(again.gladys.fake.connectionStatus.connected, true);
});

test('a failure is never read again faster than the interval, and the wait doubles', async () => {
  const { gladys, fing, timers, app } = await setup({ config: { poll_interval: '300' } });
  fing.unreachable = true;
  await poll(timers, 300_000);
  assert.deepEqual(timers.delays(), [300_000]);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer: no connection/);
  await timers.run();
  assert.deepEqual(timers.delays(), [600_000]);
  // A reconnection to Gladys waits too.
  const requests = fing.requests.length;
  await reconnect(gladys, app);
  assert.equal(fing.requests.length, requests);
  assert.deepEqual(timers.delays(), [600_000]);
});

test('5xx: paused and kept in /data', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'fing-5xx-'));
  const { gladys, fing, timers } = await setup({ dataDir });
  fing.failures.push({ status: 503 });
  await poll(timers);
  assert.match(gladys.fake.connectionStatus.message.en, /server error \(HTTP 503\)/);
  const stored = JSON.parse(readFileSync(join(dataDir, 'fing.json'), 'utf8'));
  assert.ok(Number(stored.meta['pausedUntil|192.168.1.5:49090']) > T0);
  await timers.run();
  const after = JSON.parse(readFileSync(join(dataDir, 'fing.json'), 'utf8'));
  assert.equal(after.meta['pausedUntil|192.168.1.5:49090'], undefined, 'forgotten once read');
});

test('not the Fing API (404, not JSON, no device list): said, retried', async () => {
  for (const failure of [
    { status: 404 },
    { status: 200, body: '<html></html>' },
    { status: 200, body: '{"devices": 3}' },
  ]) {
    const fing = createFakeFing();
    fing.failures.push(failure);
    const { gladys, timers, app } = await setup({ fing });
    assert.match(gladys.fake.connectionStatus.message.en, /does not answer like the local API/);
    assert.deepEqual(timers.delays(), [60_000]);
    await app.stop();
  }
});

test('every connection to Gladys sends the status and Discovery again', async () => {
  const { gladys, app, fing } = await setup();
  const statuses = gladys.fake.connectionStatuses.length;
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  await reconnect(gladys, app);
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
  assert.equal(gladys.fake.discoveredDevices.length, 4);
  assert.equal(fing.requests.length, 2);
});

test('a configuration that cannot work: said, no request', async () => {
  const cases = [
    [{ host: '' }, /Type the address of the Fing Agent/],
    [{ host: 'https://fing.local' }, /not valid/],
    [{ host: '192.168.1.5/path' }, /not valid/],
    [{ port: 70000 }, /between 1 and 65535/],
    [{ api_key: '' }, /Type the API key/],
    [{ api_key: 'abc​def' }, /invisible character/],
  ];
  for (const [config, message] of cases) {
    const fing = createFakeFing();
    const { gladys, timers, app } = await setup({ fing, config });
    assert.equal(gladys.fake.connectionStatus.connected, false);
    assert.match(gladys.fake.connectionStatus.message.en, message);
    assert.equal(fing.requests.length, 0);
    assert.deepEqual(timers.delays(), []);
    await app.stop();
  }
});

test('a port in the address wins; the port field otherwise', async () => {
  const fing = createFakeFing();
  const { app } = await setup({ fing, config: { host: 'http://fing.local:8080/', port: 49091 } });
  assert.equal(fing.requests[0].host, 'fing.local');
  assert.equal(fing.requests[0].port, 8080);
  await app.stop();
  const other = createFakeFing();
  await setup({ fing: other, config: { port: '49091' } });
  assert.equal(other.requests[0].port, 49091);
});

test('a device published again keeps the features of the created one', async () => {
  const created = device(PHONE);
  created.features.push({
    ...created.features[0],
    name: 'Extra',
    external_id: featureId(PHONE, 'extra'),
  });
  const fing = createFakeFing();
  const gladys = createFakeGladys({ selector: SELECTOR, config: BASE_CONFIG, devices: [created] });
  const app = new FingApp({
    gladys,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    request: fing.request,
    dataDir: mkdtempSync(join(tmpdir(), 'fing-keep-')),
    now: () => T0,
    timers: createFakeTimers(),
  });
  running = app;
  registerHandlers(gladys, app);
  await gladys.connect();
  const phone = gladys.fake.discoveredDevices.find(
    (d) => d.external_id === `ext:${SELECTOR}:device:${PHONE}`,
  );
  assert.ok(phone.features.some((f) => f.external_id === featureId(PHONE, 'extra')));
});

test('read only: a command is refused', async () => {
  const { app } = await setup();
  await assert.rejects(app.setValue(), /only reads Fing/);
});

test('the test button reads again and counts', async () => {
  const { gladys, fing } = await setup();
  const {
    data: { message: answer },
  } = await gladys.fake.action(ACTIONS.TEST);
  assert.deepEqual(answer, {
    en: 'Connected: 2 of 3 devices online. Add the ones to follow from the Discovery tab.',
    fr: 'Connecté : 2 appareils en ligne sur 3. Ajoutez ceux à suivre depuis l’onglet Découverte.',
  });
  assert.equal(fing.requests.length, 2);
});

test('no device yet: said', async () => {
  const fing = createFakeFing();
  fing.devices = [];
  const { gladys } = await setup({ fing });
  assert.match(gladys.fake.connectionStatus.message.en, /lists no device yet/);
});

test('a device created later gets its states at once; a deleted one is forgotten', async () => {
  const { gladys, app } = await setup({ created: [] });
  assert.equal(last(gladys, PHONE, 'online'), undefined);
  await gladys.fake.deviceCreated(device(PHONE));
  assert.equal(last(gladys, PHONE, 'online'), 1);
  await gladys.fake.deviceDeleted(device(PHONE));
  assert.equal(app.published.has(featureId(PHONE, 'online')), false);
});

test('the source never logs the URL, the key or a MAC address', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const name of readdirSync(dir, { recursive: true }).map(String)) {
    if (!name.endsWith('.js')) continue;
    const text = readFileSync(new URL(name.replaceAll('\\', '/'), dir), 'utf8');
    for (const line of text
      .split('\n')
      .filter((l) => /logger\??\.(debug|info|warn|error)/.test(l))) {
      assert.doesNotMatch(line, /\.mac\b|\.key\b|path|url/i, `${name}: ${line.trim()}`);
    }
  }
});

test('Fing answers devices with a broken MAC: left out, no crash', async () => {
  const fing = createFakeFing();
  fing.devices.push({ mac: 'nope', state: 'UP' }, null, 42, { state: 'UP' });
  fing.devices.push(fingDevice('AA:BB:CC:00:00:01', 'Twice'));
  const { gladys } = await setup({ fing });
  assert.equal(gladys.fake.discoveredDevices.length, 4);
});

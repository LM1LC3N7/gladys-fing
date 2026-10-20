import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  formatDate,
  normalizeMac,
  parseDate,
  parseDevices,
  pickIp,
} from '../src/fing/parse.js';

test('normalizeMac: the spellings of a MAC address, one external id', () => {
  for (const value of [
    'AA:BB:CC:DD:EE:0F',
    'aa:bb:cc:dd:ee:0f',
    'aa-bb-cc-dd-ee-0f',
    'aabbccddee0f',
    'aabb.ccdd.ee0f',
    ' AA:BB:CC:DD:EE:0F ',
  ]) {
    assert.equal(normalizeMac(value), 'aabbccddee0f', value);
  }
  for (const value of [
    'aa:bb:cc:dd:ee',
    'aa:bb-cc:dd:ee:ff',
    'gg:bb:cc:dd:ee:ff',
    '00:00:00:00:00:00',
    'FF:FF:FF:FF:FF:FF',
    '',
    null,
    42,
    'a'.repeat(1000),
  ]) {
    assert.equal(normalizeMac(value), null, String(value));
  }
});

test('pickIp: the first IPv4, else the first IPv6', () => {
  assert.equal(pickIp(['fe80::1', '192.168.1.2']), '192.168.1.2');
  assert.equal(pickIp(['FE80::1']), 'fe80::1');
  assert.equal(pickIp('10.0.0.1'), '10.0.0.1');
  assert.equal(pickIp(['999.1.1.1', 'x']), null);
  assert.equal(pickIp(undefined), null);
});

test('parseDate and formatDate', () => {
  assert.equal(formatDate(parseDate('2026-10-17T07:59:12.000Z')), '2026-10-17 07:59 UTC');
  assert.equal(formatDate(parseDate(1_792_224_000)), formatDate(1_792_224_000_000), 'seconds');
  assert.equal(parseDate('1970-01-01T00:00:00Z'), null);
  assert.equal(parseDate('nope'), null);
  assert.equal(parseDate('x'.repeat(100)), null);
  assert.equal(formatDate(null), null);
});

test('cleanText: one printable line, cut', () => {
  assert.equal(cleanText(' a\u0000b​\nc '), 'a b c');
  assert.equal(cleanText('x'.repeat(500)).length, 100);
  assert.equal(cleanText('   '), null);
  assert.equal(cleanText(3), null);
});

test('parseDevices: the answer of /1/devices', () => {
  const parsed = parseDevices({
    networkId: 'n',
    devices: [
      {
        mac: 'AA:BB:CC:00:00:02',
        ip: ['192.168.1.2'],
        state: 'UP',
        name: 'NAS',
        type: 'NAS',
        make: 'Synology',
        model: 'DS220+',
        contactId: 'c',
        last_changed: '2026-10-17T07:59:12.000Z',
      },
      { mac: 'AA:BB:CC:00:00:01', ip: ['192.168.1.9'], state: 'down', make: 'Apple' },
      { mac: 'AA:BB:CC:00:00:03', state: 'SLEEPING', type: 'PRINTER' },
      { mac: 'aa-bb-cc-00-00-02', name: 'twice' },
      { mac: 'broken' },
      null,
      [],
    ],
  });
  assert.equal(parsed.invalid, 3);
  assert.deepEqual(
    parsed.devices.map((d) => [d.mac, d.name, d.ip, d.online]),
    [
      ['aabbcc000001', 'Apple (192.168.1.9)', '192.168.1.9', false],
      ['aabbcc000002', 'NAS', '192.168.1.2', true],
      ['aabbcc000003', 'PRINTER', null, null],
    ],
  );
  assert.equal(parsed.devices[1].vendor, 'Synology');
  assert.equal(parsed.devices[1].model, 'DS220+');
  assert.ok(!('contactId' in parsed.devices[1]), 'the contact is not kept');
  assert.ok(!JSON.stringify(parsed).includes('AA:BB'), 'only the normalized MAC');
});

test('parseDevices: not a list of devices', () => {
  for (const value of [null, [], {}, { devices: {} }, 'x', { devices: 'x' }]) {
    assert.equal(parseDevices(value), null, JSON.stringify(value));
  }
  assert.deepEqual(parseDevices({ devices: [] }), { devices: [], invalid: 0 });
});

test('parseDevices: a hostile answer stays bounded and plain', () => {
  const many = Array.from({ length: 6000 }, (_, i) => ({
    mac: `02:00:00:00:${String(Math.floor(i / 256).toString(16)).padStart(2, '0')}:${(i % 256)
      .toString(16)
      .padStart(2, '0')}`,
    state: 'UP',
  }));
  const parsed = parseDevices({ devices: many });
  assert.equal(parsed.devices.length, 5000, 'read cap');
  const polluted = parseDevices(
    JSON.parse('{"devices":[{"mac":"02:00:00:00:00:01","__proto__":{"online":true},"name":"x"}]}'),
  );
  assert.equal(polluted.devices[0].online, null);
  assert.equal({}.online, undefined);
});

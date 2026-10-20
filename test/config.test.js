import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseHost, parsePort } from '../src/config.js';

test('parseHost: IPv4, host names, IPv6, a pasted http address', () => {
  assert.deepEqual(parseHost('192.168.1.20'), { host: '192.168.1.20', port: null });
  assert.deepEqual(parseHost(' Fing.Local. '), { host: 'fing.local', port: null });
  assert.deepEqual(parseHost('fing-agent:49091'), { host: 'fing-agent', port: 49091 });
  assert.deepEqual(parseHost('[fe80::1]:49090'), { host: 'fe80::1', port: 49090 });
  assert.deepEqual(parseHost('FE80::1'), { host: 'fe80::1', port: null });
  assert.deepEqual(parseHost('http://192.168.1.20:8080/'), { host: '192.168.1.20', port: 8080 });
  assert.deepEqual(parseHost('http://192.168.1.20'), { host: '192.168.1.20', port: null });
});

test('parseHost: refused', () => {
  assert.deepEqual(parseHost(''), { error: 'missing' });
  assert.deepEqual(parseHost(undefined), { error: 'missing' });
  for (const value of [
    'https://192.168.1.20',
    'http://user:pass@192.168.1.20',
    'http://192.168.1.20/1/devices',
    'http://192.168.1.20/?auth=x',
    '192.168.1.300',
    '192.168.1.20/path',
    'host name',
    'fing.local:99999',
    '-bad.example',
    'a'.repeat(400),
    '__proto__',
  ]) {
    assert.ok(parseHost(value).error, value);
  }
});

test('parsePort', () => {
  assert.equal(parsePort(49090), 49090);
  assert.equal(parsePort('49091'), 49091);
  assert.equal(parsePort(''), null);
  assert.equal(parsePort(0), null);
  assert.equal(parsePort(65536), null);
  assert.equal(parsePort(1.5), null);
  assert.equal(parsePort('abc'), null);
});

test('normalizeConfig: defaults, key checks, port priority', () => {
  const empty = normalizeConfig();
  assert.equal(empty.hostError, 'missing');
  assert.equal(empty.port, DEFAULTS.port);
  assert.equal(empty.pollSeconds, 60);
  const config = normalizeConfig({
    host: '10.0.0.2',
    api_key: '  abc  ',
    poll_interval: '300',
    port: 49091,
  });
  assert.equal(config.host, '10.0.0.2');
  assert.equal(config.key, 'abc');
  assert.equal(config.keyInvalid, false);
  assert.equal(config.port, 49091);
  assert.equal(config.pollSeconds, 300);
  assert.equal(normalizeConfig({ poll_interval: '5' }).pollSeconds, 60, 'unknown: default');
  assert.equal(normalizeConfig({ api_key: 'a b' }).keyInvalid, true);
  assert.equal(normalizeConfig({ api_key: 'ab​' }).keyInvalid, true);
  assert.equal(normalizeConfig({ port: 'x' }).portInvalid, true);
  const both = normalizeConfig({ host: 'fing.local:8080', port: 'x' });
  assert.equal(both.port, 8080);
  assert.equal(both.portInvalid, false, 'the port of the address wins');
});

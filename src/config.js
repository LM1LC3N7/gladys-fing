// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { DEFAULT_PORT, POLL_INTERVALS } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = Object.freeze({
  port: DEFAULT_PORT,
  poll_interval: '60',
});

/** What an API key may hold: printable ASCII, no space. */
const KEY_PATTERN = /^[\x21-\x7e]{1,512}$/;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const HOSTNAME =
  /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;
const IPV6 = /^[0-9A-Fa-f:.]{2,45}$/;

/** The port typed by the user: an integer 1-65535, or null. */
export function parsePort(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(text(String(value)));
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

/**
 * The Fing Agent: an IPv4 address, a host name or an IPv6 address
 * (brackets allowed). An `http://host:port` pasted from a browser is read as
 * its host and port. A path, a query, credentials or https are refused.
 *   -> { host, port | null } or { error: 'missing' | 'invalid' }
 */
export function parseHost(value) {
  let raw = text(value);
  if (!raw) return { error: 'missing' };
  if (raw.length > 300) return { error: 'invalid' };
  let port = null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return { error: 'invalid' };
    }
    if (url.protocol !== 'http:') return { error: 'invalid' };
    if (url.username || url.password || url.search || url.hash) return { error: 'invalid' };
    if (url.pathname !== '/' && url.pathname !== '') return { error: 'invalid' };
    port = url.port ? Number(url.port) : null;
    raw = url.hostname;
  } else {
    // host:port (one colon only: an IPv6 address has several).
    const match = /^([^:[\]]+):(\d{1,5})$/.exec(raw) ?? /^\[([^\]]+)\]:(\d{1,5})$/.exec(raw);
    if (match) {
      raw = match[1];
      port = parsePort(match[2]);
      if (port === null) return { error: 'invalid' };
    }
  }
  const host = raw.replace(/^\[(.*)\]$/, '$1');
  if (IPV4.test(host)) {
    if (!host.split('.').every((n) => Number(n) <= 255)) return { error: 'invalid' };
    return { host, port };
  }
  if (host.includes(':')) {
    return IPV6.test(host) ? { host: host.toLowerCase(), port } : { error: 'invalid' };
  }
  return HOSTNAME.test(host)
    ? { host: host.toLowerCase().replace(/\.$/, ''), port }
    : { error: 'invalid' };
}

export function normalizeConfig(raw = {}) {
  raw = raw ?? {};
  const target = parseHost(raw.host);
  const typedPort = parsePort(raw.port);
  const portInvalid =
    raw.port !== undefined && raw.port !== null && raw.port !== '' && typedPort === null;
  const pick = (key, list) => (list.includes(String(raw[key])) ? String(raw[key]) : DEFAULTS[key]);
  const key = typeof raw.api_key === 'string' ? raw.api_key.trim() : '';
  return {
    host: target.error ? null : target.host,
    hostError: target.error ?? null,
    // A port in the address wins over the port field.
    port: target.port ?? typedPort ?? DEFAULTS.port,
    portInvalid: !target.port && portInvalid,
    key,
    // An invisible character pasted with the key: said to the user, never sent.
    keyInvalid: key !== '' && !KEY_PATTERN.test(key),
    pollSeconds: Number(pick('poll_interval', POLL_INTERVALS)),
  };
}

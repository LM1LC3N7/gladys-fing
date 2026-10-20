// -----------------------------------------------------------------------------
// The answer of the local API of a Fing Agent, read into plain objects. Pure.
// Ported from the models of fing-agent-pyapi (Apache-2.0, Fing Ltd: see
// THIRD_PARTY_NOTICES.md): `mac`, `ip` (a list), `state` ("UP" is online),
// `name`, `type`, `make`, `model`, `last_changed`. Never checked against a
// real Fing Agent (TODO.md). The contact of a device (`contactId`) and the
// network id are not kept.
// -----------------------------------------------------------------------------

import { LIMITS } from '../constants.js';

/** Dates before 2000 are not a value of Fing: unknown. */
const MIN_DATE = Date.UTC(2000, 0, 1);
/** Nor after 2200. */
const MAX_DATE = Date.UTC(2200, 0, 1);

/**
 * Control characters, zero-width characters, bidirectional marks and
 * isolates, word joiner and invisible operators, BOM: replaced by a space.
 */
const INVISIBLE = new RegExp(
  `[${[
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0x2028, 0x202e],
    [0x2060, 0x2064],
    [0x2066, 0x2069],
    [0xfeff, 0xfeff],
  ]
    .map(
      ([from, to]) =>
        `\\u${from.toString(16).padStart(4, '0')}-\\u${to.toString(16).padStart(4, '0')}`,
    )
    .join('')}]`,
  'g',
);

/** A printable one-line text, cut to `max`; null when empty. */
export function cleanText(value, max = LIMITS.TEXT_LENGTH) {
  if (typeof value !== 'string') return null;
  // Cut long before the regular expressions: an answer may hold a huge name.
  const text = value.slice(0, max * 4).replace(INVISIBLE, ' ');
  const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return trimmed || null;
}

/**
 * A MAC address as 12 lowercase hexadecimal digits (`aabbccddeeff`), from
 * `AA:BB:CC:DD:EE:FF`, `aa-bb-cc-dd-ee-ff` or `aabb.ccdd.eeff`; null when it
 * is not one, or is the null or broadcast address. Never logged.
 */
export function normalizeMac(value) {
  if (typeof value !== 'string' || value.length > 20) return null;
  const raw = value.trim();
  if (!/^[0-9A-Fa-f]{2}([:-]?)[0-9A-Fa-f]{2}(\1[0-9A-Fa-f]{2}){4}$/.test(raw)) {
    if (!/^[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}$/.test(raw)) return null;
  }
  const hex = raw.replace(/[:.-]/g, '').toLowerCase();
  if (hex === '000000000000' || hex === 'ffffffffffff') return null;
  return hex;
}

/** An IPv4 or IPv6 address as text; null otherwise. */
export function parseIp(value) {
  if (typeof value !== 'string' || value.length > 45) return null;
  const ip = value.trim();
  if (/^(\d{1,3})(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every((n) => Number(n) <= 255)) {
    return ip;
  }
  if (/^[0-9a-f:.]{2,45}$/i.test(ip) && ip.includes(':')) return ip.toLowerCase();
  return null;
}

/** The address shown for a device: the first IPv4 of the list, else the first IPv6. */
export function pickIp(value) {
  const list = (Array.isArray(value) ? value.slice(0, 16) : [value]).map(parseIp).filter(Boolean);
  return list.find((ip) => !ip.includes(':')) ?? list[0] ?? null;
}

/** A date in ms within [2000, 2200), else null (never a value `new Date` refuses). */
const inRange = (ms) => (Number.isFinite(ms) && ms >= MIN_DATE && ms < MAX_DATE ? ms : null);

export function parseDate(value) {
  if (typeof value === 'number') {
    // Seconds or milliseconds since 1970; anything larger (micro- or
    // nanoseconds, 1e300) is not a date of Fing: unknown.
    if (!Number.isFinite(value) || value < 0 || value >= 1e14) return null;
    return inRange(value < 1e11 ? value * 1000 : value);
  }
  if (typeof value !== 'string' || value.length > 64) return null;
  return inRange(Date.parse(value));
}

/**
 * Text that holds a MAC address (`aa:bb:…`, `aa-bb-…`, `aabb.ccdd.eeff` or
 * 12 hex digits in a row): Fing names an unknown device by its MAC address.
 */
const MAC_IN_TEXT =
  /(^|[^0-9a-f])([0-9a-f]{2}[:-]){5}[0-9a-f]{2}([^0-9a-f]|$)|(^|[^0-9a-f])[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}([^0-9a-f]|$)|(^|[^0-9a-f])[0-9a-f]{12}([^0-9a-f]|$)/i;

/** A clean text that never holds a MAC address (null when it does). */
export function cleanLabel(value, max) {
  const text = cleanText(value, max);
  return text && MAC_IN_TEXT.test(text) ? null : text;
}

/** `UP` is online, `DOWN` offline (any case); anything else is unknown. */
function parseState(value) {
  if (typeof value !== 'string') return null;
  const state = value.trim().toUpperCase();
  if (state === 'UP') return true;
  if (state === 'DOWN') return false;
  return null;
}

function parseDevice(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const mac = normalizeMac(raw.mac);
  if (!mac) return null;
  const ip = pickIp(raw.ip);
  const vendor = cleanLabel(raw.make, 60);
  const model = cleanLabel(raw.model, 60);
  const type = cleanLabel(raw.type, 40);
  const product = [vendor, model].filter(Boolean).join(' ') || null;
  const fallback = product ?? type ?? 'Unknown device';
  return {
    mac,
    // A device the user never named in Fing: its vendor and model, or its
    // type, with its IP (never its MAC address: a name that holds one is
    // replaced the same way).
    name: cleanLabel(raw.name) ?? (ip ? `${fallback} (${ip})` : fallback),
    ip,
    online: parseState(raw.state),
    type,
    vendor,
    model,
    lastChange: parseDate(raw.last_changed),
  };
}

/**
 * GET /1/devices -> { devices: [...], invalid } sorted by MAC, or null when
 * the answer is not `{ devices: [...] }`. A device without a usable MAC is
 * left out (counted in `invalid`); a MAC seen twice is merged, whatever the
 * order of the answer (see mergeDevices). At most LIMITS.DEVICES_READ
 * entries are read.
 */
export function parseDevices(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (!Array.isArray(json.devices)) return null;
  const byMac = new Map();
  let invalid = 0;
  for (const raw of json.devices.slice(0, LIMITS.DEVICES_READ)) {
    const device = parseDevice(raw);
    if (!device) invalid += 1;
    else
      byMac.set(
        device.mac,
        byMac.has(device.mac) ? mergeDevices(byMac.get(device.mac), device) : device,
      );
  }
  const devices = [...byMac.values()].sort((a, b) => (a.mac < b.mac ? -1 : a.mac > b.mac ? 1 : 0));
  return { devices, invalid };
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Two entries of one MAC address, merged the same way in any order: online
 * when one is online (offline when one is, unknown otherwise), the latest
 * last change, and the other fields of the entry changed last (then the
 * online one, then the smaller in text order).
 */
export function mergeDevices(a, b) {
  const rank =
    compare(b.lastChange ?? -1, a.lastChange ?? -1) ||
    compare(b.online === true ? 1 : 0, a.online === true ? 1 : 0) ||
    compare(JSON.stringify(a), JSON.stringify(b));
  const primary = rank <= 0 ? a : b;
  const states = [a.online, b.online];
  const lastChanges = [a.lastChange, b.lastChange].filter((v) => v !== null);
  return {
    ...primary,
    online: states.includes(true) ? true : states.includes(false) ? false : null,
    lastChange: lastChanges.length > 0 ? Math.max(...lastChanges) : null,
  };
}

/** `2026-10-17 08:00 UTC`: the dates published as texts (no time zone guess). */
export function formatDate(ms) {
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

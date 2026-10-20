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

export function parseDate(value) {
  if (typeof value === 'number') {
    // Seconds or milliseconds since 1970.
    const ms = value < 1e11 ? value * 1000 : value;
    return Number.isFinite(ms) && ms >= MIN_DATE ? ms : null;
  }
  if (typeof value !== 'string' || value.length > 64) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= MIN_DATE ? ms : null;
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
  const vendor = cleanText(raw.make, 60);
  const model = cleanText(raw.model, 60);
  const type = cleanText(raw.type, 40);
  const product = [vendor, model].filter(Boolean).join(' ') || null;
  const fallback = product ?? type ?? 'Unknown device';
  return {
    mac,
    // A device the user never named in Fing: its vendor and model, or its
    // type, with its IP (never its MAC address).
    name: cleanText(raw.name) ?? (ip ? `${fallback} (${ip})` : fallback),
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
 * left out (counted in `invalid`); a MAC seen twice is kept once. At most
 * LIMITS.DEVICES_READ entries are read.
 */
export function parseDevices(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (!Array.isArray(json.devices)) return null;
  const byMac = new Map();
  let invalid = 0;
  for (const raw of json.devices.slice(0, LIMITS.DEVICES_READ)) {
    const device = parseDevice(raw);
    if (!device) invalid += 1;
    else if (!byMac.has(device.mac)) byMac.set(device.mac, device);
  }
  const devices = [...byMac.values()].sort((a, b) => (a.mac < b.mac ? -1 : a.mac > b.mac ? 1 : 0));
  return { devices, invalid };
}

/** `2026-10-17 08:00 UTC`: the dates published as texts (no time zone guess). */
export function formatDate(ms) {
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

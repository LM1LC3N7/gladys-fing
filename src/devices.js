// -----------------------------------------------------------------------------
// Gladys devices (pure).
//
//   device   `ext:<selector>:device:<MAC, 12 lowercase hex digits>`
//            one per device Fing knows: online (read only, binary), IP and
//            last change (texts)
//   network  `ext:<selector>:network:main`
//            the network the Fing Agent watches: devices online, in total
//
// The MAC address is what Fing keys a device on: it does not change when the
// device is renamed in Fing or gets another IP, so the external id uses it.
// It is never logged.
//
// A device published again never loses a feature: the core would mark it
// `structure_changed`, and "Update" would drop the history of the missing
// one. The features of the device created in Gladys (`gladys.devices`, kept
// up to date by the SDK) are added back when the blueprint lacks them.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE, FEATURES, NETWORK_ID, NETWORK_TYPE } from './constants.js';

/** A MAC address as kept by src/fing/parse.js. */
export const MAC_PATTERN = /^[0-9a-f]{12}$/;

export const deviceIds = (gladys, mac) => gladys.externalIds(DEVICE_TYPE, mac);
export const networkIds = (gladys) => gladys.externalIds(NETWORK_TYPE, NETWORK_ID);

const readOnly = (extra) => ({ read_only: true, has_feedback: false, ...extra });

// Never a switch: the core hands every switch to the voice assistants, MCP
// and the switch scene actions. Read-only `unknown`/`binary`.
const binary = (externalId, name) => ({
  name,
  external_id: externalId,
  ...readOnly({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 }),
  keep_history: true,
});

const text = (externalId, name) => ({
  name,
  external_id: externalId,
  ...readOnly({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0 }),
  keep_history: false,
});

/** The features of the created device the blueprint lacks, appended (never fewer). */
export function withCreatedFeatures(gladys, device, devices = gladys.devices) {
  const created = (devices ?? []).find((d) => d?.external_id === device.external_id);
  if (!created) return device;
  const known = new Set(device.features.map((f) => f.external_id));
  const extra = (created.features ?? []).filter(
    (f) => f && typeof f.external_id === 'string' && !known.has(f.external_id),
  );
  if (extra.length === 0) return device;
  return { ...device, features: [...device.features, ...extra] };
}

/** The model shown in Gladys: vendor and model, or the type Fing recognized. */
const modelOf = (device) =>
  [device.vendor, device.model].filter(Boolean).join(' ') || device.type || 'Fing device';

/** @param {{ mac: string, name: string, vendor?: string, model?: string, type?: string }} device */
export function buildDevice(gladys, device) {
  const ids = deviceIds(gladys, device.mac);
  return withCreatedFeatures(gladys, {
    name: device.name,
    external_id: ids.device,
    model: modelOf(device),
    should_poll: false,
    features: [
      binary(ids.feature(FEATURES.ONLINE), 'Online'),
      text(ids.feature(FEATURES.IP), 'IP address'),
      text(ids.feature(FEATURES.LAST_CHANGE), 'Last change'),
    ],
  });
}

export function buildNetworkDevice(gladys) {
  const ids = networkIds(gladys);
  const counter = (key, name) => ({
    name,
    external_id: ids.feature(key),
    ...readOnly({ category: C.COUNTER_SENSOR, type: T.SENSOR.INTEGER, min: 0, max: 100_000 }),
    keep_history: true,
  });
  return withCreatedFeatures(gladys, {
    name: 'Fing network',
    external_id: ids.device,
    model: 'Fing network',
    should_poll: false,
    features: [
      counter(FEATURES.ONLINE_COUNT, 'Devices online'),
      counter(FEATURES.TOTAL_COUNT, 'Devices'),
    ],
  });
}

/**
 * What a device or feature external id of this integration designates:
 * { kind: 'device', mac, feature } | { kind: 'network', feature } | null.
 */
export function parseExternalId(gladys, externalId) {
  if (typeof externalId !== 'string' || externalId.length > 200) return null;
  const devicePrefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (externalId.startsWith(devicePrefix)) {
    const [mac, feature, ...rest] = externalId.slice(devicePrefix.length).split(':');
    if (rest.length > 0 || !MAC_PATTERN.test(mac ?? '')) return null;
    return { kind: 'device', mac, feature: feature ?? null };
  }
  const networkPrefix = gladys.externalId(`${NETWORK_TYPE}:`);
  if (externalId.startsWith(networkPrefix)) {
    const [id, feature, ...rest] = externalId.slice(networkPrefix.length).split(':');
    if (rest.length > 0 || id !== NETWORK_ID) return null;
    return { kind: 'network', feature: feature ?? null };
  }
  return null;
}

/** The created devices of this integration: { devices: [...], network: entry | null }. */
export function createdDevices(gladys, devices = gladys.devices) {
  const list = [];
  let network = null;
  for (const device of devices ?? []) {
    const parsed = parseExternalId(gladys, device?.external_id);
    if (!parsed || parsed.feature !== null) continue;
    const entry = { ...parsed, externalId: device.external_id };
    if (parsed.kind === 'device') list.push(entry);
    else network = entry;
  }
  return { devices: list, network };
}

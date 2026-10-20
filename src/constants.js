// -----------------------------------------------------------------------------
// Keys, limits and timings. The manifest keys, the trigger keys and the
// external id shapes are stored in user scenes and devices: never rename them
// (test/manifest.test.js ties them to the manifest).
// -----------------------------------------------------------------------------

export const ACTIONS = Object.freeze({
  TEST: 'test_connection',
});

export const SCENE_TRIGGERS = Object.freeze({
  DEVICE_ONLINE: 'device_online',
  DEVICE_OFFLINE: 'device_offline',
  NEW_DEVICE: 'new_device',
});

/**
 * Device external ids: `ext:<selector>:device:<MAC, 12 lowercase hex digits>`.
 * The MAC address is what Fing keys a device on: it does not change when the
 * device is renamed or gets another IP.
 */
export const DEVICE_TYPE = 'device';
/** `ext:<selector>:network:main`: the network the Fing Agent watches. */
export const NETWORK_TYPE = 'network';
export const NETWORK_ID = 'main';

export const FEATURES = Object.freeze({
  ONLINE: 'online',
  IP: 'ip',
  LAST_CHANGE: 'last_change',
  ONLINE_COUNT: 'online_count',
  TOTAL_COUNT: 'total_count',
});

/** The port of the local API of a Fing Agent or Fingbox. */
export const DEFAULT_PORT = 49090;

/** Seconds between two readings of the devices. */
export const POLL_INTERVALS = Object.freeze(['60', '120', '300', '600']);

/** Caps: what is read, published and fired. */
export const LIMITS = Object.freeze({
  /** Devices read from one answer (the rest is ignored). */
  DEVICES_READ: 5000,
  /** Devices followed (Discovery, states, triggers). */
  DEVICES: 500,
  /** Scene events sent in one reading (a whole network going down sends no flood). */
  EVENTS_PER_ROUND: 30,
  /**
   * POST /state admits 300 states per minute per integration: this
   * integration keeps under 250, the texts (IP, last change) being dropped
   * first.
   */
  STATES_PER_MINUTE: 250,
  /** A text published to Gladys (a name, a vendor) is cut to this length. */
  TEXT_LENGTH: 100,
});

export const TIMEOUTS = Object.freeze({
  /** A Fing Agent lists its devices from memory; a slow box gets 20 s. */
  API: 20_000,
});

export const INTERVALS = Object.freeze({
  /** A failure (network, 5xx) is retried after max(this, the poll interval), doubling. */
  RETRY_MIN_MS: 60_000,
  RETRY_MAX_MS: 30 * 60_000,
  /** HTTP 429: pause of every request, within these bounds (Retry-After if given). */
  BUSY_MIN_MS: 60_000,
  BUSY_MAX_MS: 6 * 3600_000,
});

/** Size cap of the answer read from the Fing Agent. */
export const MAX_BYTES = Object.freeze({
  DEVICES: 8 * 1024 * 1024,
});

/** The persistent store (refusals, pause: see src/store.js). */
export const STORE_FILE = 'fing.json';

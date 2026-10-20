// -----------------------------------------------------------------------------
// FingApp: the integration. One Fing Agent (or Fingbox), the devices of its
// network. Read only.
//
//   start(config)  (re)connects: the devices read, Discovery published, the
//                  loop started
//   loop           every `poll_interval` s (60 by default): GET /1/devices
//                  -> online, IP, last change, the counts of the network,
//                  and the triggers `device_online`, `device_offline`,
//                  `new_device`
//   failures       an API key refused (401 / 403) stops everything until the
//                  configuration is saved; HTTP 429 and 5xx pause every
//                  request (bounded, kept in /data); anything else is
//                  retried, never faster than the poll interval, doubling up
//                  to 30 min
//
// The loop is one chain of timers: halt() bumps an epoch, and a run of an
// older epoch (still in flight when Fing failed) never schedules itself
// again. Neither the API key, nor the URL (it holds the key), nor a MAC
// address is ever logged.
// -----------------------------------------------------------------------------

import { createHash, createHmac } from 'node:crypto';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { Budget } from './budget.js';
import { normalizeConfig } from './config.js';
import { FEATURES, INTERVALS, LIMITS, SCENE_TRIGGERS, STORE_FILE } from './constants.js';
import {
  buildDevice,
  buildNetworkDevice,
  createdDevices,
  deviceIds,
  networkIds,
} from './devices.js';
import { T } from './i18n.js';
import { Store } from './store.js';
import { FingClient } from './fing/client.js';
import { CODES, isKeyRefused } from './fing/errors.js';
import { httpRequest } from './fing/http.js';
import { formatDate } from './fing/parse.js';

/** The "Test the connection" button waits 30 s: answer before. */
const TEST_BUDGET_MS = 25_000;
/** Entries per publishTransports call (the SDK refuses more). */
export const TRANSPORTS_PER_CALL = 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
/** The value of a state entry, number or text, as one comparable key. */
const valueOf = (s) => (s.text !== undefined ? `t:${s.text}` : `s:${s.state}`);
/** A scene variable: a string, or null (never undefined, never NaN). */
const orNull = (value) => (typeof value === 'string' && value ? value : null);

export class FingApp {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {object} [options.logger]
   * @param {Function} [options.request] the HTTP transport (tests inject a fake Fing)
   * @param {string} [options.dataDir] the writable volume
   * @param {() => number} [options.now]
   * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
   */
  constructor({
    gladys,
    logger = createLogger({ name: 'fing' }),
    request = httpRequest,
    dataDir = process.env.DATA_DIR ?? '/data',
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.request = request;
    this.now = now;
    this.timers = timers;
    this.store = new Store({ filePath: join(dataDir, STORE_FILE), logger });
    this.budget = new Budget({ perMinute: LIMITS.STATES_PER_MINUTE, now });
    this.rawConfig = {};
    this.config = normalizeConfig();
    this.client = null;
    this.generation = 0;
    this.epoch = 0;
    this.handles = new Set();
    this.queue = Promise.resolve();
    this.lastStatus = null;
    /**
     * The last devices read, with the agent and key they belong to: kept
     * across a restart of the app (a reconnection to Gladys during a pause
     * republishes Discovery from them). In memory only.
     */
    this.known = null;
    /**
     * After a failed reading: { key (HMAC of address and API key), at,
     * delay, message }, kept across a restart of the app so that a
     * reconnection to Gladys does not skip the wait. In memory only.
     */
    this.retryWait = null;
    /** Values last accepted by Gladys (feature -> value), to budget only changes. */
    this.published = new Map();
    /** Where the next cut of the texts starts (they take turns under the budget). */
    this.textCursor = 0;
    /** The reading in flight: one at a time (loop, Discovery). */
    this.reading = null;
    this.reset();
  }

  reset() {
    this.online = false;
    this.blocked = false;
    this.pausedUntil = 0;
    this.retryDelay = this.minRetry();
    /** mac -> device, the followed devices of the last reading. */
    this.devices = new Map();
    /** Devices above the cap of LIMITS.DEVICES. */
    this.capped = 0;
    this.counts = null;
    /** A reading to compare with: false at start and after any failure (no event then). */
    this.baseline = false;
    this.discoveredKey = null;
    this.transports = new Map();
    this.published.clear();
  }

  /** A failure is never read again faster than the poll interval. */
  minRetry() {
    return Math.max(INTERVALS.RETRY_MIN_MS, (this.config?.pollSeconds ?? 60) * 1000);
  }

  pollMs() {
    return this.config.pollSeconds * 1000;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Run `task` after every start / restart already queued. */
  enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * (Re)start with a configuration. Calls are serialized. `force`: the user
   * saved the configuration: a key refused earlier is tried again.
   * `immediate`: read now even within the retry wait of a failure (the test
   * button); neither lifts a pause asked by the Fing Agent.
   */
  start(rawConfig, { force = false, immediate = false } = {}) {
    return this.enqueue(() => this.run(rawConfig, { force, immediate }));
  }

  /** `host:port` of the agent: the key of its refusal and of its pause. */
  agentKey(config = this.config) {
    return `${config.host}:${config.port}`;
  }

  /** The values a refusal is about (HMAC with the salt of /data: never the key). */
  async refusalKey(config) {
    return createHmac('sha256', await this.store.salt())
      .update(JSON.stringify([this.agentKey(config), config.key]))
      .digest('hex');
  }

  /**
   * What the known devices belong to: the agent and a SHA-256 fingerprint of
   * the API key (never the key itself; in memory only), so that another
   * agent never shows the devices of the previous one.
   */
  knownKey(config) {
    return JSON.stringify([
      this.agentKey(config),
      createHash('sha256')
        .update(config.key ?? '')
        .digest('hex'),
    ]);
  }

  async stop() {
    this.generation += 1;
    this.halt();
    this.dropClient();
  }

  /** Clear every timer; the runs still in flight will not schedule again. */
  halt() {
    this.epoch += 1;
    for (const handle of this.handles) this.timers.clearTimeout(handle);
    this.handles.clear();
  }

  dropClient() {
    this.client?.close();
    this.client = null;
  }

  async run(rawConfig, { force = false, immediate = false } = {}) {
    this.halt();
    this.dropClient();
    const generation = ++this.generation;
    this.rawConfig = rawConfig ?? {};
    const config = normalizeConfig(rawConfig);
    this.config = config;
    this.reset();
    // The core keeps the status and Discovery in memory: a start (a
    // reconnection to Gladys included) always sends them again.
    this.lastStatus = null;
    if (this.known && this.known.key !== this.knownKey(config)) this.known = null;
    await this.store.load();

    if (config.hostError) {
      await this.stopWith(
        config.hostError === 'missing' ? T.status.hostMissing : T.status.hostInvalid,
      );
      return;
    }
    if (config.portInvalid) {
      await this.stopWith(T.status.portInvalid);
      return;
    }
    if (!config.key) {
      await this.stopWith(T.status.missingKey);
      return;
    }
    if (config.keyInvalid) {
      await this.stopWith(T.status.keyInvalid);
      return;
    }
    // A key the agent refused with these very values is not tried again
    // before the configuration is saved.
    const agent = this.agentKey(config);
    const refused = this.store.get('refusals', agent);
    if (refused && refused === (await this.refusalKey(config)) && !force) {
      this.blocked = true;
      this.logger.warn('API key refused earlier: not tried again');
      await this.stopWith(T.status.keyRefused);
      return;
    }
    if (refused) await this.store.set('refusals', agent, null);
    this.client = new FingClient({
      host: config.host,
      port: config.port,
      key: config.key,
      request: this.request,
    });
    this.logger.info(`Using the local API of the Fing Agent at ${config.host}:${config.port}`);
    // A pause (HTTP 429 or 5xx) outlives a restart, a reconnection to Gladys
    // and a saved configuration; its end is capped (a clock jump, a file
    // written by hand).
    const stored = Number(this.store.get('meta', this.pauseKey())) || 0;
    const pausedUntil = Math.min(stored, this.now() + INTERVALS.BUSY_MAX_MS);
    // The capped end is written back: the next reading of the file (another
    // restart) does not cap from a later "now" again.
    if (pausedUntil < stored) await this.store.set('meta', this.pauseKey(), String(pausedUntil));
    if (this.now() < pausedUntil) {
      this.pausedUntil = pausedUntil;
      const delay = pausedUntil - this.now();
      await this.restoreKnown();
      await this.publishTransports();
      await this.setStatus(false, T.status.paused(delay));
      this.schedule(delay, () => this.connect(generation));
      return;
    }
    // After a failed reading, a reconnection to Gladys waits for the retry
    // like the loop would (never faster than the interval); the button and
    // a saved configuration read at once.
    const waiting = this.retryWait;
    if (!force && !immediate && waiting?.key === (await this.refusalKey(config))) {
      if (this.now() < waiting.at) {
        this.retryDelay = waiting.delay;
        await this.restoreKnown();
        await this.publishTransports();
        await this.setStatus(false, waiting.message);
        this.schedule(waiting.at - this.now(), () => this.connect(generation));
        return;
      }
      this.retryDelay = waiting.delay;
    }
    await this.connect(generation);
  }

  /** Discovery again from the devices of the last reading (a pause, a wait). */
  async restoreKnown() {
    if (!this.known) return;
    for (const device of this.known.devices) this.devices.set(device.mac, device);
    await this.publishDiscovered();
  }

  pauseKey() {
    return `pausedUntil|${this.agentKey()}`;
  }

  /** Stopped before any request (configuration, refused key): status and badges. */
  async stopWith(message) {
    await this.publishTransports();
    await this.setStatus(false, message);
  }

  schedule(delay, task) {
    const handle = this.timers.setTimeout(async () => {
      this.handles.delete(handle);
      try {
        await task();
      } catch (err) {
        this.logger.error(`Loop failed: ${err?.message}`);
      }
    }, delay);
    this.handles.add(handle);
    return handle;
  }

  /** Schedule the next reading of the current epoch. */
  scheduleLoop(delay, generation) {
    const epoch = this.epoch;
    this.schedule(delay, () => this.loop(generation, epoch));
  }

  /** May a loop of this generation and epoch schedule its next run? */
  current(generation, epoch) {
    return generation === this.generation && epoch === this.epoch && !this.blocked;
  }

  /** The first reading, then the loop. Never throws. */
  async connect(generation) {
    const client = this.client;
    if (!client || generation !== this.generation) return;
    try {
      await this.refresh({ publish: true });
      if (generation !== this.generation) return;
      this.logger.info(`Fing answers: ${this.devices.size} device(s) followed`);
    } catch (err) {
      await this.failed(err, generation);
      return;
    }
    this.scheduleLoop(this.pollMs(), generation);
  }

  async loop(generation, epoch) {
    if (!this.current(generation, epoch)) return;
    if (this.reading) {
      // A Discovery reading is in flight: it is this round's (its failure
      // takes its own path).
      await this.reading.catch(() => {});
      if (this.current(generation, epoch)) this.scheduleLoop(this.pollMs(), generation);
      return;
    }
    try {
      await this.refresh({ publish: false });
    } catch (err) {
      if (this.current(generation, epoch)) await this.failed(err, generation);
      return;
    }
    if (this.current(generation, epoch)) this.scheduleLoop(this.pollMs(), generation);
  }

  /** A reading failed: final refusal, a pause, or a retry with a growing delay. */
  async failed(err, generation) {
    if (generation !== this.generation) return;
    const wasOnline = this.online;
    this.online = false;
    // After an outage, the first reading is a new start: no event.
    this.baseline = false;
    this.halt();
    await this.publishTransports();
    if (isKeyRefused(err)) {
      this.blocked = true;
      await this.store.set('refusals', this.agentKey(), await this.refusalKey(this.config));
      this.logger.warn(
        `API key refused by the Fing Agent (HTTP ${err.status}): not retried until the configuration is saved`,
      );
      await this.setStatus(false, T.status.keyRefused);
      return;
    }
    let delay = this.retryDelay;
    let pause = false;
    if (err?.status === 429) {
      // Too many requests: a bounded pause of every path.
      delay = clamp(
        err.retryAfterMs ?? INTERVALS.BUSY_MIN_MS,
        Math.max(INTERVALS.BUSY_MIN_MS, this.pollMs()),
        INTERVALS.BUSY_MAX_MS,
      );
      pause = true;
    } else {
      if (err?.status >= 500) {
        delay = clamp(err.retryAfterMs ?? delay, delay, INTERVALS.BUSY_MAX_MS);
        pause = true;
      }
      this.retryDelay = Math.min(this.retryDelay * 2, INTERVALS.RETRY_MAX_MS);
    }
    if (pause) {
      this.pausedUntil = this.now() + delay;
      await this.store.set('meta', this.pauseKey(), String(this.pausedUntil));
    }
    if (wasOnline || delay === this.minRetry() || pause) {
      // A FingError message never holds the URL, the key nor a MAC address;
      // anything else is reduced to its code.
      const what = err?.name === 'FingError' ? err.message : String(err?.code ?? 'error');
      this.logger.warn(`The Fing Agent fails: ${what}`);
    }
    const message = this.errorMessage(err, delay);
    this.retryWait = {
      key: await this.refusalKey(this.config),
      at: this.now() + delay,
      delay: this.retryDelay,
      message,
    };
    if (generation !== this.generation) return;
    await this.setStatus(false, message);
    this.schedule(delay, () => this.connect(generation));
  }

  errorMessage(err, delay) {
    if (err?.status === 429) return T.status.busy(delay);
    if (err?.status >= 500) return T.status.serverError(err.status, delay);
    if (err?.code === CODES.BAD_ANSWER || err?.code === CODES.HTTP) {
      return T.status.notFing(delay);
    }
    return T.status.unreachable(err, delay);
  }

  paused() {
    return this.now() < this.pausedUntil;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys.setConnectionStatus(connected, message).catch((err) => {
      this.lastStatus = null;
      this.logger.warn(`Connection status not sent: ${err.message}`);
    });
  }

  // --- Reading -----------------------------------------------------------------

  /** Read the devices, publish them. Throws when they cannot be read. */
  refresh(options) {
    const reading = this.read(options).finally(() => {
      if (this.reading === reading) this.reading = null;
    });
    this.reading = reading;
    return reading;
  }

  async read({ publish }) {
    const client = this.client;
    if (!client) return;
    const { devices: all } = await client.devices();
    if (client !== this.client) return;
    // A pause asked earlier is over (the reading worked): forget it.
    if (this.store.get('meta', this.pauseKey())) {
      await this.store.set('meta', this.pauseKey(), null);
    }
    this.pausedUntil = 0;

    const followed = all.slice(0, LIMITS.DEVICES);
    const events = [];
    if (this.baseline) {
      for (const device of followed) {
        const was = this.devices.get(device.mac);
        if (!was) {
          // A MAC address Fing did not list at the previous reading.
          events.push([SCENE_TRIGGERS.NEW_DEVICE, device]);
          continue;
        }
        if (was.online === false && device.online === true) {
          events.push([SCENE_TRIGGERS.DEVICE_ONLINE, device]);
        }
        if (was.online === true && device.online === false) {
          events.push([SCENE_TRIGGERS.DEVICE_OFFLINE, device]);
        }
      }
    }
    this.devices = new Map(followed.map((device) => [device.mac, device]));
    this.capped = all.length - followed.length;
    this.counts = {
      total: all.length,
      online: all.filter((device) => device.online === true).length,
    };
    this.baseline = true;
    this.online = true;
    this.retryDelay = this.minRetry();
    this.retryWait = null;
    this.known = { key: this.knownKey(this.config), devices: followed, at: this.now() };

    const discoveredKey = JSON.stringify(
      followed.map((d) => [d.mac, d.name, d.vendor, d.model, d.type]),
    );
    if (publish || discoveredKey !== this.discoveredKey) await this.publishDiscovered();
    this.discoveredKey = discoveredKey;
    await this.publishDeviceStates();
    await this.publishTransports();
    for (const [key, device] of events.slice(0, LIMITS.EVENTS_PER_ROUND)) {
      await this.fire(key, device);
    }
    if (events.length > LIMITS.EVENTS_PER_ROUND) {
      this.logger.warn(`${events.length - LIMITS.EVENTS_PER_ROUND} device event(s) not sent`);
    }
    await this.setStatus(true, this.okMessage());
  }

  okMessage() {
    if (!this.counts || this.counts.total === 0) return T.status.noDevice;
    return T.status.ok({ ...this.counts, capped: this.capped });
  }

  /** Every value a string or null: never undefined, never NaN. */
  async fire(key, device) {
    await this.gladys
      .publishSceneEvent(key, {
        device: deviceIds(this.gladys, device.mac).device,
        device_name: orNull(device.name),
        ip: orNull(device.ip),
        vendor: orNull(device.vendor),
      })
      .catch((err) => {
        this.logger.warn(`Scene event not sent: ${err.message}`);
      });
  }

  /** Never throws: a refusal of Gladys is not a Fing failure. */
  async publishDiscovered() {
    const devices = [buildNetworkDevice(this.gladys)];
    for (const device of this.devices.values()) devices.push(buildDevice(this.gladys, device));
    await this.gladys.publishDiscoveredDevices(devices).catch((err) => {
      this.logger.warn(`Discovery not published: ${err.message}`);
    });
  }

  /** Discovery (scan button): read again when connected, else what is known. */
  async publishDiscovery() {
    if (this.reading) {
      // A reading is in flight: no second request, publish what it brings.
      await this.reading.catch(() => {});
      await this.publishDiscovered();
      return;
    }
    if (this.online && !this.paused() && this.client) {
      const generation = this.generation;
      const done = await this.refresh({ publish: true }).then(
        () => true,
        async (err) => {
          if (generation !== this.generation) return true;
          // Any failure takes the usual path (refusal, pause, retry).
          await this.failed(err, generation);
          return false;
        },
      );
      if (done) return;
    }
    if (this.devices.size === 0 && this.known) {
      for (const device of this.known.devices) this.devices.set(device.mac, device);
    }
    await this.publishDiscovered();
  }

  /**
   * The states of the created devices, in three groups by priority: the
   * counts, online, the texts (IP, last change). A created device missing
   * from the reading (forgotten by Fing) gets nothing.
   */
  statesOf() {
    const created = createdDevices(this.gladys);
    const counts = [];
    const online = [];
    const texts = [];
    for (const { mac } of created.devices) {
      const device = this.devices.get(mac);
      if (!device) continue;
      const ids = deviceIds(this.gladys, mac);
      if (device.online !== null) {
        online.push({
          device_feature_external_id: ids.feature(FEATURES.ONLINE),
          state: device.online ? 1 : 0,
        });
      }
      const values = [
        [FEATURES.IP, device.ip],
        [FEATURES.LAST_CHANGE, formatDate(device.lastChange)],
      ];
      for (const [key, value] of values) {
        if (value) texts.push({ device_feature_external_id: ids.feature(key), text: value });
      }
    }
    if (created.network && this.counts) {
      const ids = networkIds(this.gladys);
      counts.push(
        {
          device_feature_external_id: ids.feature(FEATURES.ONLINE_COUNT),
          state: this.counts.online,
        },
        { device_feature_external_id: ids.feature(FEATURES.TOTAL_COUNT), state: this.counts.total },
      );
    }
    return { counts, online, texts };
  }

  /**
   * Publish what changed, every state within the minute budget (POST /state
   * admits 300 per minute; this integration stays under 250): the counts
   * first, then online, then the texts, which take turns when they are cut.
   * What is held back goes at a later reading.
   */
  async publishDeviceStates() {
    const { counts, online, texts } = this.statesOf();
    const changed = (list) =>
      list.filter((s) => this.published.get(s.device_feature_external_id) !== valueOf(s));
    let room = this.budget.remaining();
    const list = [];
    let held = 0;
    for (const group of [counts, online]) {
      const fresh = changed(group);
      list.push(...fresh.slice(0, room));
      held += Math.max(0, fresh.length - room);
      room = Math.max(0, room - fresh.length);
    }
    const freshTexts = changed(texts);
    if (freshTexts.length <= room) {
      list.push(...freshTexts);
    } else {
      const start = freshTexts.length > 0 ? this.textCursor % freshTexts.length : 0;
      for (let i = 0; i < room; i += 1) list.push(freshTexts[(start + i) % freshTexts.length]);
      this.textCursor = start + room;
      held += freshTexts.length - room;
    }
    if (held > 0) this.logger.debug(`${held} state(s) held back (state budget)`);
    if (list.length === 0) return;
    try {
      const result = await this.gladys.publishChangedStates(list);
      this.budget.record(result?.count ?? list.length);
      for (const s of list) this.published.set(s.device_feature_external_id, valueOf(s));
    } catch (err) {
      // Gladys may have counted them anyway: the budget does too.
      this.budget.record(list.length);
      this.logger.warn(`States not published: ${err.message}`);
    }
  }

  /** Forget what was published for a device (Gladys forgot it too). */
  forget(externalId) {
    if (typeof externalId !== 'string') return;
    const prefix = `${externalId}:`;
    for (const id of [...this.published.keys()]) {
      if (id === externalId || id.startsWith(prefix)) this.published.delete(id);
    }
  }

  async publishTransports() {
    const entries = [];
    const created = createdDevices(this.gladys);
    for (const { mac, externalId } of created.devices) {
      const reachable = this.online && this.devices.has(mac);
      entries.push({ external_id: externalId, transport: reachable ? 'local' : 'unreachable' });
    }
    if (created.network) {
      entries.push({
        external_id: created.network.externalId,
        transport: this.online ? 'local' : 'unreachable',
      });
    }
    const changed = entries.filter((e) => this.transports.get(e.external_id) !== e.transport);
    for (let start = 0; start < changed.length; start += TRANSPORTS_PER_CALL) {
      const batch = changed.slice(start, start + TRANSPORTS_PER_CALL);
      for (const entry of batch) this.transports.set(entry.external_id, entry.transport);
      await this.gladys.publishTransports(batch).catch((err) => {
        for (const entry of batch) this.transports.delete(entry.external_id);
        this.logger.debug(`Transports not published: ${err.message}`);
      });
    }
  }

  // --- Devices created / deleted in Gladys -----------------------------------

  /** Created or updated: the SDK forgot the values of this device, so do we. */
  async deviceCreated(device) {
    this.forget(device?.external_id);
    this.transports.delete(device?.external_id);
    if (this.online) await this.publishDeviceStates();
    await this.publishTransports();
  }

  async deviceUpdated(device) {
    await this.deviceCreated(device);
  }

  deviceDeleted(device) {
    this.forget(device?.external_id);
    this.transports.delete(device?.external_id);
  }

  /** Read only: no command reaches Fing. */
  async setValue() {
    throw new Error(T.errors.readOnly);
  }

  // --- Configuration button --------------------------------------------------

  /** Resolves `promise`, or rejects with `message` after `ms`. */
  within(promise, ms, message) {
    let handle;
    const limit = new Promise((_, reject) => {
      handle = this.timers.setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, limit]).finally(() => this.timers.clearTimeout(handle));
  }

  /**
   * Reconnects, then reports, within 25 s. A refused key is not tried again
   * (only saving the configuration does), nor is a pause shortened.
   */
  async testConnection() {
    await this.within(
      this.start(this.rawConfig, { immediate: true }),
      TEST_BUDGET_MS,
      T.errors.testTooLong,
    );
    if (!this.online) {
      const message = this.lastStatus ? JSON.parse(this.lastStatus)[1] : null;
      throw new Error(message?.en ?? T.errors.notConnected);
    }
    return T.test.ok(this.counts ?? { total: 0, online: 0 });
  }
}

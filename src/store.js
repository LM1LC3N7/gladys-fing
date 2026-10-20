// -----------------------------------------------------------------------------
// A small JSON file in the writable /data volume, for what the integration
// learns and must keep across restarts:
//   - refusals: an HMAC (keyed with `meta.salt`) of the address and API key
//     the Fing Agent refused (HTTP 401 / 403), per address: a restart (or a
//     reconnection to Gladys) with the same values does not try again.
//   - meta: `salt`, a random key generated once for the HMAC above, and
//     `pausedUntil|<host:port>`, the end of a pause after HTTP 429 or 5xx (ms).
// The API key itself, the devices and their MAC addresses are never written
// here. Writes are atomic (temporary file + rename) and queued. When the file
// cannot be written (no /data during development), values stay in memory.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const SECTIONS = ['refusals', 'meta'];
const EMPTY = () => Object.fromEntries(SECTIONS.map((section) => [section, Object.create(null)]));

export class Store {
  #writes = Promise.resolve();

  /** @param {{ filePath: string, logger?: { warn: Function } }} options */
  constructor({ filePath, logger }) {
    this.filePath = filePath;
    this.logger = logger;
    this.data = EMPTY();
    this.loaded = null;
  }

  /** Reads the file once; later calls share the first read. */
  load() {
    this.loaded ??= readFile(this.filePath, 'utf8')
      .then((content) => {
        const parsed = JSON.parse(content);
        // Own string values only, into objects without a prototype.
        const pick = (value) => {
          const out = Object.create(null);
          if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
          for (const [k, v] of Object.entries(value)) {
            if (typeof v === 'string' && v && v.length <= 200) out[k] = v;
          }
          return out;
        };
        this.data = Object.fromEntries(
          SECTIONS.map((section) => [section, pick(parsed?.[section])]),
        );
      })
      .catch((err) => {
        if (err.code !== 'ENOENT')
          this.logger?.warn(`Store unreadable, starting empty: ${err.message}`);
        this.data = EMPTY();
      });
    return this.loaded;
  }

  get(section, key) {
    const values = this.data[section];
    return values && Object.hasOwn(values, key) ? values[key] : null;
  }

  async set(section, key, value) {
    if (value === null || value === undefined) delete this.data[section][key];
    else this.data[section][key] = value;
    await this.#save();
  }

  /** The random key of this installation (created on first use). */
  async salt() {
    let salt = this.get('meta', 'salt');
    if (!salt) {
      salt = randomBytes(32).toString('hex');
      await this.set('meta', 'salt', salt);
    }
    return salt;
  }

  #save() {
    const write = this.#writes.then(() => this.#write());
    this.#writes = write.catch(() => {});
    return write;
  }

  async #write() {
    const tmp = `${this.filePath}.tmp`;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, this.filePath);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => {});
      this.logger?.warn(`Store not saved, values kept in memory only: ${err.message}`);
    }
  }
}

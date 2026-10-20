// -----------------------------------------------------------------------------
// The local API of a Fing Agent (Fing Agent on a computer or a Raspberry Pi,
// or a Fingbox), ported from fing-agent-pyapi (Apache-2.0, Fing Ltd: see
// THIRD_PARTY_NOTICES.md). Read only:
//   GET http://<host>:<port>/1/devices?auth=<API key>   every device Fing knows
// The API takes its key in the query string (that is how Fing designed it):
// the URL is therefore never logged, never put in an error, never stored.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { MAX_BYTES, TIMEOUTS } from '../constants.js';
import { CODES, FingError } from './errors.js';
import { httpRequest } from './http.js';
import { parseDevices } from './parse.js';

const asNumber = (value) => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 12) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Seconds of a Retry-After header (delta form only), in ms, or null. */
const retryAfterMs = (value) => {
  const seconds = asNumber(Array.isArray(value) ? value[0] : value);
  return seconds !== null && seconds >= 0 ? seconds * 1000 : null;
};

/** gladys-fing/<version>, from package.json (copied into the image). */
export const USER_AGENT = (() => {
  try {
    const { version } = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    return typeof version === 'string' ? `gladys-fing/${version}` : 'gladys-fing';
  } catch {
    return 'gladys-fing';
  }
})();

export class FingClient {
  /**
   * @param {object} options
   * @param {string} options.host the Fing Agent (IP or host name)
   * @param {number} options.port its API port (49090 by default)
   * @param {string} options.key the API key of the local API
   * @param {Function} [options.request] the HTTP transport (tests inject a fake Fing)
   */
  constructor({ host, port, key, request = httpRequest }) {
    this.host = host;
    this.port = port;
    this.key = key;
    this.request = request;
    this.closed = false;
  }

  close() {
    this.closed = true;
  }

  /** The devices Fing knows: { devices, invalid }; rejects a FingError. */
  async devices() {
    if (this.closed) throw new FingError(CODES.CLOSED, 'Client closed');
    const response = await this.request(
      {
        host: this.host,
        port: this.port,
        path: `/1/devices?auth=${encodeURIComponent(this.key)}`,
      },
      {
        headers: { 'user-agent': USER_AGENT },
        timeout: TIMEOUTS.API,
        maxBytes: MAX_BYTES.DEVICES,
      },
    );
    if (response.status < 200 || response.status > 299) {
      throw new FingError(CODES.HTTP, `HTTP ${response.status}`, {
        status: response.status,
        retryAfterMs: retryAfterMs(response.headers?.['retry-after']),
      });
    }
    let json;
    try {
      json = JSON.parse(response.body.toString('utf8'));
    } catch {
      throw new FingError(CODES.BAD_ANSWER, 'Not JSON');
    }
    const parsed = parseDevices(json);
    if (!parsed) throw new FingError(CODES.BAD_ANSWER, 'Not a list of devices');
    return parsed;
  }
}

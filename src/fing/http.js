// -----------------------------------------------------------------------------
// The only network access of the integration: one GET to the Fing Agent on
// node:http (its local API is plain HTTP on the local network). A deadline
// for the whole exchange, a size cap on the body, no redirect followed (the
// URL holds the API key: it never goes anywhere else). Resolves
// { status, headers, body } for any status; rejects a FingError for the
// transport failures, whose message never holds the URL.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { CODES, FingError } from './errors.js';

function transportError(err) {
  const code = String(err?.code ?? '');
  // Something answered, but not in HTTP (a wrong port, a TLS port).
  if (code.startsWith('HPE_') || code === 'EPROTO') {
    return new FingError(CODES.BAD_ANSWER, `Not the expected protocol (${code})`);
  }
  // Only the error code: Node's own message holds the address.
  return new FingError(
    CODES.UNREACHABLE,
    /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'Connection failed',
  );
}

/**
 * @param {{ host: string, port: number, path: string }} target the path holds the query
 * @param {object} options
 * @param {Record<string, string>} [options.headers]
 * @param {number} options.timeout ms for the whole exchange
 * @param {number} options.maxBytes body size cap
 */
export function httpRequest({ host, port, path }, { headers = {}, timeout, maxBytes } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        req?.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(
      () =>
        finish(new FingError(CODES.TIMEOUT, `No answer within ${Math.round(timeout / 1000)} s`)),
      timeout,
    );

    try {
      req = http.request(
        {
          method: 'GET',
          host: host.replace(/^\[(.*)\]$/, '$1'),
          port,
          path,
          agent: false,
          headers: { accept: 'application/json', ...headers },
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              finish(new FingError(CODES.TOO_LARGE, `Answer above ${maxBytes} bytes`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            finish(null, {
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
          res.on('error', (err) => finish(transportError(err)));
        },
      );
      req.on('error', (err) => finish(transportError(err)));
      req.end();
    } catch (err) {
      // http.request throws synchronously on a value it refuses: a failure,
      // never a crash.
      finish(transportError(err));
    }
  });
}

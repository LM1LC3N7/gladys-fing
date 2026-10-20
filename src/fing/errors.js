// -----------------------------------------------------------------------------
// FingError: every failure of a request to the Fing Agent, with a code the app
// maps to a status, a retry policy or a message. Messages never carry the API
// key, the URL (it holds the key) nor a MAC address.
// -----------------------------------------------------------------------------

export const CODES = Object.freeze({
  UNREACHABLE: 'unreachable', // no TCP connection
  TIMEOUT: 'timeout', // no answer in time
  HTTP: 'http', // an HTTP status other than 2xx (see `status`)
  BAD_ANSWER: 'bad_answer', // not the JSON expected, or not HTTP at all
  TOO_LARGE: 'too_large', // answer above the size cap
  CLOSED: 'closed', // the client was replaced (new configuration)
});

export class FingError extends Error {
  constructor(code, message, { status, retryAfterMs } = {}) {
    super(message);
    this.name = 'FingError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (retryAfterMs !== undefined && retryAfterMs !== null) this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The API key refused: HTTP 401 or 403 on the list of the devices (the only
 * request of the integration). Final: never retried before the
 * configuration is saved again.
 */
export const isKeyRefused = (err) =>
  err?.code === CODES.HTTP && (err.status === 401 || err.status === 403);

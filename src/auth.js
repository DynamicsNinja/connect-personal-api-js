// Bearer-token authentication and caching.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';

import {
  BASE_URL_ENV_VAR,
  DEFAULT_BASE_URL,
  DEFAULT_BEARER_TOKEN_CACHE_FILE,
  DEFAULT_TIMEOUT_SECONDS,
  TOKEN_PATH,
} from './constants.js';
import { expandUser, requireNonemptyKey, warnIfReadableByOthers } from './credentials.js';
import { GarminPersonalApiError, HttpError } from './errors.js';
import { RequestScope, resolveBaseUrl, validateTimeout } from './http.js';
import { defaultLogger } from './logging.js';

const BEARER_TOKEN_REFRESH_WINDOW_SECONDS = 60 * 60;

/** A bearer token and its expiration time in seconds since the epoch. */
export class BearerToken {
  /** @type {string} */
  #accessToken;

  /**
   * @param {string} accessToken
   * @param {number} expiresAt
   */
  constructor(accessToken, expiresAt) {
    this.#accessToken = accessToken;
    /** @readonly */
    this.expiresAt = expiresAt;
    Object.freeze(this);
  }

  /** The bearer token string. It is kept out of `inspect()` and `JSON.stringify()` output. */
  get accessToken() {
    return this.#accessToken;
  }

  /** @returns {object} */
  [inspect.custom]() {
    return { expiresAt: this.expiresAt };
  }
}

/**
 * @typedef {object} PersonalApiAuthenticatorOptions
 * @property {number} [timeoutSeconds] Request timeout in seconds.
 * @property {typeof fetch} [fetch] Fetch implementation; defaults to the global `fetch`.
 * @property {string} [bearerTokenCacheFile] Bearer-token cache location.
 * @property {() => number} [clock] Returns the current time in seconds since the epoch.
 * @property {import('./logging.js').Logger} [logger]
 */

/**
 * Cache bearer tokens and exchange a Garmin personal API key when needed.
 *
 * Key discovery is separate from HTTP authentication. Pass `obtainToken()` a
 * key from `resolveApiKey()` or from another secret source.
 */
export class PersonalApiAuthenticator {
  #requests;
  #clock;

  /** @param {PersonalApiAuthenticatorOptions} [options] */
  constructor({
    timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
    fetch: fetchImpl = globalThis.fetch,
    bearerTokenCacheFile = DEFAULT_BEARER_TOKEN_CACHE_FILE,
    clock = () => Date.now() / 1000,
    logger = defaultLogger,
  } = {}) {
    validateTimeout(timeoutSeconds);
    this.baseUrl = resolveBaseUrl(process.env[BASE_URL_ENV_VAR] ?? DEFAULT_BASE_URL);
    this.timeoutSeconds = timeoutSeconds;
    this.bearerTokenCacheFile = expandUser(bearerTokenCacheFile);
    this.#requests = new RequestScope(fetchImpl, timeoutSeconds);
    this.#clock = clock;
    this.logger = logger;
  }

  /** Abort in-flight requests. */
  close() {
    this.#requests.close();
  }

  [Symbol.dispose]() {
    this.close();
  }

  /** @returns {object} */
  [inspect.custom]() {
    return { baseUrl: this.baseUrl, timeoutSeconds: this.timeoutSeconds };
  }

  /**
   * Return a cached bearer token or exchange the key for a new bearer token.
   * @param {string} apiKey
   * @param {{forceRefresh?: boolean}} [options]
   * @returns {Promise<BearerToken>}
   */
  async obtainToken(apiKey, { forceRefresh = false } = {}) {
    if (typeof apiKey !== 'string') {
      throw new GarminPersonalApiError(
        'An API key string is required; use resolveApiKey() to discover one.',
      );
    }
    const key = requireNonemptyKey(apiKey, 'the explicit API key');
    // Cached tokens are only reused for the same API key and environment.
    const fingerprint = createHash('sha256').update(`${this.baseUrl}\0${key}`).digest('hex');
    if (!forceRefresh) {
      const cachedToken = await this.#readCachedToken(fingerprint);
      if (cachedToken !== null) {
        if (cachedToken.expiresAt - this.#clock() > BEARER_TOKEN_REFRESH_WINDOW_SECONDS) {
          this.logger.info('Using cached bearer token');
          return cachedToken;
        }
        this.logger.info(
          'Cached bearer token is expired or expires within the 1-hour refresh ' +
            'window; requesting a new token',
        );
      }
    }

    const url = `${this.baseUrl}${TOKEN_PATH}`;
    this.logger.info(`POST ${TOKEN_PATH}`);
    const response = await this.#requests.fetch(url, {
      method: 'POST',
      headers: { Accept: '*/*', Authorization: `ApiKey ${key}` },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new HttpError({ statusCode: response.status, method: 'POST', url, responseText: text });
    }

    const accessToken = text.trim();
    const token = new BearerToken(accessToken, jwtExpiration(accessToken));
    await this.#writeCachedToken(fingerprint, token);
    this.logger.info('Received and cached a new bearer token');
    return token;
  }

  /**
   * @param {string} fingerprint
   * @returns {Promise<BearerToken | null>}
   */
  async #readCachedToken(fingerprint) {
    const filePath = this.bearerTokenCacheFile;
    let serialized;
    try {
      serialized = await readFile(filePath, 'utf8');
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
        throw error;
      }
      this.logger.info('No cached bearer token found; requesting a new token');
      return null;
    }
    warnIfReadableByOthers(filePath, 'Bearer-token cache file', this.logger);
    try {
      const cache = JSON.parse(serialized);
      if (cache.fingerprint !== fingerprint) {
        this.logger.info(
          'Cached bearer token fingerprint does not match the current API key or ' +
            'base URL; requesting a new token',
        );
        return null;
      }
      const expiresAt = Number(cache.expires_at);
      if (typeof cache.access_token !== 'string' || !Number.isFinite(expiresAt)) {
        throw new TypeError('invalid cache entry');
      }
      return new BearerToken(cache.access_token, expiresAt);
    } catch {
      this.logger.warn(`Ignoring invalid bearer-token cache file ${filePath}`);
      return null;
    }
  }

  /**
   * @param {string} fingerprint
   * @param {BearerToken} token
   */
  async #writeCachedToken(fingerprint, token) {
    const filePath = this.bearerTokenCacheFile;
    await mkdir(path.dirname(filePath), { recursive: true });
    // The snake_case keys keep the cache file compatible with the Python client.
    const serialized = JSON.stringify({
      fingerprint,
      access_token: token.accessToken,
      expires_at: token.expiresAt,
    });
    // The mode applies only when the file is created; an existing file keeps its permissions.
    await writeFile(filePath, serialized, { encoding: 'utf8', mode: 0o600 });
  }
}

/**
 * Return the `exp` claim of a JWT without verifying its signature.
 * @param {string} accessToken
 * @returns {number}
 */
function jwtExpiration(accessToken) {
  const error = () =>
    new GarminPersonalApiError('The token endpoint did not return a JWT with an exp claim.');
  const encodedPayload = accessToken.split('.')[1];
  if (encodedPayload === undefined) {
    throw error();
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch (cause) {
    throw Object.assign(error(), { cause });
  }
  const claim = payload?.exp;
  const exp = typeof claim === 'string' && claim.trim() ? Number(claim) : claim;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    throw error();
  }
  return exp;
}

// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { inspect } from 'node:util';

import * as packageExports from '../src/index.js';
import { resolveApiKey as moduleResolveApiKey } from '../src/apiKeys.js';
import { BASE_URL_ENV_VAR, TOKEN_PATH } from '../src/constants.js';
import {
  BearerToken,
  GarminPersonalApiError,
  HttpError,
  PersonalApiAuthenticator,
  resolveApiKey,
} from '../src/index.js';
import { recordingLogger, stubFetch, tempDir } from './helpers.js';

const NOW = 1_800_000_000;
const HOUR = 60 * 60;
const POSIX = process.platform !== 'win32';

/** @param {Record<string, unknown>} payload */
function jwt(payload) {
  const encode = (/** @type {object} */ value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

/**
 * @param {string} accessToken
 * @param {number} [status]
 */
function tokenResponse(accessToken, status = 200) {
  return { body: accessToken, status };
}

/**
 * @param {string} dir
 * @param {ReturnType<typeof stubFetch>} fetchImpl
 * @param {{timeoutSeconds?: number, logger?: ReturnType<typeof recordingLogger>}} [options]
 */
function authenticator(dir, fetchImpl, { timeoutSeconds = 30, logger } = {}) {
  return new PersonalApiAuthenticator({
    fetch: fetchImpl,
    timeoutSeconds,
    bearerTokenCacheFile: path.join(dir, 'bearer-token-cache.json'),
    clock: () => NOW,
    logger,
  });
}

afterEach(() => {
  delete process.env[BASE_URL_ENV_VAR];
  delete process.env.GARMIN_PERSONAL_API_KEY;
});

describe('resolveApiKey', () => {
  test('is exported from the package', () => {
    assert.equal(resolveApiKey, moduleResolveApiKey);
    assert.equal(packageExports.resolveApiKey, moduleResolveApiKey);
  });

  test('precedence is explicit key, then explicit file, then env, then default', () => {
    const dir = tempDir();
    const defaultKeyFile = path.join(dir, 'default-key');
    writeFileSync(defaultKeyFile, 'default-key\n');
    const keyFile = path.join(dir, 'key');
    writeFileSync(keyFile, 'file-key\n');
    const env = { GARMIN_PERSONAL_API_KEY: ' env-key ' };
    const resolve = (/** @type {object} */ options) => resolveApiKey({ defaultKeyFile, ...options });

    assert.equal(resolve({ apiKey: ' explicit-key ', env, keyFile }), 'explicit-key');
    assert.equal(resolve({ env, keyFile }), 'file-key');
    assert.equal(resolve({ env, keyFile: defaultKeyFile }), 'default-key');
    assert.equal(resolve({ env }), 'env-key');
    assert.equal(resolve({ env: {} }), 'default-key');
    assert.equal(resolve({ env: {}, keyFile }), 'file-key');
  });

  test('an explicit key file overrides the process environment', () => {
    const keyFile = path.join(tempDir(), 'custom-key');
    writeFileSync(keyFile, ' file-key\n');
    process.env.GARMIN_PERSONAL_API_KEY = 'env-key';

    assert.equal(resolveApiKey({ keyFile }), 'file-key');
  });

  for (const env of [{}, { GARMIN_PERSONAL_API_KEY: '  ' }]) {
    test(`an empty file or environment key is rejected (env=${JSON.stringify(env)})`, () => {
      const keyFile = path.join(tempDir(), 'key');
      writeFileSync(keyFile, ' \n');
      assert.throws(() => resolveApiKey({ env, keyFile }), {
        name: 'GarminPersonalApiError',
        message: /empty/,
      });
    });
  }

  test('an empty environment key does not fall back to the default file', () => {
    const defaultKeyFile = path.join(tempDir(), 'key');
    writeFileSync(defaultKeyFile, 'file-key');
    assert.throws(
      () => resolveApiKey({ env: { GARMIN_PERSONAL_API_KEY: '' }, defaultKeyFile }),
      /environment variable.*empty/,
    );
  });

  for (const [apiKey, message] of [
    [null, /--api-key/],
    ['  ', /empty/],
  ]) {
    test(`a missing or empty key is rejected (${JSON.stringify(apiKey)})`, () => {
      const defaultKeyFile = path.join(tempDir(), 'missing');
      assert.throws(
        () => resolveApiKey({ apiKey: /** @type {string | null} */ (apiKey), env: {}, defaultKeyFile }),
        (error) => error instanceof GarminPersonalApiError && /** @type {RegExp} */ (message).test(error.message),
      );
    });
  }

  for (const fileState of ['missing', 'empty', 'directory']) {
    test(`an invalid explicit file does not fall back (${fileState})`, () => {
      const dir = tempDir();
      const defaultKeyFile = path.join(dir, 'default-key');
      writeFileSync(defaultKeyFile, 'default-key');
      const keyFile = path.join(dir, 'explicit-key');
      if (fileState === 'empty') {
        writeFileSync(keyFile, ' \n');
      } else if (fileState === 'directory') {
        mkdirSync(keyFile);
      }
      assert.throws(
        () =>
          resolveApiKey({ env: { GARMIN_PERSONAL_API_KEY: 'env-key' }, keyFile, defaultKeyFile }),
        (error) => error instanceof GarminPersonalApiError && error.message.includes(keyFile),
      );
    });
  }

  test('an explicit key overrides an invalid file and environment', () => {
    assert.equal(
      resolveApiKey({
        apiKey: 'explicit-key',
        env: { GARMIN_PERSONAL_API_KEY: '' },
        keyFile: path.join(tempDir(), 'missing'),
      }),
      'explicit-key',
    );
  });

  test('an empty explicit key does not fall back to a file', () => {
    const keyFile = path.join(tempDir(), 'key');
    writeFileSync(keyFile, 'file-key');
    assert.throws(
      () => resolveApiKey({ apiKey: ' ', env: { GARMIN_PERSONAL_API_KEY: 'env-key' }, keyFile }),
      /explicit API key.*empty/,
    );
  });

  test('a key file with insecure permissions warns and continues', { skip: !POSIX }, () => {
    const keyFile = path.join(tempDir(), 'key');
    writeFileSync(keyFile, 'file-key\n');
    chmodSync(keyFile, 0o644);
    const logger = recordingLogger();

    assert.equal(resolveApiKey({ env: {}, keyFile, logger }), 'file-key');
    const text = logger.messages.join('\n');
    assert.match(text, /Personal API key file/);
    assert.match(text, /chmod 600/);
  });
});

describe('PersonalApiAuthenticator', () => {
  test('exchanges a key for the JWT and its expiration', async () => {
    const accessToken = jwt({ exp: NOW + 2 * HOUR });
    const fetchImpl = stubFetch(tokenResponse(`${accessToken}\n`));
    const auth = authenticator(tempDir(), fetchImpl, { timeoutSeconds: 12 });

    const token = await auth.obtainToken(' secret-key ');

    assert.ok(token instanceof BearerToken);
    assert.equal(token.accessToken, accessToken);
    assert.equal(token.expiresAt, NOW + 2 * HOUR);
    const [call] = fetchImpl.calls;
    assert.equal(call.method, 'POST');
    assert.ok(call.url.endsWith(TOKEN_PATH));
    assert.deepEqual(call.headers, { Accept: '*/*', Authorization: 'ApiKey secret-key' });
    assert.ok(call.signal instanceof AbortSignal);
    assert.equal(auth.timeoutSeconds, 12);
  });

  for (const [apiKey, message] of [
    [null, /resolveApiKey/],
    ['  ', /empty/],
  ]) {
    test(`obtainToken requires a key and does not discover one (${JSON.stringify(apiKey)})`, async () => {
      process.env.GARMIN_PERSONAL_API_KEY = 'env-key';
      const fetchImpl = stubFetch();

      await assert.rejects(
        authenticator(tempDir(), fetchImpl).obtainToken(/** @type {string} */ (apiKey)),
        (error) => error instanceof GarminPersonalApiError && /** @type {RegExp} */ (message).test(error.message),
      );
      assert.deepEqual(fetchImpl.calls, []);
    });
  }

  for (const accessToken of ['opaque-token', jwt({ sub: 'user' })]) {
    test(`a token without a JWT exp claim is rejected (${accessToken.slice(0, 12)})`, async () => {
      const fetchImpl = stubFetch(tokenResponse(accessToken));
      await assert.rejects(authenticator(tempDir(), fetchImpl).obtainToken('key'), /exp claim/);
    });
  }

  test('token endpoint errors preserve response bodies', async () => {
    const fetchImpl = stubFetch(tokenResponse('{"message": "invalid credentials"}', 401));

    await assert.rejects(authenticator(tempDir(), fetchImpl).obtainToken('api-key'), (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 401);
      assert.equal(error.responseText, '{"message": "invalid credentials"}');
      assert.match(error.message, /invalid credentials/);
      return true;
    });
  });

  test('close aborts in-flight requests', async () => {
    /** @type {PersonalApiAuthenticator} */
    let auth;
    /** @type {typeof fetch} */
    const hangingFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        auth.close();
      });
    auth = new PersonalApiAuthenticator({
      fetch: hangingFetch,
      bearerTokenCacheFile: path.join(tempDir(), 'cache.json'),
    });
    await assert.rejects(auth.obtainToken('key'), /closed/);
  });

  test('a non-positive timeout is rejected', () => {
    assert.throws(() => new PersonalApiAuthenticator({ timeoutSeconds: 0 }), /greater than zero/);
  });

  test('inspecting a bearer token does not expose it', () => {
    const token = new BearerToken('secret-token', NOW);
    assert.doesNotMatch(inspect(token), /secret-token/);
    assert.doesNotMatch(JSON.stringify(token), /secret-token/);
  });

  test('the cache stores the token but not the API key', async () => {
    const apiKey = 'do-not-store-this-key';
    const accessToken = jwt({ exp: NOW + 2 * HOUR });
    const auth = authenticator(tempDir(), stubFetch(tokenResponse(accessToken)));

    await auth.obtainToken(apiKey);

    const serialized = readFileSync(auth.bearerTokenCacheFile, 'utf8');
    assert.ok(serialized.includes(accessToken));
    assert.ok(!serialized.includes(apiKey));
    if (POSIX) {
      assert.equal(statSync(auth.bearerTokenCacheFile).mode & 0o777, 0o600);
    }
  });

  for (const [name, cachedLifetime, forceRefresh, expectRequest] of [
    ['reused', 2 * HOUR, false, false],
    ['refreshed within one hour', HOUR, false, true],
    ['refreshed after expiration', -HOUR, false, true],
    ['force refresh', 2 * HOUR, true, true],
  ]) {
    test(`cached token is reused until the refresh window: ${name}`, async () => {
      const dir = tempDir();
      const cachedToken = jwt({ exp: NOW + Number(cachedLifetime) });
      const newToken = jwt({ exp: NOW + 24 * HOUR });
      await authenticator(dir, stubFetch(tokenResponse(cachedToken))).obtainToken('key');
      const fetchImpl = stubFetch(tokenResponse(newToken));

      const token = await authenticator(dir, fetchImpl).obtainToken('key', {
        forceRefresh: Boolean(forceRefresh),
      });

      assert.equal(token.accessToken, expectRequest ? newToken : cachedToken);
      assert.equal(fetchImpl.calls.length, expectRequest ? 1 : 0);
    });
  }

  for (const [name, secondKey, secondBaseUrl] of [
    ['different key', 'other-key', 'https://one.example'],
    ['different base URL', 'key', 'https://two.example'],
  ]) {
    test(`the cache is bound to the key and base URL: ${name}`, async () => {
      const dir = tempDir();
      const firstToken = jwt({ exp: NOW + 2 * HOUR });
      const secondToken = jwt({ exp: NOW + 3 * HOUR });
      process.env[BASE_URL_ENV_VAR] = 'https://one.example';
      await authenticator(dir, stubFetch(tokenResponse(firstToken))).obtainToken('key');
      process.env[BASE_URL_ENV_VAR] = secondBaseUrl;
      const fetchImpl = stubFetch(tokenResponse(secondToken));

      const token = await authenticator(dir, fetchImpl).obtainToken(secondKey);

      assert.equal(token.accessToken, secondToken);
      assert.equal(fetchImpl.calls.length, 1);
    });
  }

  test('an invalid cache is replaced', async () => {
    const accessToken = jwt({ exp: NOW + 2 * HOUR });
    const logger = recordingLogger();
    const auth = authenticator(tempDir(), stubFetch(tokenResponse(accessToken)), { logger });
    writeFileSync(auth.bearerTokenCacheFile, 'not json', { mode: 0o600 });

    assert.equal((await auth.obtainToken('key')).accessToken, accessToken);
    const cache = JSON.parse(readFileSync(auth.bearerTokenCacheFile, 'utf8'));
    assert.equal(cache.access_token, accessToken);
    assert.match(logger.messages.join('\n'), /WARNING Ignoring invalid bearer-token cache file/);
  });

  test('reads a cache file written by the Python client', async () => {
    const dir = tempDir();
    const accessToken = jwt({ exp: NOW + 2 * HOUR });
    const auth = authenticator(dir, stubFetch(tokenResponse(accessToken)));
    await auth.obtainToken('key');
    const cache = JSON.parse(readFileSync(auth.bearerTokenCacheFile, 'utf8'));
    // Python's json.dump writes floats with a trailing ".0" and spaces after separators.
    writeFileSync(
      auth.bearerTokenCacheFile,
      `{"fingerprint": "${cache.fingerprint}", "access_token": "${accessToken}", "expires_at": ${NOW + 2 * HOUR}.0}`,
    );
    const fetchImpl = stubFetch();

    assert.equal((await authenticator(dir, fetchImpl).obtainToken('key')).accessToken, accessToken);
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('a cache with insecure permissions warns and continues', { skip: !POSIX }, async () => {
    const dir = tempDir();
    const accessToken = jwt({ exp: NOW + 2 * HOUR });
    const auth = authenticator(dir, stubFetch(tokenResponse(accessToken)));
    await auth.obtainToken('key');
    chmodSync(auth.bearerTokenCacheFile, 0o644);
    const fetchImpl = stubFetch();
    const logger = recordingLogger();

    const token = await authenticator(dir, fetchImpl, { logger }).obtainToken('key');

    assert.equal(token.accessToken, accessToken);
    assert.deepEqual(fetchImpl.calls, []);
    const text = logger.messages.join('\n');
    assert.match(text, /Bearer-token cache file/);
    assert.match(text, /chmod 600/);
  });
});

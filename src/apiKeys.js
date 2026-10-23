// Personal API key discovery.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { readFileSync } from 'node:fs';

import { DEFAULT_API_KEY_ENV_VAR, DEFAULT_API_KEY_FILE } from './constants.js';
import { expandUser, requireNonemptyKey, warnIfReadableByOthers } from './credentials.js';
import { GarminPersonalApiError } from './errors.js';
import { defaultLogger } from './logging.js';

/**
 * @typedef {object} ResolveApiKeyOptions
 * @property {string | null} [apiKey] Explicit key; takes precedence over every other source.
 * @property {Record<string, string | undefined>} [env] Environment to read; defaults to `process.env`.
 * @property {string} [envVar] Environment variable name.
 * @property {string | null} [keyFile] Explicit key file; overrides the environment.
 * @property {string} [defaultKeyFile] Key file used when no other source supplies a key.
 * @property {import('./logging.js').Logger} [logger]
 */

/**
 * Resolve an explicit key, explicit file, environment, then default file.
 *
 * Pass the result to `PersonalApiAuthenticator.obtainToken()` to opt into
 * discovery. An explicitly supplied `keyFile` overrides the environment, even
 * when it names the default file. Invalid explicit sources do not fall back
 * to other sources.
 *
 * @param {ResolveApiKeyOptions} [options]
 * @returns {string}
 */
export function resolveApiKey({
  apiKey = null,
  env = process.env,
  envVar = DEFAULT_API_KEY_ENV_VAR,
  keyFile = null,
  defaultKeyFile = DEFAULT_API_KEY_FILE,
  logger = defaultLogger,
} = {}) {
  if (apiKey != null) {
    return requireNonemptyKey(apiKey, 'the explicit API key');
  }

  if (keyFile == null) {
    const environmentValue = env[envVar];
    if (environmentValue !== undefined) {
      return requireNonemptyKey(environmentValue, `environment variable ${envVar}`);
    }
  }

  const filePath = expandUser(keyFile ?? defaultKeyFile);
  let fileValue;
  try {
    fileValue = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
      throw new GarminPersonalApiError(
        `Cannot read personal API key file ${filePath}: ${/** @type {Error} */ (error).message}`,
        { cause: error },
      );
    }
    if (keyFile != null) {
      throw new GarminPersonalApiError(`Personal API key file ${filePath} does not exist.`, {
        cause: error,
      });
    }
    throw new GarminPersonalApiError(
      'No personal API key was provided. Pass --api-key/apiKey, set ' +
        `${envVar}, or create ${filePath}.`,
      { cause: error },
    );
  }
  warnIfReadableByOthers(filePath, 'Personal API key file', logger);
  return requireNonemptyKey(fileValue, `personal API key file ${filePath}`);
}

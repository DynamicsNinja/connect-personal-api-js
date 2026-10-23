// Shared credential validation, path expansion, and file-permission checks.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { GarminPersonalApiError } from './errors.js';

/**
 * @param {string} value
 * @param {string} source
 * @returns {string}
 */
export function requireNonemptyKey(value, source) {
  const key = value.trim();
  if (!key) {
    throw new GarminPersonalApiError(`The value from ${source} is empty.`);
  }
  return key;
}

/**
 * Expand a leading `~` to the user's home directory, like Python's `Path.expanduser()`.
 * @param {string} filePath
 * @returns {string}
 */
export function expandUser(filePath) {
  if (filePath === '~') {
    return homedir();
  }
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * @param {string} filePath
 * @param {string} description
 * @param {import('./logging.js').Logger} logger
 */
export function warnIfReadableByOthers(filePath, description, logger) {
  if (process.platform !== 'win32' && statSync(filePath).mode & 0o077) {
    logger.warn(
      `${description} ${filePath} is readable by group or other users; restrict it with chmod 600`,
    );
  }
}

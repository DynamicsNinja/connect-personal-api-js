// File output shared by direct and interactive downloads.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { randomBytes } from 'node:crypto';
import { link, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expandUser } from './credentials.js';
import { GarminPersonalApiError } from './errors.js';

/** Filesystem operations, replaceable in tests. */
export const fsOps = { link, rename, rm, writeFile };

/**
 * Publish a complete file, without replacing an existing file unless requested.
 * @param {Uint8Array} content
 * @param {string} destination
 * @param {{overwrite?: boolean}} [options]
 * @returns {Promise<string>} The expanded destination path.
 */
export async function saveDownload(content, destination, { overwrite = false } = {}) {
  const target = expandUser(destination);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomBytes(6).toString('hex')}`,
  );
  let created = false;
  try {
    await fsOps.writeFile(temporary, content, { flag: 'wx' });
    created = true;
    if (overwrite) {
      await fsOps.rename(temporary, target);
      created = false;
    } else {
      // Linking publishes atomically and refuses even a dangling destination symlink.
      await fsOps.link(temporary, target);
    }
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST' && created) {
      throw new GarminPersonalApiError(
        `File already exists: ${target}. Choose another path or allow overwrite.`,
        { cause: error },
      );
    }
    throw new GarminPersonalApiError(
      `Cannot save ${target}: ${/** @type {Error} */ (error).message}`,
      { cause: error },
    );
  } finally {
    if (created) {
      await fsOps.rm(temporary, { force: true });
    }
  }
  return target;
}

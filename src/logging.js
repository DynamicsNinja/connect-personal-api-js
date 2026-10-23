// Minimal pluggable logging used by the library and CLI.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

/**
 * A logger receives request activity at `info` and credential-safety notices at `warn`.
 * @typedef {{info(message: string): void, warn(message: string): void}} Logger
 */

/**
 * The default logger mirrors an unconfigured Python logger: request activity is
 * silent and warnings go to stderr.
 * @type {Logger}
 */
export const defaultLogger = {
  info() {},
  warn(message) {
    process.stderr.write(`${message}\n`);
  },
};

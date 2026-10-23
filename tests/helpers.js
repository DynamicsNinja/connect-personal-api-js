// Shared HTTP test doubles.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BASE_URL_ENV_VAR } from '../src/constants.js';

delete process.env[BASE_URL_ENV_VAR];

/**
 * @typedef {object} StubResponse
 * @property {unknown} [payload]
 * @property {number} [status]
 * @property {string | Uint8Array} [body] Raw body; defaults to the JSON-encoded payload.
 */

/**
 * @typedef {object} RecordedCall
 * @property {string} method
 * @property {string} url The URL without its query string.
 * @property {Record<string, string> | null} params Query parameters, or null when absent.
 * @property {Record<string, string>} headers
 * @property {AbortSignal} signal
 */

/**
 * A minimal `fetch` replacement with optional URL-specific responses.
 * @param {StubResponse | null} [response]
 * @param {{responses?: Record<string, StubResponse>}} [options]
 */
export function stubFetch(response = null, { responses = {} } = {}) {
  /** @type {RecordedCall[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    const fullUrl = String(input);
    const [url, query] = fullUrl.split('?');
    calls.push({
      method: init.method ?? 'GET',
      url,
      params: query === undefined ? null : Object.fromEntries(new URLSearchParams(query)),
      headers: /** @type {Record<string, string>} */ (init.headers),
      signal: /** @type {AbortSignal} */ (init.signal),
    });
    const stub = responses[url] ?? response;
    if (stub == null) {
      throw new Error(`No stub response configured for ${url}`);
    }
    return makeResponse(stub);
  };
  return Object.assign(fetchImpl, { calls });
}

/** @param {StubResponse} stub */
export function makeResponse({ payload = null, status = 200, body }) {
  const content = body ?? JSON.stringify(payload);
  const empty = content.length === 0 || status === 204;
  return new Response(empty ? null : content, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Create a fresh temporary directory. */
export function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'gc-personal-test-'));
}

/** Collects text written by code under test. */
export class TextCapture {
  text = '';
  isTTY = false;

  /** @param {string | Uint8Array} chunk */
  write(chunk, callback = () => {}) {
    this.text += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('latin1');
    callback();
    return true;
  }
}

/** A logger that records messages. */
export function recordingLogger() {
  /** @type {string[]} */
  const messages = [];
  return {
    messages,
    info: (/** @type {string} */ message) => messages.push(`INFO ${message}`),
    warn: (/** @type {string} */ message) => messages.push(`WARNING ${message}`),
  };
}

/**
 * Return an input function that replays answers in order.
 * @param {string[]} answers
 */
export function scriptedInput(answers) {
  const remaining = [...answers];
  return () => {
    if (remaining.length === 0) {
      throw new Error('No scripted input left');
    }
    return /** @type {string} */ (remaining.shift());
  };
}

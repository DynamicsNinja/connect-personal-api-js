// Shared HTTP plumbing: timeouts, cancellation, and base-URL handling.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { GarminPersonalApiError } from './errors.js';

/** @param {number} timeoutSeconds */
export function validateTimeout(timeoutSeconds) {
  if (!(timeoutSeconds > 0)) {
    throw new GarminPersonalApiError('timeout must be greater than zero');
  }
}

/** @param {string} baseUrl */
export function resolveBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '');
}

/** Apply a per-request timeout and abort every in-flight request on `close()`. */
export class RequestScope {
  #fetch;
  #timeoutMs;
  #controller = new AbortController();

  /**
   * @param {typeof fetch} fetchImpl
   * @param {number} timeoutSeconds
   */
  constructor(fetchImpl, timeoutSeconds) {
    if (typeof fetchImpl !== 'function') {
      throw new GarminPersonalApiError('A fetch implementation is required');
    }
    this.#fetch = fetchImpl;
    this.#timeoutMs = Math.ceil(timeoutSeconds * 1000);
  }

  /**
   * @param {string} url
   * @param {RequestInit} init
   * @returns {Promise<Response>}
   */
  fetch(url, init) {
    const signal = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(this.#timeoutMs)]);
    return this.#fetch(url, { ...init, signal });
  }

  close() {
    this.#controller.abort(new GarminPersonalApiError('The client was closed'));
    this.#controller = new AbortController();
  }
}

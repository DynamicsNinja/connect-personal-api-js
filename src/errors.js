// Errors raised by the Garmin Personal API client.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

/** Base class for all package-specific errors. */
export class GarminPersonalApiError extends Error {
  /**
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'GarminPersonalApiError';
  }
}

/** Raised when the Garmin API returns an unsuccessful HTTP response. */
export class HttpError extends GarminPersonalApiError {
  /**
   * @param {{statusCode: number, method: string, url: string, responseText: string}} details
   */
  constructor({ statusCode, method, url, responseText }) {
    let message = `${method} ${url} returned HTTP ${statusCode}`;
    if (responseText.trim()) {
      message = `${message}: ${responseText.trim()}`;
    }
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.method = method;
    this.url = url;
    this.responseText = responseText;
  }
}

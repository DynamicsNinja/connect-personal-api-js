// Garmin Personal API client library.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

export { resolveApiKey } from './apiKeys.js';
export { BearerToken, PersonalApiAuthenticator } from './auth.js';
export { GarminPersonalApiClient } from './client.js';
export {
  DEFAULT_API_KEY_FILE,
  DEFAULT_BASE_URL,
  DEFAULT_BEARER_TOKEN_CACHE_FILE,
} from './constants.js';
export { GarminPersonalApiError, HttpError } from './errors.js';
export { VERSION } from './version.js';

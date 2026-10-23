// Public defaults for Garmin Personal API access.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

export const DEFAULT_BASE_URL = 'https://personal.connectapi.garmin.com';
export const DEFAULT_API_KEY_FILE = '~/.config/garmin/connect-personal-api-key';
export const DEFAULT_BEARER_TOKEN_CACHE_FILE = '~/.config/garmin/connect-personal-api-bearer-token.json';
export const DEFAULT_API_KEY_ENV_VAR = 'GARMIN_PERSONAL_API_KEY';
export const BASE_URL_ENV_VAR = 'GARMIN_PERSONAL_API_BASE_URL';
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

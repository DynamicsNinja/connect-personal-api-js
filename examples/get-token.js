// Obtain a Garmin Personal API bearer token.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { PersonalApiAuthenticator, resolveApiKey } from '../src/index.js';

const authenticator = new PersonalApiAuthenticator();
const token = await authenticator.obtainToken(resolveApiKey());
const expiresAt = new Date(token.expiresAt * 1000).toISOString();
console.log(`Obtained a bearer token that expires at ${expiresAt}.`);

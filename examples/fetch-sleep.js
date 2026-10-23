// Fetch one day's sleep data with the Garmin Personal API client.
//
// Usage: node examples/fetch-sleep.js [--date YYYY-MM-DD]
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { parseArgs } from 'node:util';

import { GarminPersonalApiClient, PersonalApiAuthenticator, resolveApiKey } from '../src/index.js';

const { values } = parseArgs({ options: { date: { type: 'string' } } });

const token = await new PersonalApiAuthenticator().obtainToken(resolveApiKey());
const client = new GarminPersonalApiClient(token.accessToken);
const result = await client.getDailySleep(values.date ?? new Date());
console.log(JSON.stringify(result, null, 2));

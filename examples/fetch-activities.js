// Search summarized activities with the Garmin Personal API client.
//
// Usage: node examples/fetch-activities.js [--start-date DATE] [--end-date DATE] [--limit COUNT]
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { parseArgs } from 'node:util';

import { GarminPersonalApiClient, PersonalApiAuthenticator, resolveApiKey } from '../src/index.js';

const today = new Date();
const thirtyDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
const { values } = parseArgs({
  options: {
    'start-date': { type: 'string' },
    'end-date': { type: 'string' },
    limit: { type: 'string', default: '20' },
  },
});

const token = await new PersonalApiAuthenticator().obtainToken(resolveApiKey());
const client = new GarminPersonalApiClient(token.accessToken);
const activities = await client.searchActivities({
  startDate: values['start-date'] ?? thirtyDaysAgo,
  endDate: values['end-date'] ?? today,
  limit: Number(values.limit),
});
console.log(JSON.stringify(activities, null, 2));

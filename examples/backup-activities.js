// Back up original activity files (FIT, inside ZIP) to a folder.
//
// Usage: node examples/backup-activities.js [--dir garmin-activities] [--since DATE]
//
// Files that are already in the folder are skipped, so it is safe to run on a
// schedule (cron or Task Scheduler) to keep a local copy of every activity.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { GarminPersonalApiClient, PersonalApiAuthenticator, resolveApiKey } from '../src/index.js';

const PAGE_SIZE = 50;

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'garmin-activities' },
    since: { type: 'string' },
  },
});

const token = await new PersonalApiAuthenticator().obtainToken(resolveApiKey());
const client = new GarminPersonalApiClient(token.accessToken);
await mkdir(values.dir, { recursive: true });

let saved = 0;
let skipped = 0;
for (let start = 0; ; start += PAGE_SIZE) {
  const page = await client.searchActivities({ start, limit: PAGE_SIZE, startDate: values.since ?? null });
  const activities = Array.isArray(page) ? page : [];
  for (const activity of activities) {
    // Prefix the date so files sort chronologically.
    const date = String(activity.startTimeLocal ?? '').slice(0, 10) || 'unknown-date';
    const file = path.join(values.dir, `${date}_${activity.activityId}.zip`);
    if (existsSync(file)) {
      skipped += 1;
      continue;
    }
    await writeFile(file, await client.downloadActivity(activity.activityId));
    saved += 1;
    console.error(`Saved ${file} (${activity.activityName ?? 'untitled'})`);
  }
  if (activities.length < PAGE_SIZE) {
    break;
  }
}
console.error(`Done: ${saved} downloaded, ${skipped} already backed up.`);

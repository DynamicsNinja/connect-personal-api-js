// Print a sleep and HRV report for the last few nights.
//
// Usage: node examples/sleep-report.js [--days 7]
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { parseArgs } from 'node:util';

import { GarminPersonalApiClient, PersonalApiAuthenticator, resolveApiKey } from '../src/index.js';

const { values } = parseArgs({ options: { days: { type: 'string', default: '7' } } });
const days = Number(values.days);

const today = new Date();
const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));

const token = await new PersonalApiAuthenticator().obtainToken(resolveApiKey());
const client = new GarminPersonalApiClient(token.accessToken);
const [sleeps, hrv] = await Promise.all([
  client.getDailySleepSummaries(start, today),
  client.getDailyHrvSummaries(start, today),
]);
const hrvByDate = new Map((hrv?.hrvSummaries ?? []).map((day) => [day.calendarDate, day]));

/** @param {number | null | undefined} seconds */
const hours = (seconds) =>
  seconds == null ? '-' : `${Math.floor(seconds / 3600)}:${String(Math.round((seconds % 3600) / 60)).padStart(2, '0')}`;

const rows = (sleeps ?? []).map((night) => {
  const nightHrv = hrvByDate.get(night.calendarDate);
  return {
    Date: night.calendarDate,
    Sleep: hours(night.sleepTimeSeconds),
    Deep: hours(night.deepSleepSeconds),
    Light: hours(night.lightSleepSeconds),
    REM: hours(night.remSleepSeconds),
    Score: night.sleepScores?.overall?.value ?? '-',
    'Resting HR': night.avgHeartRate ?? '-',
    HRV: nightHrv?.lastNightAvg ?? '-',
    'HRV status': nightHrv?.status ?? '-',
  };
});

if (rows.length === 0) {
  console.log(`No sleep data in the last ${days} days.`);
} else {
  console.table(rows);
  const scored = rows.map((row) => row.Score).filter((score) => typeof score === 'number');
  const slept = (sleeps ?? []).map((night) => night.sleepTimeSeconds).filter((s) => typeof s === 'number');
  const average = (/** @type {number[]} */ list) => list.reduce((sum, n) => sum + n, 0) / list.length;
  console.log(
    `Average sleep ${hours(average(slept))}` +
      (scored.length ? `, average score ${Math.round(average(scored))}` : ''),
  );
}

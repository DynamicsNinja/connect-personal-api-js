// Export one row per day of steps, heart rate, stress, Body Battery, and sleep to CSV.
//
// Usage: node examples/export-daily-csv.js [--start-date DATE] [--end-date DATE] [--output FILE]
// Defaults to the last 30 days, written to stdout.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { GarminPersonalApiClient, PersonalApiAuthenticator, resolveApiKey } from '../src/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Request long ranges in chunks to keep each response small.
const CHUNK_DAYS = 28;

const { values } = parseArgs({
  options: {
    'start-date': { type: 'string' },
    'end-date': { type: 'string' },
    output: { type: 'string', short: 'o' },
  },
});

/** @param {Date} date */
const iso = (date) => date.toISOString().slice(0, 10);
const end = values['end-date'] ? new Date(`${values['end-date']}T00:00:00Z`) : new Date(`${iso(new Date())}T00:00:00Z`);
const start = values['start-date']
  ? new Date(`${values['start-date']}T00:00:00Z`)
  : new Date(end.getTime() - 29 * DAY_MS);

const token = await new PersonalApiAuthenticator().obtainToken(resolveApiKey());
const client = new GarminPersonalApiClient(token.accessToken);

/** @type {Map<string, Record<string, unknown>>} */
const days = new Map();
for (let chunkStart = start; chunkStart <= end; chunkStart = new Date(chunkStart.getTime() + CHUNK_DAYS * DAY_MS)) {
  const chunkEnd = new Date(Math.min(end.getTime(), chunkStart.getTime() + (CHUNK_DAYS - 1) * DAY_MS));
  const [summaries, sleeps] = await Promise.all([
    client.getDailySummaries(iso(chunkStart), iso(chunkEnd)),
    client.getDailySleepSummaries(iso(chunkStart), iso(chunkEnd)),
  ]);
  // Days without data can come back as entries with no calendarDate; skip them.
  for (const day of summaries?.data ?? []) {
    if (!day?.calendarDate) continue;
    days.set(day.calendarDate, {
      date: day.calendarDate,
      steps: day.movement?.steps?.value,
      step_goal: day.movement?.steps?.goal,
      distance_m: day.movement?.steps?.distanceInMeters,
      floors: day.movement?.floorsAscended?.value,
      calories_total: day.calories?.burnedTotal,
      calories_active: day.calories?.burnedActive,
      resting_hr: day.heartRate?.restingValue,
      max_hr: day.heartRate?.maxValue,
      stress_avg: day.stress?.avgLevel,
      body_battery_min: day.bodyBattery?.minValue,
      body_battery_max: day.bodyBattery?.maxValue,
      intensity_min_moderate: day.intensityMinutes?.moderate,
      intensity_min_vigorous: day.intensityMinutes?.vigorous,
    });
  }
  for (const night of sleeps ?? []) {
    if (!night?.calendarDate) continue;
    const row = days.get(night.calendarDate) ?? { date: night.calendarDate };
    row.sleep_hours = night.sleepTimeSeconds == null ? undefined : (night.sleepTimeSeconds / 3600).toFixed(2);
    row.sleep_score = night.sleepScores?.overall?.value;
    days.set(night.calendarDate, row);
  }
}

const columns = [
  'date', 'steps', 'step_goal', 'distance_m', 'floors', 'calories_total', 'calories_active',
  'resting_hr', 'max_hr', 'stress_avg', 'body_battery_min', 'body_battery_max',
  'intensity_min_moderate', 'intensity_min_vigorous', 'sleep_hours', 'sleep_score',
];
/** @param {unknown} value */
const cell = (value) => {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const lines = [columns.join(',')];
for (const date of [...days.keys()].sort()) {
  const row = /** @type {Record<string, unknown>} */ (days.get(date));
  lines.push(columns.map((column) => cell(row[column])).join(','));
}
const csv = `${lines.join('\n')}\n`;

if (values.output) {
  await writeFile(values.output, csv);
  console.error(`Wrote ${lines.length - 1} days to ${values.output}`);
} else {
  process.stdout.write(csv);
}

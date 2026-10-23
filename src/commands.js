// The command list shared by the CLI and interactive menu.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

/** @typedef {'date' | 'date_range' | 'date_with_today' | 'none' | 'activities' | 'activity'} InputKind */

/**
 * Describe how the CLI and interactive menu invoke one client method.
 * @typedef {object} CommandSpec
 * @property {string} command
 * @property {string} label
 * @property {keyof import('./client.js').GarminPersonalApiClient} method
 * @property {InputKind} inputKind
 * @property {'json' | 'download'} outputKind
 * @property {string | null} description
 */

// Shared by the CLI subcommand and the interactive menu action; not a data command.
export const TOKEN_REFRESH_COMMAND = 'refresh-token';

/**
 * @param {string} command
 * @param {string} label
 * @param {CommandSpec['method']} method
 * @param {InputKind} inputKind
 * @param {{outputKind?: CommandSpec['outputKind'], description?: string}} [options]
 * @returns {Readonly<CommandSpec>}
 */
function spec(command, label, method, inputKind, { outputKind = 'json', description } = {}) {
  return Object.freeze({
    command,
    label,
    method,
    inputKind,
    outputKind,
    description: description ?? null,
  });
}

export const COMMANDS = Object.freeze([
  spec('activities', 'Activities', 'searchActivities', 'activities'),
  spec('stress', 'Daily Stress', 'getDailyStress', 'date_range'),
  spec('steps', 'Daily Steps', 'getDailySteps', 'date_range'),
  spec('hydration', 'Daily Hydration', 'getDailyHydration', 'date_range'),
  spec('effective-weight-goals', 'Effective Weight Goals', 'getEffectiveWeightGoals', 'date_range'),
  spec('weight-measurements', 'Weight Measurements', 'getWeightMeasurements', 'date_range'),
  spec('food-logs', 'Food Logs', 'getDailyFoodLogs', 'date'),
  spec('profile-settings', 'User Profile Settings', 'getUserProfileSettings', 'none'),
  spec('sleep', 'Daily Sleep', 'getDailySleep', 'date'),
  spec('sleep-summaries', 'Daily Sleep Summaries', 'getDailySleepSummaries', 'date_range'),
  spec('body-battery', 'Daily Body Battery', 'getDailyBodyBattery', 'date_range'),
  spec('daily-summaries', 'User Daily Summaries', 'getDailySummaries', 'date_range'),
  spec('heart-rate', 'Daily Heart Rate', 'getDailyHeartRate', 'date'),
  spec('hrv', 'Daily HRV', 'getDailyHrv', 'date', {
    description: 'Get heart rate variability (HRV) summary and readings for a calendar date.',
  }),
  spec('hrv-summaries', 'Daily HRV Summaries', 'getDailyHrvSummaries', 'date_range', {
    description: 'Get daily heart rate variability (HRV) summaries for an inclusive date range.',
  }),
  spec('heart-rate-zones', 'Heart Rate Zones', 'getHeartRateZones', 'none'),
  spec('menstrual-cycle-summary', 'Menstrual Cycle Summary', 'getMenstrualCycleSummary', 'date'),
  spec(
    'menstrual-cycle-day-view',
    'Menstrual Cycle Day View',
    'getMenstrualCycleDayView',
    'date_with_today',
  ),
  spec('fitness-age', 'Fitness Age', 'getFitnessAge', 'date'),
  spec('spo2', 'Daily SpO2', 'getDailySpo2', 'date'),
  spec(
    'wellness-activity-summaries',
    'Wellness Activity Summaries',
    'getWellnessActivitySummaries',
    'date_range',
  ),
  spec('activity', 'Activity Details', 'getActivity', 'activity'),
  spec('activity-workouts', 'Activity Workouts', 'getActivityWorkouts', 'activity'),
  spec('activity-download', 'Download original activity file', 'downloadActivity', 'activity', {
    outputKind: 'download',
  }),
]);

/** @type {ReadonlyMap<string, Readonly<CommandSpec>>} */
export const COMMANDS_BY_NAME = new Map(COMMANDS.map((command) => [command.command, command]));

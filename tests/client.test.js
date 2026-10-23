// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { inspect } from 'node:util';

import { BASE_URL_ENV_VAR } from '../src/constants.js';
import {
  DEFAULT_BASE_URL,
  GarminPersonalApiClient,
  GarminPersonalApiError,
  HttpError,
} from '../src/index.js';
import { recordingLogger, stubFetch } from './helpers.js';

const START = '2026-08-20';
const END = '2026-08-24';
const RANGE = { startDate: START, endDate: END };
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('binary'), 0xff]);

afterEach(() => {
  delete process.env[BASE_URL_ENV_VAR];
});

test('download returns bytes and keeps JSON headers for other requests', async () => {
  const fetchImpl = stubFetch({ body: ZIP });
  const client = new GarminPersonalApiClient('token', { fetch: fetchImpl, timeoutSeconds: 12 });

  assert.deepEqual(await client.downloadActivity(123), ZIP);
  const [call] = fetchImpl.calls;
  assert.equal(call.url, `${DEFAULT_BASE_URL}/download-service/files/activity/123`);
  assert.equal(
    call.headers.Accept,
    'application/zip, application/x-zip-compressed, application/octet-stream',
  );
  assert.equal(call.headers.Authorization, 'Bearer token');

  const jsonClient = new GarminPersonalApiClient('token', { fetch: stubFetch({ body: '{"ok": true}' }) });
  assert.deepEqual(await jsonClient.get('/example'), { ok: true });
});

test('JSON requests send the JSON Accept header', async () => {
  const fetchImpl = stubFetch({ payload: {} });
  await new GarminPersonalApiClient('token', { fetch: fetchImpl }).get('/example');
  assert.equal(fetchImpl.calls[0].headers.Accept, 'application/json');
});

for (const activityId of ['../file', '0', '000', '-1', 'abc', '１２３', '1.5', '']) {
  test(`download rejects an invalid ID: ${JSON.stringify(activityId)}`, async () => {
    const client = new GarminPersonalApiClient('token', { fetch: stubFetch() });
    await assert.rejects(client.downloadActivity(activityId), /positive integer/);
  });
}

for (const status of [401, 404, 429, 500]) {
  test(`download preserves HTTP errors (${status})`, async () => {
    const fetchImpl = stubFetch({ payload: { error: 'unavailable' }, status });
    await assert.rejects(
      new GarminPersonalApiClient('token', { fetch: fetchImpl }).downloadActivity('123'),
      (error) => error instanceof HttpError && error.statusCode === status,
    );
  });
}

test('download rejects an empty response', async () => {
  const fetchImpl = stubFetch({ body: '' });
  await assert.rejects(
    new GarminPersonalApiClient('token', { fetch: fetchImpl }).downloadActivity(123),
    (error) => error instanceof GarminPersonalApiError && /empty/.test(error.message),
  );
});

/** @type {[string, (client: GarminPersonalApiClient) => Promise<unknown>, string, Record<string, string> | null][]} */
const ENDPOINTS = [
  ['stress', (c) => c.getDailyStress(new Date(2026, 7, 20), END), `/usersummary-service/stats/stress/daily/${START}/${END}`, null],
  ['steps', (c) => c.getDailySteps(START, new Date(2026, 7, 24)), `/usersummary-service/stats/steps/daily/${START}/${END}`, null],
  ['hydration', (c) => c.getDailyHydration(START, END), `/usersummary-service/stats/hydration/daily/${START}/${END}`, null],
  ['effective-weight-goals', (c) => c.getEffectiveWeightGoals(START, END), `/goal-service/goal/user/effective/weightgoal/${START}/${END}`, null],
  ['weight-measurements', (c) => c.getWeightMeasurements(START, END), `/weight-service/weight/range/${START}/${END}`, { includeAll: 'true' }],
  ['food-logs', (c) => c.getDailyFoodLogs(END), `/nutrition-service/food/logs/${END}`, null],
  ['profile-settings', (c) => c.getUserProfileSettings(), '/userprofile-service/userprofile/settings', null],
  ['sleep', (c) => c.getDailySleep(END), '/sleep-service/sleep/dailySleep', { date: END }],
  ['sleep-summaries', (c) => c.getDailySleepSummaries(START, END), '/sleep-service/sleep/dailySleepSummariesByDate', RANGE],
  ['body-battery', (c) => c.getDailyBodyBattery(START, END), '/wellness-service/wellness/bodyBattery/reports/daily', RANGE],
  ['body-battery-chunks', (c) => c.getDailyBodyBattery(START, END, { chunks: 2 }), '/wellness-service/wellness/bodyBattery/reports/daily', { ...RANGE, chunks: '2' }],
  ['daily-summaries', (c) => c.getDailySummaries(START, END), '/usersummary-service/v2/dailysummaries', RANGE],
  ['heart-rate', (c) => c.getDailyHeartRate(END), '/wellness-service/wellness/dailyHeartRate', { date: END }],
  ['hrv', (c) => c.getDailyHrv(END), `/hrv-service/hrv/${END}`, null],
  ['hrv-summaries', (c) => c.getDailyHrvSummaries(START, END), `/hrv-service/hrv/daily/${START}/${END}`, null],
  ['heart-rate-zones', (c) => c.getHeartRateZones(), '/biometric-service/heartRateZones/v2', null],
  ['menstrual-cycle-summary', (c) => c.getMenstrualCycleSummary(END), `/periodichealth-service/menstrualcycle/summary/${END}`, null],
  ['menstrual-cycle-day-view', (c) => c.getMenstrualCycleDayView(START, END), `/periodichealth-service/menstrualcycle/dayview/${START}`, { todayDate: END }],
  ['fitness-age', (c) => c.getFitnessAge(END), `/fitnessage-service/fitnessage/v2/${END}`, null],
  ['spo2', (c) => c.getDailySpo2(END), `/wellness-service/wellness/daily/spo2acclimation/${END}`, null],
  ['wellness-activity-summaries', (c) => c.getWellnessActivitySummaries(START, END), `/wellnessactivity-service/activity/summary/range/${START}/${END}`, null],
  ['activities-defaults', (c) => c.searchActivities(), '/activitylist-service/activities/search/activities', { start: '0', limit: '20' }],
  [
    'activities-filters',
    (c) => c.searchActivities({ start: 5, limit: 10, startDate: START, endDate: new Date(2026, 7, 24), activityType: 'running' }),
    '/activitylist-service/activities/search/activities',
    { start: '5', limit: '10', ...RANGE, activityType: 'running' },
  ],
  ['activity', (c) => c.getActivity(123456789), '/activity-service/activity/123456789', null],
  ['activity-workouts', (c) => c.getActivityWorkouts('123456789'), '/activity-service/activity/123456789/workouts', null],
];

for (const [name, call, path, params] of ENDPOINTS) {
  test(`endpoint wrapper sends the expected request: ${name}`, async () => {
    const fetchImpl = stubFetch({ payload: { ok: true } });

    assert.deepEqual(await call(new GarminPersonalApiClient('token', { fetch: fetchImpl })), { ok: true });
    const [request] = fetchImpl.calls;
    assert.equal(request.method, 'GET');
    assert.equal(request.url, `${DEFAULT_BASE_URL}${path}`);
    assert.deepEqual(request.params, params);
  });
}

test('single-day summaries preserve the collection response', async () => {
  const payload = { data: [{ calendarDate: END, movement: { steps: 123 } }] };
  const fetchImpl = stubFetch({ payload });
  const client = new GarminPersonalApiClient('token', { fetch: fetchImpl });

  assert.deepEqual(await client.getDailySummaries(END, END), payload);
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].url.endsWith('/usersummary-service/v2/dailysummaries'));
  assert.deepEqual(fetchImpl.calls[0].params, { startDate: END, endDate: END });
});

test('requests send the bearer token and log the path without it', async () => {
  const fetchImpl = stubFetch({ payload: {} });
  const logger = recordingLogger();
  const client = new GarminPersonalApiClient('secret-bearer-token', { fetch: fetchImpl, logger });

  await client.getDailySleep(END);

  assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bearer secret-bearer-token');
  const text = logger.messages.join('\n');
  assert.ok(text.includes(`GET /sleep-service/sleep/dailySleep?date=${END}`));
  assert.ok(!text.includes('secret-bearer-token'));
});

test('updateBearerToken is used for subsequent requests', async () => {
  const fetchImpl = stubFetch({ payload: {} });
  const client = new GarminPersonalApiClient('old-token', { fetch: fetchImpl });

  client.updateBearerToken('new-token');
  await client.getUserProfileSettings();

  assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bearer new-token');
});

test('get supports endpoints without a wrapper', async () => {
  const fetchImpl = stubFetch({ payload: { custom: true } });
  const client = new GarminPersonalApiClient('token', { fetch: fetchImpl });

  assert.deepEqual(await client.get('/custom-service/resource', { params: { page: 2 } }), {
    custom: true,
  });
  assert.equal(fetchImpl.calls[0].url, `${DEFAULT_BASE_URL}/custom-service/resource`);
  assert.deepEqual(fetchImpl.calls[0].params, { page: '2' });
});

test('an empty response returns null', async () => {
  const fetchImpl = stubFetch({ status: 204, body: '' });
  assert.equal(await new GarminPersonalApiClient('token', { fetch: fetchImpl }).getDailyHrv(END), null);
});

for (const status of [429, 500]) {
  test(`HTTP errors include the status and response body (${status})`, async () => {
    const fetchImpl = stubFetch({ body: '{"message": "try later"}', status });

    await assert.rejects(
      new GarminPersonalApiClient('token', { fetch: fetchImpl }).getDailyHrv(END),
      (error) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, status);
        assert.equal(error.responseText, '{"message": "try later"}');
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.match(error.message, /try later/);
        return true;
      },
    );
  });
}

test('the base URL can be overridden by the environment', () => {
  process.env[BASE_URL_ENV_VAR] = 'https://example.test/';
  assert.equal(new GarminPersonalApiClient('token').baseUrl, 'https://example.test');
});

test('a request that exceeds the timeout is aborted', async () => {
  /** @type {typeof fetch} */
  const slowFetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });
  const client = new GarminPersonalApiClient('token', { fetch: slowFetch, timeoutSeconds: 0.01 });
  // AbortSignal.timeout() doesn't keep the event loop alive, and this fake
  // request holds no socket, so keep the process running until it fires.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await assert.rejects(client.getUserProfileSettings(), { name: 'TimeoutError' });
  } finally {
    clearTimeout(keepAlive);
  }
});

test('inspecting the client does not include the bearer token', () => {
  const client = new GarminPersonalApiClient('secret-token');
  assert.doesNotMatch(inspect(client), /secret-token/);
  assert.doesNotMatch(JSON.stringify(client), /secret-token/);
});

// Endpoint wrappers for the Garmin Personal API.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { inspect } from 'node:util';

import { BASE_URL_ENV_VAR, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_SECONDS } from './constants.js';
import { GarminPersonalApiError, HttpError } from './errors.js';
import { RequestScope, resolveBaseUrl, validateTimeout } from './http.js';
import { defaultLogger } from './logging.js';

/** @typedef {string | Date} CalendarDate A `YYYY-MM-DD` string, or a `Date` formatted in local time. */
/** @typedef {Record<string, string | number | boolean | null | undefined>} QueryParams */
/** @typedef {any} JsonValue */

/**
 * @typedef {object} GarminPersonalApiClientOptions
 * @property {number} [timeoutSeconds] Request timeout in seconds.
 * @property {typeof fetch} [fetch] Fetch implementation; defaults to the global `fetch`.
 * @property {import('./logging.js').Logger} [logger]
 */

/** Read Garmin data using an already-issued bearer token. */
export class GarminPersonalApiClient {
  /** @type {Record<string, string>} */
  #headers = {};
  #requests;

  /**
   * @param {string} bearerToken
   * @param {GarminPersonalApiClientOptions} [options]
   */
  constructor(
    bearerToken,
    { timeoutSeconds = DEFAULT_TIMEOUT_SECONDS, fetch: fetchImpl = globalThis.fetch, logger = defaultLogger } = {},
  ) {
    validateTimeout(timeoutSeconds);
    this.baseUrl = resolveBaseUrl(process.env[BASE_URL_ENV_VAR] ?? DEFAULT_BASE_URL);
    this.timeoutSeconds = timeoutSeconds;
    this.#requests = new RequestScope(fetchImpl, timeoutSeconds);
    this.logger = logger;
    this.updateBearerToken(bearerToken);
  }

  /** Abort in-flight requests. */
  close() {
    this.#requests.close();
  }

  [Symbol.dispose]() {
    this.close();
  }

  /** @returns {object} */
  [inspect.custom]() {
    return { baseUrl: this.baseUrl, timeoutSeconds: this.timeoutSeconds };
  }

  /**
   * Replace the token used for subsequent requests.
   * @param {string} bearerToken
   */
  updateBearerToken(bearerToken) {
    this.#headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    };
  }

  /**
   * Return daily stress statistics for an inclusive calendar date range.
   * @param {CalendarDate} startDate
   * @param {CalendarDate} endDate
   */
  getDailyStress(startDate, endDate) {
    return this.get(`/usersummary-service/stats/stress/daily/${iso(startDate)}/${iso(endDate)}`);
  }

  /**
   * Return daily step statistics for an inclusive calendar date range.
   * @param {CalendarDate} startDate
   * @param {CalendarDate} endDate
   */
  getDailySteps(startDate, endDate) {
    return this.get(`/usersummary-service/stats/steps/daily/${iso(startDate)}/${iso(endDate)}`);
  }

  /**
   * Return daily hydration statistics for an inclusive calendar date range.
   * @param {CalendarDate} startDate
   * @param {CalendarDate} endDate
   */
  getDailyHydration(startDate, endDate) {
    return this.get(
      `/usersummary-service/stats/hydration/daily/${iso(startDate)}/${iso(endDate)}`,
    );
  }

  /**
   * Return effective weight goals for an inclusive calendar date range.
   * @param {CalendarDate} startDate
   * @param {CalendarDate} endDate
   */
  getEffectiveWeightGoals(startDate, endDate) {
    return this.get(
      `/goal-service/goal/user/effective/weightgoal/${iso(startDate)}/${iso(endDate)}`,
    );
  }

  /**
   * Return all weight data for an inclusive calendar date range.
   * @param {CalendarDate} startDate
   * @param {CalendarDate} endDate
   */
  getWeightMeasurements(startDate, endDate) {
    return this.get(`/weight-service/weight/range/${iso(startDate)}/${iso(endDate)}`, {
      params: { includeAll: 'true' },
    });
  }

  /**
   * Return nutrition food logs for a calendar date.
   * @param {CalendarDate} calendarDate
   */
  getDailyFoodLogs(calendarDate) {
    return this.get(`/nutrition-service/food/logs/${iso(calendarDate)}`);
  }

  /** Return the current user's profile settings. */
  getUserProfileSettings() {
    return this.get('/userprofile-service/userprofile/settings');
  }

  /**
   * Return daily sleep data for a calendar date.
   * @param {CalendarDate} calendarDate
   */
  getDailySleep(calendarDate) {
    return this.get('/sleep-service/sleep/dailySleep', { params: { date: iso(calendarDate) } });
  }

  /**
   * Return daily sleep summaries for an inclusive calendar date range.
   * @param {CalendarDate} startDate
   * @param {CalendarDate} endDate
   */
  getDailySleepSummaries(startDate, endDate) {
    return this.get('/sleep-service/sleep/dailySleepSummariesByDate', {
      params: { startDate: iso(startDate), endDate: iso(endDate) },
    });
  }

  /**
   * Return daily Body Battery data for an inclusive calendar date range.
   * @param {CalendarDate} startDate
   * @param {CalendarDate} endDate
   * @param {{chunks?: number | null}} [options]
   */
  getDailyBodyBattery(startDate, endDate, { chunks = null } = {}) {
    /** @type {QueryParams} */
    const params = { startDate: iso(startDate), endDate: iso(endDate) };
    if (chunks != null) {
      params.chunks = chunks;
    }
    return this.get('/wellness-service/wellness/bodyBattery/reports/daily', { params });
  }

  /**
   * Return user daily summaries for an inclusive calendar date range.
   *
   * Use the same start and end date for a single day. The response preserves
   * the endpoint's object containing a data array, even for one day.
   * @param {CalendarDate} startDate
   * @param {CalendarDate} endDate
   */
  getDailySummaries(startDate, endDate) {
    return this.get('/usersummary-service/v2/dailysummaries', {
      params: { startDate: iso(startDate), endDate: iso(endDate) },
    });
  }

  /**
   * Return heart rate variability (HRV) summary and readings for a calendar date.
   * @param {CalendarDate} calendarDate
   */
  getDailyHrv(calendarDate) {
    return this.get(`/hrv-service/hrv/${iso(calendarDate)}`);
  }

  /**
   * Return daily heart rate variability (HRV) summaries for an inclusive date range.
   * @param {CalendarDate} startDate
   * @param {CalendarDate} endDate
   */
  getDailyHrvSummaries(startDate, endDate) {
    return this.get(`/hrv-service/hrv/daily/${iso(startDate)}/${iso(endDate)}`);
  }

  /** Return the current user's heart rate zones. */
  getHeartRateZones() {
    return this.get('/biometric-service/heartRateZones/v2');
  }

  /**
   * Return fitness age data for a calendar date.
   * @param {CalendarDate} calendarDate
   */
  getFitnessAge(calendarDate) {
    return this.get(`/fitnessage-service/fitnessage/v2/${iso(calendarDate)}`);
  }

  /**
   * Return daily heart rate data for a calendar date.
   * @param {CalendarDate} calendarDate
   */
  getDailyHeartRate(calendarDate) {
    return this.get('/wellness-service/wellness/dailyHeartRate', {
      params: { date: iso(calendarDate) },
    });
  }

  /**
   * Return menstrual-cycle summary data for a calendar date.
   * @param {CalendarDate} calendarDate
   */
  getMenstrualCycleSummary(calendarDate) {
    return this.get(`/periodichealth-service/menstrualcycle/summary/${iso(calendarDate)}`);
  }

  /**
   * Return the menstrual-cycle day view for a calendar date.
   * @param {CalendarDate} calendarDate
   * @param {CalendarDate} todayDate
   */
  getMenstrualCycleDayView(calendarDate, todayDate) {
    return this.get(`/periodichealth-service/menstrualcycle/dayview/${iso(calendarDate)}`, {
      params: { todayDate: iso(todayDate) },
    });
  }

  /**
   * Return daily SpO2 and acclimation data for a calendar date.
   * @param {CalendarDate} calendarDate
   */
  getDailySpo2(calendarDate) {
    return this.get(`/wellness-service/wellness/daily/spo2acclimation/${iso(calendarDate)}`);
  }

  /**
   * Return wellness activity summaries for an inclusive calendar date range.
   * @param {CalendarDate} startDate
   * @param {CalendarDate} endDate
   */
  getWellnessActivitySummaries(startDate, endDate) {
    return this.get(
      `/wellnessactivity-service/activity/summary/range/${iso(startDate)}/${iso(endDate)}`,
    );
  }

  /**
   * Return summarized activities matching the supplied search filters.
   * @param {object} [filters]
   * @param {number} [filters.start] Zero-based result offset.
   * @param {number} [filters.limit] Maximum number of activities to return.
   * @param {CalendarDate | null} [filters.startDate]
   * @param {CalendarDate | null} [filters.endDate]
   * @param {string | null} [filters.activityType] Such as `running` or `hiking`.
   */
  searchActivities({ start = 0, limit = 20, startDate = null, endDate = null, activityType = null } = {}) {
    /** @type {QueryParams} */
    const params = { start, limit };
    if (startDate != null) {
      params.startDate = iso(startDate);
    }
    if (endDate != null) {
      params.endDate = iso(endDate);
    }
    if (activityType != null) {
      params.activityType = activityType;
    }
    return this.get('/activitylist-service/activities/search/activities', { params });
  }

  /**
   * Return the activity summary/details for an activity ID.
   * @param {number | string} activityId
   */
  getActivity(activityId) {
    return this.get(`/activity-service/activity/${activityId}`);
  }

  /**
   * Return workouts associated with an activity ID.
   * @param {number | string} activityId
   */
  getActivityWorkouts(activityId) {
    return this.get(`/activity-service/activity/${activityId}/workouts`);
  }

  /**
   * Return the original activity file as ZIP bytes, without extracting it.
   * @param {number | string | bigint} activityId
   * @returns {Promise<Buffer>}
   */
  async downloadActivity(activityId) {
    const id = String(activityId);
    if (!/^[0-9]+$/.test(id) || /^0+$/.test(id)) {
      throw new GarminPersonalApiError('activityId must be a positive integer');
    }
    const response = await this.#getResponse(`/download-service/files/activity/${id}`, {
      accept: 'application/zip, application/x-zip-compressed, application/octet-stream',
    });
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length === 0) {
      throw new GarminPersonalApiError('The original activity file response was empty');
    }
    return content;
  }

  /**
   * GET a Personal API path and return decoded JSON, or `null` if the body is empty.
   * @param {string} path
   * @param {{params?: QueryParams | null}} [options]
   * @returns {Promise<JsonValue>}
   */
  async get(path, { params = null } = {}) {
    const response = await this.#getResponse(path, { params });
    const text = await response.text();
    if (!text) {
      return null;
    }
    return JSON.parse(text);
  }

  /**
   * @param {string} path
   * @param {{params?: QueryParams | null, accept?: string}} [options]
   * @returns {Promise<Response>}
   */
  async #getResponse(path, { params = null, accept = 'application/json' } = {}) {
    const query = encodeParams(params);
    const url = `${this.baseUrl}${path}`;
    this.logger.info(`GET ${query ? `${path}?${query}` : path}`);
    const response = await this.#requests.fetch(query ? `${url}?${query}` : url, {
      method: 'GET',
      headers: { ...this.#headers, Accept: accept },
    });
    if (!response.ok) {
      throw new HttpError({
        statusCode: response.status,
        method: 'GET',
        url,
        responseText: await response.text(),
      });
    }
    return response;
  }
}

/**
 * @param {QueryParams | null} params
 * @returns {string}
 */
function encodeParams(params) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params ?? {})) {
    if (value != null) {
      search.append(name, String(value));
    }
  }
  return search.toString();
}

/**
 * Format a date as YYYY-MM-DD; strings are passed through to the API unchanged.
 * @param {CalendarDate} value
 * @returns {string}
 */
export function iso(value) {
  if (value instanceof Date) {
    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return value;
}

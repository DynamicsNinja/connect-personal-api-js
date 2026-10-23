// MCP server exposing the Garmin Connect Personal API as read-only tools.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  GarminPersonalApiClient,
  HttpError,
  PersonalApiAuthenticator,
  resolveApiKey,
} from 'garmin-connect-personal-api-js';
import { COMMANDS } from 'garmin-connect-personal-api-js/commands';
import { z } from 'zod';

const { version } = createRequire(import.meta.url)('../package.json');

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .describe('Calendar date in YYYY-MM-DD format. Defaults to today in the server\'s time zone.');

/** Context added to tool descriptions so models know when to use each tool. */
const HINTS = {
  activities: 'Returns summaries with activityId, name, type, start time, distance, duration, and heart rate. Use activityId with get_activity for full details.',
  'profile-settings': 'Includes units, time zone, and date format, which help interpret other responses.',
  sleep: 'Detailed sleep for one night, including stages, scores, and overnight readings.',
  'sleep-summaries': 'One summary per night, including duration, stages, and sleep score. Prefer this over get_daily_sleep for trends.',
  'daily-summaries': 'One summary per day with steps, calories, heart rate, stress, Body Battery, intensity minutes, and respiration. Use the same start and end date for a single day.',
  'heart-rate': 'All heart rate samples for one day; the response can be large.',
  'hrv-summaries': 'One HRV summary per night with weekly average, baseline, and status.',
};

/** @param {string} method */
const toolName = (method) => method.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** Today's local date as YYYY-MM-DD. */
function today() {
  const now = new Date();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Build the input schema and argument mapping for one command.
 * @param {import('garmin-connect-personal-api-js/commands').CommandSpec} spec
 * @returns {{schema: Record<string, z.ZodType>, args: (input: Record<string, any>) => unknown[]}}
 */
function toolInput(spec) {
  switch (spec.inputKind) {
    case 'date':
      return { schema: { date: DATE.optional() }, args: (input) => [input.date ?? today()] };
    case 'date_with_today':
      return {
        schema: {
          date: DATE.optional(),
          todayDate: DATE.optional().describe('Reference "today" date in YYYY-MM-DD format. Defaults to today.'),
        },
        args: (input) => [input.date ?? today(), input.todayDate ?? today()],
      };
    case 'date_range': {
      /** @type {Record<string, z.ZodType>} */
      const schema = {
        startDate: DATE.optional().describe('First date of the inclusive range, YYYY-MM-DD. Defaults to today.'),
        endDate: DATE.optional().describe('Last date of the inclusive range, YYYY-MM-DD. Defaults to today.'),
      };
      if (spec.command === 'body-battery') {
        schema.chunks = z.number().int().positive().optional().describe('Number of min/max Body Battery pairs per day.');
        return {
          schema,
          args: (input) => [input.startDate ?? today(), input.endDate ?? today(), { chunks: input.chunks ?? null }],
        };
      }
      return { schema, args: (input) => [input.startDate ?? today(), input.endDate ?? today()] };
    }
    case 'activities':
      return {
        schema: {
          start: z.number().int().min(0).optional().describe('Zero-based result offset. Defaults to 0.'),
          limit: z.number().int().min(1).max(100).optional().describe('Maximum number of activities. Defaults to 20.'),
          startDate: DATE.optional().describe('Only activities on or after this date, YYYY-MM-DD.'),
          endDate: DATE.optional().describe('Only activities on or before this date, YYYY-MM-DD.'),
          activityType: z.string().optional().describe('Activity type filter, such as running, cycling, or hiking.'),
        },
        args: (input) => [{ ...input }],
      };
    case 'activity':
      return {
        schema: { activityId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).describe('Activity ID from search_activities.') },
        args: (input) => [input.activityId],
      };
    default:
      return { schema: {}, args: () => [] };
  }
}

/**
 * Provide a data client, obtaining and refreshing bearer tokens as needed.
 *
 * The key is resolved on first use from GARMIN_PERSONAL_API_KEY or the default
 * key file, and tokens are cached in the same file the gc-personal CLI uses.
 */
export function createClientProvider({
  Authenticator = PersonalApiAuthenticator,
  Client = GarminPersonalApiClient,
  resolveKey = () => resolveApiKey(),
} = {}) {
  /** @type {{authenticator: PersonalApiAuthenticator, apiKey: string, client: GarminPersonalApiClient} | null} */
  let state = null;
  // MCP uses stdout for protocol messages, so warnings must go to stderr only.
  const logger = { info() {}, warn: (/** @type {string} */ message) => process.stderr.write(`${message}\n`) };

  /** @param {boolean} forceRefresh */
  return async (forceRefresh = false) => {
    if (state === null) {
      const apiKey = resolveKey();
      const authenticator = new Authenticator({ logger });
      const token = await authenticator.obtainToken(apiKey);
      state = { authenticator, apiKey, client: new Client(token.accessToken, { logger }) };
      return state.client;
    }
    // The cache check is cheap and keeps long-running sessions on a valid token.
    const token = await state.authenticator.obtainToken(state.apiKey, { forceRefresh });
    state.client.updateBearerToken(token.accessToken);
    return state.client;
  };
}

/**
 * Call the API, retrying once with a fresh token if the cached one was rejected.
 * @param {(forceRefresh?: boolean) => Promise<GarminPersonalApiClient>} getClient
 * @param {(client: GarminPersonalApiClient) => Promise<unknown>} call
 */
async function callTool(getClient, call) {
  try {
    let result;
    try {
      result = await call(await getClient());
    } catch (error) {
      if (!(error instanceof HttpError && error.statusCode === 401)) {
        throw error;
      }
      result = await call(await getClient(true));
    }
    const text = result == null ? 'No data for this request.' : JSON.stringify(result);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}

/**
 * Create the MCP server with one read-only tool per Personal API endpoint.
 * @param {{getClient?: (forceRefresh?: boolean) => Promise<GarminPersonalApiClient>}} [options]
 */
export function createServer({ getClient = createClientProvider() } = {}) {
  const server = new McpServer(
    { name: 'garmin-connect-personal-api', version },
    {
      instructions:
        'Read-only access to the user\'s Garmin Connect data through the official Personal API. ' +
        'Dates are YYYY-MM-DD; ranges are inclusive. Prefer summary tools for multi-day trends.',
    },
  );
  const annotations = { readOnlyHint: true, openWorldHint: true };

  for (const spec of COMMANDS) {
    // Activity files are binary ZIPs, which aren't useful as tool output.
    if (spec.outputKind === 'download') {
      continue;
    }
    const { schema, args } = toolInput(spec);
    const summary = spec.description ?? `Get ${spec.label.toLowerCase()}.`;
    const hint = HINTS[/** @type {keyof typeof HINTS} */ (spec.command)];
    server.registerTool(
      toolName(spec.method),
      {
        title: spec.label,
        description: hint ? `${summary} ${hint}` : summary,
        inputSchema: schema,
        annotations,
      },
      (input) =>
        callTool(getClient, (client) =>
          /** @type {(...params: unknown[]) => Promise<unknown>} */ (client[spec.method]).call(client, ...args(input)),
        ),
    );
  }

  server.registerTool(
    'api_get',
    {
      title: 'Personal API GET',
      description:
        'GET any Personal API path that has no dedicated tool, such as one from the Personal API Swagger documentation. ' +
        'The path starts with a slash, for example /usersummary-service/stats/steps/daily/2026-10-01/2026-10-07.',
      inputSchema: {
        path: z.string().regex(/^\/[^?#]*$/, 'Use a path starting with /, without a query string'),
        params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('Query parameters.'),
      },
      annotations,
    },
    ({ path, params }) => callTool(getClient, (client) => client.get(path, { params: params ?? null })),
  );

  return server;
}

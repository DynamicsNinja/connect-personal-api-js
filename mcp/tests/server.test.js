// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BearerToken, GarminPersonalApiClient, GarminPersonalApiError } from 'garmin-connect-personal-api-js';

import { createClientProvider, createServer } from '../src/server.js';

const BASE = 'https://personal.connectapi.garmin.com';

/**
 * A fetch stub that records requests and answers with `respond(url)`.
 * @param {(url: string, init: RequestInit) => Response} respond
 */
function stubFetch(respond) {
  /** @type {{url: string, authorization: string}[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    calls.push({
      url: String(input),
      authorization: /** @type {Record<string, string>} */ (init.headers).Authorization,
    });
    return respond(String(input), init);
  };
  return Object.assign(fetchImpl, { calls });
}

/** Connect an in-memory MCP client to a server using `getClient`. */
async function connect(/** @type {Parameters<typeof createServer>[0]} */ options) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(options).connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

/** @param {any} result */
const text = (result) => result.content[0].text;

test('lists one read-only tool per JSON endpoint plus api_get', async () => {
  const client = await connect({ getClient: async () => new GarminPersonalApiClient('token') });
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);

  assert.equal(tools.length, 24);
  for (const name of ['get_daily_sleep', 'get_daily_sleep_summaries', 'search_activities', 'get_activity', 'get_user_profile_settings', 'api_get']) {
    assert.ok(names.includes(name), `missing ${name}`);
  }
  assert.ok(!names.includes('download_activity'));
  assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint === true));
  const sleep = tools.find((tool) => tool.name === 'get_daily_sleep_summaries');
  assert.deepEqual(Object.keys(sleep?.inputSchema.properties ?? {}).sort(), ['endDate', 'startDate']);
});

test('calls the matching client method with tool arguments', async () => {
  const fetchImpl = stubFetch(() => Response.json({ ok: true }));
  const client = await connect({
    getClient: async () => new GarminPersonalApiClient('token', { fetch: fetchImpl }),
  });

  const result = await client.callTool({
    name: 'get_daily_steps',
    arguments: { startDate: '2026-10-01', endDate: '2026-10-07' },
  });

  assert.equal(text(result), '{"ok":true}');
  assert.equal(fetchImpl.calls[0].url, `${BASE}/usersummary-service/stats/steps/daily/2026-10-01/2026-10-07`);

  await client.callTool({ name: 'search_activities', arguments: { limit: 5, activityType: 'running' } });
  assert.equal(
    fetchImpl.calls[1].url,
    `${BASE}/activitylist-service/activities/search/activities?start=0&limit=5&activityType=running`,
  );

  await client.callTool({ name: 'get_daily_body_battery', arguments: { startDate: '2026-10-01', endDate: '2026-10-02', chunks: 2 } });
  assert.ok(fetchImpl.calls[2].url.endsWith('daily?startDate=2026-10-01&endDate=2026-10-02&chunks=2'));

  await client.callTool({ name: 'api_get', arguments: { path: '/custom-service/x', params: { page: 2 } } });
  assert.equal(fetchImpl.calls[3].url, `${BASE}/custom-service/x?page=2`);
});

test('date arguments are validated and default to today', async () => {
  const fetchImpl = stubFetch(() => Response.json({}));
  const client = await connect({
    getClient: async () => new GarminPersonalApiClient('token', { fetch: fetchImpl }),
  });

  const invalid = await client.callTool({ name: 'get_daily_sleep', arguments: { date: 'yesterday' } });
  assert.equal(invalid.isError, true);
  assert.equal(fetchImpl.calls.length, 0);

  await client.callTool({ name: 'get_daily_sleep', arguments: {} });
  assert.match(fetchImpl.calls[0].url, /dailySleep\?date=\d{4}-\d{2}-\d{2}$/);
});

test('API errors are returned as tool errors', async () => {
  const fetchImpl = stubFetch(() => new Response('try later', { status: 429 }));
  const client = await connect({
    getClient: async () => new GarminPersonalApiClient('token', { fetch: fetchImpl }),
  });

  const result = await client.callTool({ name: 'get_heart_rate_zones', arguments: {} });

  assert.equal(result.isError, true);
  assert.match(text(result), /HTTP 429: try later/);
});

test('empty responses are described instead of returning null', async () => {
  const client = await connect({
    getClient: async () =>
      new GarminPersonalApiClient('token', { fetch: stubFetch(() => new Response(null, { status: 204 })) }),
  });
  const result = await client.callTool({ name: 'get_menstrual_cycle_summary', arguments: {} });
  assert.equal(text(result), 'No data for this request.');
});

test('a rejected token is refreshed once and the call retried', async () => {
  const fetchImpl = stubFetch((_url, init) =>
    /** @type {Record<string, string>} */ (init.headers).Authorization === 'Bearer token-1'
      ? new Response('expired', { status: 401 })
      : Response.json({ ok: true }),
  );
  /** @type {boolean[]} */
  const refreshes = [];
  class StubAuthenticator {
    /** @param {string} _key @param {{forceRefresh?: boolean}} [options] */
    async obtainToken(_key, { forceRefresh = false } = {}) {
      refreshes.push(forceRefresh);
      return new BearerToken(`token-${refreshes.length}`, 0);
    }
  }
  const getClient = createClientProvider({
    Authenticator: /** @type {any} */ (StubAuthenticator),
    Client: /** @type {any} */ (
      class extends GarminPersonalApiClient {
        /** @param {string} token */
        constructor(token) {
          super(token, { fetch: fetchImpl });
        }
      }
    ),
    resolveKey: () => 'key',
  });
  const client = await connect({ getClient });

  const result = await client.callTool({ name: 'get_user_profile_settings', arguments: {} });

  assert.equal(text(result), '{"ok":true}');
  assert.deepEqual(refreshes, [false, true]);
  assert.deepEqual(fetchImpl.calls.map((call) => call.authorization), ['Bearer token-1', 'Bearer token-2']);
});

test('a missing API key is reported as a tool error', async () => {
  const getClient = createClientProvider({
    resolveKey: () => {
      throw new GarminPersonalApiError('No personal API key was provided.');
    },
  });
  const client = await connect({ getClient });
  const result = await client.callTool({ name: 'get_heart_rate_zones', arguments: {} });
  assert.equal(result.isError, true);
  assert.match(text(result), /No personal API key/);
});

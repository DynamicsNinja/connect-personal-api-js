// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { CliExit, executeCommand, main, parseCliArgs } from '../src/cli.js';
import { fsOps, saveDownload } from '../src/downloads.js';
import { BearerToken, DEFAULT_BASE_URL, GarminPersonalApiClient, HttpError, VERSION } from '../src/index.js';
import { INTERACTIVE_MENU_ITEMS, runInteractive, showActivity } from '../src/interactive.js';
import { todayIso } from '../src/terminal.js';
import { scriptedInput, stubFetch, tempDir, TextCapture } from './helpers.js';

const TODAY = todayIso();
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('binary'), 0xff]);
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.GARMIN_PERSONAL_API_KEY;
});

/**
 * @param {string[]} argv
 * @returns {CliExit}
 */
function parseExit(argv) {
  try {
    parseCliArgs(argv);
  } catch (error) {
    if (error instanceof CliExit) {
      return error;
    }
    throw error;
  }
  assert.fail(`Expected ${JSON.stringify(argv)} to exit`);
}

/** @param {string} text */
const collapse = (text) => text.split(/\s+/).join(' ');

/**
 * An authenticator stand-in that records each forceRefresh flag.
 * @param {boolean[]} tokens
 * @param {object[]} [instances]
 */
function stubAuthenticator(tokens, instances = []) {
  return class StubAuthenticator {
    /** @param {object} options */
    constructor(options) {
      this.options = options;
      instances.push(this);
    }

    /**
     * @param {string} apiKey
     * @param {{forceRefresh?: boolean}} [options]
     */
    async obtainToken(apiKey, { forceRefresh = false } = {}) {
      assert.equal(apiKey, 'personal-key');
      tokens.push(forceRefresh);
      return new BearerToken(`token-${tokens.length}`, 0);
    }

    close() {}
  };
}

/** @param {GarminPersonalApiClient} client */
function fixedClient(client) {
  return /** @type {typeof GarminPersonalApiClient} */ (
    /** @type {unknown} */ (
      function FixedClient() {
        return client;
      }
    )
  );
}

/** Run `main` with captured output and the given dependencies. */
async function run(/** @type {string[]} */ argv, /** @type {object} */ dependencies = {}) {
  const stdout = new TextCapture();
  const stderr = new TextCapture();
  const code = await main(argv, { stdout, stderr, env: {}, ...dependencies });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

test('interactive menu titles and order', () => {
  const expected = [
    ['Activities', 'activities'],
    ['Daily Stress', 'stress'],
    ['Daily Steps', 'steps'],
    ['Daily Hydration', 'hydration'],
    ['Effective Weight Goals', 'effective-weight-goals'],
    ['Weight Measurements', 'weight-measurements'],
    ['Food Logs', 'food-logs'],
    ['User Profile Settings', 'profile-settings'],
    ['Daily Sleep', 'sleep'],
    ['Daily Sleep Summaries', 'sleep-summaries'],
    ['Daily Body Battery', 'body-battery'],
    ['User Daily Summaries', 'daily-summaries'],
    ['Daily Heart Rate', 'heart-rate'],
    ['Daily HRV', 'hrv'],
    ['Daily HRV Summaries', 'hrv-summaries'],
    ['Heart Rate Zones', 'heart-rate-zones'],
    ['Menstrual Cycle Summary', 'menstrual-cycle-summary'],
    ['Menstrual Cycle Day View', 'menstrual-cycle-day-view'],
    ['Fitness Age', 'fitness-age'],
    ['Daily SpO2', 'spo2'],
    ['Wellness Activity Summaries', 'wellness-activity-summaries'],
    ['Reload Bearer Token', 'refresh-token'],
  ];
  assert.deepEqual(
    INTERACTIVE_MENU_ITEMS,
    expected.map(([label, command], index) => [index + 1, label, command]),
  );
});

describe('argument parsing', () => {
  for (const [command, expected] of [
    ['hrv', 'heart rate variability (HRV) summary and readings'],
    ['hrv-summaries', 'daily heart rate variability (HRV) summaries'],
  ]) {
    test(`${command} help describes the response granularity`, () => {
      const exit = parseExit([command, '--help']);
      assert.equal(exit.code, 0);
      assert.ok(collapse(exit.text).includes(expected));
    });
  }

  for (const command of ['weight-goal', 'weight', 'profile', 'summary', 'daily-summary', 'summaries', 'hrv-range', 'menstrual-cycle', 'wellness-activity']) {
    test(`replaced CLI name is rejected: ${command}`, () => {
      assert.equal(parseExit([command]).code, 2);
    });
  }

  for (const argv of [['--help'], ['activity-download', '--help']]) {
    test(`download help uses a natural action description: ${argv.join(' ')}`, () => {
      const exit = parseExit(argv);
      assert.equal(exit.code, 0);
      const helpText = collapse(exit.text);
      assert.ok(helpText.includes('Download original activity file.'));
      assert.ok(!helpText.includes('Get download'));
      if (argv[0] === 'activity-download') {
        assert.ok(helpText.includes('Activity ID to download.'));
      }
    });
  }

  test('an omitted key file option is distinct from an explicit file', () => {
    assert.equal(parseCliArgs(['profile-settings']).apiKeyFile, null);
  });

  test('--version prints the version', () => {
    const exit = parseExit(['--version']);
    assert.equal(exit.code, 0);
    assert.ok(exit.text.includes(VERSION));
  });

  for (const [optionArgs, key, expected] of [
    [['--api-key', 'personal-key'], 'apiKey', 'personal-key'],
    [['--api-key-file', 'api-key'], 'apiKeyFile', 'api-key'],
    [['--bearer-token-cache-file', 'bearer-token.json'], 'bearerTokenCacheFile', 'bearer-token.json'],
    [['--timeout', '12'], 'timeout', 12],
    [['--timeout=2.5'], 'timeout', 2.5],
    [['--quiet'], 'quiet', true],
    [['--no-color'], 'noColor', true],
  ]) {
    test(`shared option is parsed before the command: ${optionArgs[0]}`, () => {
      const args = parseCliArgs([.../** @type {string[]} */ (optionArgs), 'profile-settings']);
      assert.equal(args[/** @type {keyof typeof args} */ (key)], expected);
    });
  }

  for (const argv of [
    ['steps', '2026-08-20', '2026-08-24'],
    ['activity'],
    ['activity-workouts'],
    ['body-battery', '--chunks', 'x'],
    ['--timeout', 'soon', 'steps'],
    ['steps', '--date', TODAY],
    ['steps', '--api-key', 'key'],
  ]) {
    test(`invalid command arguments are rejected: ${argv.join(' ')}`, () => {
      assert.equal(parseExit(argv).code, 2);
    });
  }
});

describe('command dispatch', () => {
  /** @type {[string[], string, Record<string, string> | null][]} */
  const cases = [
    [['profile-settings'], '/userprofile-service/userprofile/settings', null],
    [['effective-weight-goals'], `/goal-service/goal/user/effective/weightgoal/${TODAY}/${TODAY}`, null],
    [['weight-measurements'], `/weight-service/weight/range/${TODAY}/${TODAY}`, { includeAll: 'true' }],
    [['daily-summaries'], '/usersummary-service/v2/dailysummaries', { startDate: TODAY, endDate: TODAY }],
    [
      ['daily-summaries', '--start-date', '2026-08-20', '--end-date', '2026-08-24'],
      '/usersummary-service/v2/dailysummaries',
      { startDate: '2026-08-20', endDate: '2026-08-24' },
    ],
    [['hrv'], `/hrv-service/hrv/${TODAY}`, null],
    [['hrv-summaries'], `/hrv-service/hrv/daily/${TODAY}/${TODAY}`, null],
    [['wellness-activity-summaries'], `/wellnessactivity-service/activity/summary/range/${TODAY}/${TODAY}`, null],
    [['sleep'], '/sleep-service/sleep/dailySleep', { date: TODAY }],
    [['sleep', '--date', '2026-08-24'], '/sleep-service/sleep/dailySleep', { date: '2026-08-24' }],
    [['steps', '--start-date', '2026-08-20', '--end-date', '2026-08-24'], '/usersummary-service/stats/steps/daily/2026-08-20/2026-08-24', null],
    [['steps', '--start-date', '2026-08-20'], `/usersummary-service/stats/steps/daily/2026-08-20/${TODAY}`, null],
    [['steps', '--end-date', '2026-08-24'], `/usersummary-service/stats/steps/daily/${TODAY}/2026-08-24`, null],
    [['body-battery', '--chunks', '3'], '/wellness-service/wellness/bodyBattery/reports/daily', { startDate: TODAY, endDate: TODAY, chunks: '3' }],
    [
      ['menstrual-cycle-day-view', '--date', '2026-08-20', '--today-date', '2026-08-24'],
      '/periodichealth-service/menstrualcycle/dayview/2026-08-20',
      { todayDate: '2026-08-24' },
    ],
    [['activities'], '/activitylist-service/activities/search/activities', { start: '0', limit: '20' }],
    [
      ['activities', '--start', '10', '--limit', '5', '--activity-type', 'running'],
      '/activitylist-service/activities/search/activities',
      { start: '10', limit: '5', activityType: 'running' },
    ],
    [['activity', '987654321'], '/activity-service/activity/987654321', null],
    [['activity-workouts', '987654321'], '/activity-service/activity/987654321/workouts', null],
  ];

  for (const [argv, expectedPath, params] of cases) {
    test(`dispatches ${argv.join(' ')}`, async () => {
      const fetchImpl = stubFetch({ payload: { ok: true } });
      const client = new GarminPersonalApiClient('token', { fetch: fetchImpl });

      const result = await executeCommand(client, parseCliArgs(argv));

      assert.equal(fetchImpl.calls.length, 1);
      const [call] = fetchImpl.calls;
      assert.deepEqual([call.method, call.url, call.params], ['GET', `${DEFAULT_BASE_URL}${expectedPath}`, params]);
      assert.deepEqual(result, { ok: true });
    });
  }
});

describe('downloads', () => {
  /** @type {GarminPersonalApiClient} */
  let downloadClient;
  /** @type {object} */
  let dependencies;

  beforeEach(() => {
    downloadClient = new GarminPersonalApiClient('token', { fetch: stubFetch({ body: ZIP }) });
    dependencies = { Authenticator: stubAuthenticator([]), Client: fixedClient(downloadClient) };
  });

  test('file options', async () => {
    const dir = tempDir();
    process.chdir(dir);
    const args = ['--api-key', 'personal-key', 'activity-download', '123'];
    const destination = path.join(dir, 'activity-123.zip');

    assert.equal((await run(args, dependencies)).code, 0);
    assert.deepEqual(readFileSync(destination), ZIP);
    writeFileSync(destination, 'existing');
    const refused = await run(args, dependencies);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /already exists/);
    assert.equal(readFileSync(destination, 'utf8'), 'existing');
    assert.equal((await run([...args, '--force'], dependencies)).code, 0);
    assert.deepEqual(readFileSync(destination), ZIP);
    const custom = await run([...args, '-o', 'custom.zip'], dependencies);
    assert.equal(custom.code, 0);
    assert.equal(custom.stdout, '');
    assert.deepEqual(readFileSync(path.join(dir, 'custom.zip')), ZIP);
    assert.deepEqual(readdirSync(dir).sort(), ['activity-123.zip', 'custom.zip']);
  });

  test('stdout', async () => {
    const result = await run(
      ['--api-key', 'personal-key', 'activity-download', '123', '-o', '-'],
      dependencies,
    );
    assert.equal(result.code, 0);
    assert.deepEqual(Buffer.from(result.stdout, 'latin1'), ZIP);
  });

  test('refuses to write to a terminal', async () => {
    const stdout = Object.assign(new TextCapture(), { isTTY: true });
    const stderr = new TextCapture();
    assert.equal(await main(['activity-download', '123', '-o', '-'], { stdout, stderr }), 1);
    assert.match(stderr.text, /terminal/);
  });

  test('a failed write preserves the existing file', async (t) => {
    const dir = tempDir();
    const destination = path.join(dir, 'original.zip');
    writeFileSync(destination, 'original');
    t.mock.method(fsOps, 'rename', async () => {
      throw new Error('disk error');
    });

    await assert.rejects(saveDownload(Buffer.from('new'), destination, { overwrite: true }), /disk error/);
    assert.equal(readFileSync(destination, 'utf8'), 'original');
    assert.deepEqual(readdirSync(dir), ['original.zip']);
  });

  test('refuses a dangling symlink', async (t) => {
    const dir = tempDir();
    const destination = path.join(dir, 'link.zip');
    try {
      symlinkSync(path.join(dir, 'missing'), destination);
    } catch {
      t.skip('symlinks are not permitted');
      return;
    }
    await assert.rejects(saveDownload(Buffer.from('new'), destination), /already exists/);
    assert.ok(lstatSync(destination).isSymbolicLink());
  });

  for (const overwrite of ['y', 'n']) {
    test(`interactive activity download (replace: ${overwrite})`, async () => {
      const destination = path.join(tempDir(), 'original.zip');
      writeFileSync(destination, 'existing');
      const output = new TextCapture();
      const errorOutput = new TextCapture();

      await showActivity(downloadClient, { activityId: 123 }, {
        inputFunc: scriptedInput(['3', destination, overwrite, 'b']),
        screen: { output, errorOutput, color: false },
      });

      const expected = overwrite === 'y' ? ZIP : Buffer.from('existing');
      assert.deepEqual(readFileSync(destination), expected);
      assert.ok(collapse(output.text).includes('3 download activity file'));
      assert.equal(errorOutput.text, '');
    });
  }

  test('interactive download default path and error recovery', async () => {
    const dir = tempDir();
    process.chdir(dir);
    const output = new TextCapture();
    const errorOutput = new TextCapture();

    await showActivity(downloadClient, { activityId: 123 }, {
      inputFunc: scriptedInput(['3', 'missing/run.zip', '3', 'b', '3', '', 'b']),
      screen: { output, errorOutput, color: false },
    });

    assert.deepEqual(readFileSync(path.join(dir, 'activity-123.zip')), ZIP);
    assert.match(errorOutput.text, /Cannot save/);
    assert.ok(output.text.includes('Saved activity-123.zip'));
  });
});

describe('main', () => {
  test('refresh-token forces a new token without calling the API', async () => {
    /** @type {boolean[]} */
    const tokens = [];
    const unexpectedClient = function () {
      throw new Error('refresh-token must not create a data client');
    };

    const result = await run(['--api-key', 'personal-key', 'refresh-token'], {
      Authenticator: stubAuthenticator(tokens),
      Client: unexpectedClient,
    });

    assert.equal(result.code, 0);
    assert.deepEqual(tokens, [true]);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Cached a new bearer token that expires at \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d/);
    assert.ok(!result.stderr.includes('token-1'));
  });

  for (const source of ['explicit-key', 'explicit-file', 'explicit-default-file', 'environment', 'default-file']) {
    test(`key source precedence: ${source}`, async () => {
      const dir = tempDir();
      const defaultKeyFile = path.join(dir, 'default-key');
      writeFileSync(
        defaultKeyFile,
        source === 'explicit-default-file' || source === 'default-file' ? 'personal-key' : 'other-key',
      );
      const keyFile = path.join(dir, 'explicit-key');
      writeFileSync(keyFile, source === 'explicit-file' ? 'personal-key' : 'other-key');
      const env =
        source === 'default-file'
          ? {}
          : { GARMIN_PERSONAL_API_KEY: source === 'environment' ? 'personal-key' : 'other-key' };
      /** @type {string[]} */
      let argv = [];
      if (source === 'explicit-key') {
        argv = ['--api-key', 'personal-key', '--api-key-file', keyFile];
      } else if (source === 'explicit-file') {
        argv = ['--api-key-file', keyFile];
      } else if (source === 'explicit-default-file') {
        argv = ['--api-key-file', defaultKeyFile];
      }
      /** @type {boolean[]} */
      const tokens = [];

      const result = await run([...argv, 'refresh-token'], {
        Authenticator: stubAuthenticator(tokens),
        env,
        defaultKeyFile,
      });

      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(tokens, [true]);
    });
  }

  for (const fileState of ['missing', 'empty', 'directory']) {
    test(`reports an invalid explicit key file without falling back (${fileState})`, async () => {
      const keyFile = path.join(tempDir(), 'key');
      if (fileState === 'empty') {
        writeFileSync(keyFile, ' \n');
      } else if (fileState === 'directory') {
        mkdirSync(keyFile);
      }
      /** @type {boolean[]} */
      const tokens = [];

      const result = await run(['--api-key-file', keyFile, 'refresh-token'], {
        Authenticator: stubAuthenticator(tokens),
        env: { GARMIN_PERSONAL_API_KEY: 'personal-key' },
      });

      assert.equal(result.code, 1);
      assert.deepEqual(tokens, []);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Error:/);
      assert.ok(result.stderr.includes(keyFile));
    });
  }

  test('executes a command', async () => {
    /** @type {boolean[]} */
    const tokens = [];
    /** @type {any[]} */
    const authenticators = [];
    const fetchImpl = stubFetch({ payload: { ok: true } });
    const client = new GarminPersonalApiClient('unused', { fetch: fetchImpl });
    /** @type {string[]} */
    const clientTokens = [];
    const StubClient = function (/** @type {string} */ bearerToken, /** @type {any} */ options) {
      clientTokens.push(bearerToken);
      client.logger = options.logger;
      return client;
    };
    const cacheFile = path.join(tempDir(), 'bearer-token.json');

    const result = await run(
      [
        '--api-key', 'personal-key',
        '--bearer-token-cache-file', cacheFile,
        'daily-summaries', '--start-date', '2026-08-24', '--end-date', '2026-08-24',
      ],
      { Authenticator: stubAuthenticator(tokens, authenticators), Client: StubClient },
    );

    assert.equal(result.code, 0, result.stderr);
    assert.equal(authenticators[0].options.bearerTokenCacheFile, cacheFile);
    assert.deepEqual(clientTokens, ['token-1']);
    assert.equal(fetchImpl.calls.length, 1);
    assert.ok(fetchImpl.calls[0].url.endsWith('/usersummary-service/v2/dailysummaries'));
    assert.deepEqual(fetchImpl.calls[0].params, { startDate: '2026-08-24', endDate: '2026-08-24' });
    assert.deepEqual(JSON.parse(result.stdout), { ok: true });
    assert.match(result.stderr, /INFO GET \/usersummary-service\/v2\/dailysummaries/);
  });

  test('--quiet suppresses request logs', async () => {
    const client = new GarminPersonalApiClient('unused', { fetch: stubFetch({ payload: {} }) });
    const result = await run(['--api-key', 'personal-key', '--quiet', 'profile-settings'], {
      Authenticator: stubAuthenticator([]),
      Client: function (/** @type {string} */ _token, /** @type {any} */ options) {
        client.logger = options.logger;
        return client;
      },
    });
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
  });

  test('prints JSON with sorted keys', async () => {
    const fetchImpl = stubFetch({ payload: { b: 1, a: { d: [1, 'ü'], c: null } } });
    const result = await run(['--api-key', 'personal-key', 'profile-settings'], {
      Authenticator: stubAuthenticator([]),
      Client: fixedClient(new GarminPersonalApiClient('unused', { fetch: fetchImpl })),
    });
    assert.equal(
      result.stdout,
      '{\n  "a": {\n    "c": null,\n    "d": [\n      1,\n      "ü"\n    ]\n  },\n  "b": 1\n}\n',
    );
  });

  test('reports errors', async () => {
    const failingClient = {
      get: async () => {
        throw new HttpError({ statusCode: 500, method: 'GET', url: '/x', responseText: 'boom' });
      },
      getUserProfileSettings() {
        return this.get();
      },
      close() {},
    };

    const result = await run(['--api-key', 'personal-key', 'profile-settings'], {
      Authenticator: stubAuthenticator([]),
      Client: fixedClient(/** @type {any} */ (failingClient)),
    });

    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes('Error: GET /x returned HTTP 500: boom'));
  });

  test('forces a token refresh from interactive mode', async () => {
    /** @type {boolean[]} */
    const tokens = [];
    /** @type {string[]} */
    const updatedTokens = [];
    const StubClient = function (/** @type {string} */ bearerToken) {
      assert.equal(bearerToken, 'token-1');
      return {
        updateBearerToken: (/** @type {string} */ token) => updatedTokens.push(token),
        close() {},
      };
    };
    const fakeRunInteractive = async (/** @type {any} */ _client, /** @type {any} */ options) => {
      await options.refreshToken();
      return 0;
    };

    const result = await run(['--api-key', 'personal-key', '--no-color'], {
      Authenticator: stubAuthenticator(tokens),
      Client: StubClient,
      interactive: fakeRunInteractive,
    });

    assert.equal(result.code, 0);
    assert.deepEqual(tokens, [false, true]);
    assert.deepEqual(updatedTokens, ['token-2']);
    assert.match(result.stdout, /> Checking bearer-token cache/);
  });
});

describe('interactive menu', () => {
  test('activity commands are excluded from the menu', async () => {
    const output = new TextCapture();
    const errorOutput = new TextCapture();

    await runInteractive(new GarminPersonalApiClient('token', { fetch: stubFetch() }), {
      inputFunc: scriptedInput(['activity', 'activity-workouts', 'q']),
      output,
      errorOutput,
      color: false,
    });

    assert.ok(!output.text.includes('Activity Details'));
    assert.ok(!output.text.includes('Activity Workouts'));
    assert.equal(errorOutput.text.match(/Invalid selection/g)?.length, 2);
  });

  test('shows the request and invokes the client', async () => {
    const fetchImpl = stubFetch({ payload: { ok: true } });
    const output = new TextCapture();
    const client = new GarminPersonalApiClient('token', { fetch: fetchImpl });
    const logger = client.logger;

    const code = await runInteractive(client, {
      inputFunc: scriptedInput(['stress', '2026-08-20', '2026-08-24', 'q']),
      output,
      errorOutput: new TextCapture(),
      color: false,
    });

    const requestPath = '/usersummary-service/stats/stress/daily/2026-08-20/2026-08-24';
    assert.equal(code, 0);
    assert.ok(fetchImpl.calls[0].url.endsWith(requestPath));
    assert.ok(output.text.includes(`> GET ${requestPath}`));
    assert.equal(client.logger, logger);
  });

  test('date prompts default to the previous answers and support back', async () => {
    const fetchImpl = stubFetch({ payload: {} });
    const prompts = /** @type {string[]} */ ([]);
    const answers = ['steps', '2026-08-20', '2026-08-24', 'steps', '', '', 'sleep', 'b', 'quit'];

    await runInteractive(new GarminPersonalApiClient('token', { fetch: fetchImpl }), {
      inputFunc: (prompt) => {
        prompts.push(prompt);
        return /** @type {string} */ (answers.shift());
      },
      output: new TextCapture(),
      errorOutput: new TextCapture(),
      color: false,
    });

    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(fetchImpl.calls[0].url, fetchImpl.calls[1].url);
    assert.ok(prompts.includes('Start date [default: 2026-08-20]: '));
    assert.ok(prompts.includes('Date [default: 2026-08-20]: '));
  });

  test('browses activities and pages through them', async () => {
    const activities = Array.from({ length: 12 }, (_, index) => ({
      activityId: index + 1,
      activityName: `Run ${index + 1}`,
      startTimeLocal: `2026-08-${String(index + 1).padStart(2, '0')} 07:00:00`,
    }));
    const fetchImpl = stubFetch(null, {
      responses: {
        [`${DEFAULT_BASE_URL}/activitylist-service/activities/search/activities`]: { payload: activities },
        [`${DEFAULT_BASE_URL}/activity-service/activity/12`]: { payload: { detail: true } },
      },
    });
    const output = new TextCapture();
    const errorOutput = new TextCapture();

    await runInteractive(new GarminPersonalApiClient('token', { fetch: fetchImpl }), {
      inputFunc: scriptedInput(['1', 'p', 'n', 'n', '2', '1', 'b', 'q']),
      output,
      errorOutput,
      color: false,
    });

    assert.deepEqual(fetchImpl.calls[0].params, { start: '0', limit: '30' });
    assert.ok(output.text.includes('Activities 11-12 of 12'));
    assert.ok(output.text.includes('Activity | 2026-08-12 07:00:00 | Run 12'));
    assert.ok(output.text.includes('"detail": true'));
    assert.match(errorOutput.text, /Already on the first page/);
    assert.match(errorOutput.text, /Already on the last page/);
  });

  test('errors are reported and the menu continues', async () => {
    const fetchImpl = stubFetch({ body: 'nope', status: 500 });
    const errorOutput = new TextCapture();

    const code = await runInteractive(new GarminPersonalApiClient('token', { fetch: fetchImpl }), {
      inputFunc: scriptedInput(['8', 'q']),
      output: new TextCapture(),
      errorOutput,
      color: false,
    });

    assert.equal(code, 0);
    assert.match(errorOutput.text, /Error: GET .* returned HTTP 500: nope/);
  });

  test('reload bearer token calls refreshToken', async () => {
    let refreshed = 0;
    const output = new TextCapture();

    await runInteractive(new GarminPersonalApiClient('token', { fetch: stubFetch() }), {
      inputFunc: scriptedInput([String(INTERACTIVE_MENU_ITEMS.length), 'q']),
      output,
      errorOutput: new TextCapture(),
      color: false,
      refreshToken: () => {
        refreshed += 1;
      },
    });

    assert.equal(refreshed, 1);
    assert.ok(output.text.includes('Bearer token refreshed.'));
  });
});

test('no stray files are left in the working directory', () => {
  assert.ok(!existsSync(path.join(originalCwd, 'activity-123.zip')));
});

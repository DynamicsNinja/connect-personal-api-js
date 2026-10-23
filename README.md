# Garmin Connect Personal API Client for JavaScript

[![npm](https://img.shields.io/npm/v/garmin-connect-personal-api-js)](https://www.npmjs.com/package/garmin-connect-personal-api-js)
[![CI](https://github.com/DynamicsNinja/connect-personal-api-js/actions/workflows/ci.yml/badge.svg)](https://github.com/DynamicsNinja/connect-personal-api-js/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/garmin-connect-personal-api-js)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/garmin-connect-personal-api-js)](LICENSE)

> **Unofficial.** This is a community port. It isn't affiliated with or endorsed by Garmin.

A JavaScript port of
[garmin/connect-personal-api-python](https://github.com/garmin/connect-personal-api-python),
a small client for reading data from
[Garmin's Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api).
It has no runtime dependencies, and its parts can be used independently:

- `PersonalApiAuthenticator` caches bearer tokens and exchanges a Personal API
  key for a new token when needed.
- `GarminPersonalApiClient` makes authenticated GET requests with any bearer
  token and provides convenience wrappers for Personal API data sets.
- `gc-personal` is a command-line interface built on those same wrappers, with
  direct commands for scripts and an interactive menu for exploring the data.
- [`garmin-connect-personal-api-mcp`](mcp/) is an MCP server that lets Claude
  and other AI assistants answer questions about your sleep, HRV, training,
  and more.

## Requirements and installation

You need Node.js 20.4 or newer and a Garmin Connect Personal API key.

```shell
npm install garmin-connect-personal-api-js   # library
npm install -g garmin-connect-personal-api-js  # adds the gc-personal command
```

To use a clone of this repository instead, run `npm install` and then
`npm link` to put `gc-personal` on your `PATH`, or run `node bin/gc-personal.js`.

The package is ESM-only and ships TypeScript declarations generated from its
JSDoc.

## Authentication

The package does not create Personal API keys. Create a key on
[Garmin Connect](https://connect.garmin.com/app/settings/personalApiToken).

### Command-line key sources

`gc-personal` reads the key from one of these sources:

1. **Key file:** `~/.config/garmin/connect-personal-api-key`, or another path
   passed with `--api-key-file`. On Windows, `~` is your user profile folder.
   The file should contain only the API key; surrounding whitespace is ignored.
2. **Environment variable:** `GARMIN_PERSONAL_API_KEY`.
3. **Command-line argument:** `--api-key`.

If more than one source is provided, precedence is:

1. Explicit key: `--api-key`.
2. Explicit key file: `--api-key-file`, even if it names the default path.
3. Environment variable: `GARMIN_PERSONAL_API_KEY`.
4. Default key file, when neither explicit option nor the environment variable
   supplies a key.

A missing, unreadable, or empty explicitly selected file is an error, not a
reason to fall back to the environment or default file. An empty explicit key
or environment variable is also an error. **A key passed with `--api-key` may
be exposed through shell history or the process list.**

```shell
gc-personal profile-settings                                   # default key file
gc-personal --api-key-file ~/my-garmin-key profile-settings    # another key file
GARMIN_PERSONAL_API_KEY='your-key' gc-personal profile-settings
gc-personal --api-key 'your-key' profile-settings              # visible to other processes
```

### JavaScript key sources

`obtainToken()` requires an explicit key and doesn't discover one itself. To
opt into discovery, pass it the result of `resolveApiKey()`, which applies the
same precedence as the CLI: `apiKey`, then `keyFile`, then
`GARMIN_PERSONAL_API_KEY`, then the default key file.

### Bearer-token cache

The authenticator exchanges the API key for a bearer token and caches it in
`~/.config/garmin/connect-personal-api-bearer-token.json`. Use
`--bearer-token-cache-file` in the CLI, or the `bearerTokenCacheFile` option,
to choose another location. The cache format is the same as the Python
client's, so the two can share a cache file.

A cached token is reused only when it was issued for the current API key and
base URL, and has more than one hour remaining before expiration, based on the
JWT `exp` claim. Otherwise, the authenticator obtains and caches a new token.

Rarely, a token stops working before it expires, for example because it was
revoked. Requests then fail with `401`, and the client doesn't retry them. To
recover, obtain a new token:

- **Direct commands:** run `gc-personal refresh-token`, or delete the cache
  file, then rerun the command.
- **Interactive mode:** choose **Reload Bearer Token** from the menu.
- **JavaScript:** call `obtainToken(apiKey, { forceRefresh: true })`, then pass
  the new token's `accessToken` to `client.updateBearerToken()`.

### Protecting credential files

The bearer-token cache, and the key file if you use one, hold plain-text
credentials. Keep them readable only by your user and out of version control.
On POSIX systems, the package logs a warning, but continues, when either file
is readable by group or other users. This check isn't performed on Windows.
The authenticator creates the cache file with `0600` permissions; an existing
cache file keeps its current permissions. Restrict your key file yourself, for
example with `chmod 600`.

## Command-line interface

```shell
gc-personal --help
gc-personal steps --help

gc-personal profile-settings
gc-personal sleep --date 2026-08-24
gc-personal steps --start-date 2026-08-20 --end-date 2026-08-24
gc-personal activities --start 0 --limit 20 --start-date 2026-08-01
gc-personal activity 123456789
gc-personal activity-workouts 123456789
gc-personal activity-download 123456789
gc-personal activity-download 123456789 -o ./run.zip
gc-personal refresh-token
gc-personal --api-key-file /path/to/key --timeout 20 --quiet profile-settings
```

Most date options default to today. Shared options such as `--api-key-file`
and `--timeout` go before the command. Use `--quiet` to suppress request logs
for non-interactive commands.

Data commands print JSON with sorted keys to stdout. Request logs, status
messages, and errors go to stderr, so output can be piped to tools such as
`jq`. The command exits with a non-zero status on failure (2 for invalid
arguments).

`activity-download` saves a ZIP file as `activity-ID.zip` in the current
directory unless `-o PATH` is given, and doesn't replace an existing file
unless you pass `--force`. Use `-o -` to write the ZIP bytes to stdout; the
command refuses to write them to a terminal.

### Interactive mode

Run `gc-personal` without a command to open a menu for exploring the data. It
authenticates through the same cache-aware path as direct commands and can
force a new token from the menu. On a terminal, date prompts accept the up and
down arrow keys to move the date by one day. Select an activity in the
activity browser to view its details or workouts, or to download its ZIP file.
Use `--no-color` or set `NO_COLOR` to disable colors.

## Library usage

### Explicit API key

```js
import { GarminPersonalApiClient, PersonalApiAuthenticator } from 'garmin-connect-personal-api-js';

const apiKey = await mySecretManager.get('garmin-personal-api-key');
const token = await new PersonalApiAuthenticator().obtainToken(apiKey);

const client = new GarminPersonalApiClient(token.accessToken);
const sleep = await client.getDailySleep('2026-08-24');
const steps = await client.getDailySteps('2026-08-20', '2026-08-24');
```

`obtainToken()` resolves to a `BearerToken` with the token string in
`accessToken` and its expiration, in seconds since the epoch, in `expiresAt`.
The token string is left out of `console.log()` and `JSON.stringify()` output.

### Key discovery

```js
import { PersonalApiAuthenticator, resolveApiKey } from 'garmin-connect-personal-api-js';

const token = await new PersonalApiAuthenticator().obtainToken(resolveApiKey());
```

To select a key file explicitly, use `resolveApiKey({ keyFile: '~/my-garmin-key' })`.
This overrides the environment variable. If the selected file is missing,
unreadable, or empty, discovery throws instead of trying another source.

### Bearer tokens from another source

```js
const client = new GarminPersonalApiClient(await myTokenProvider.getToken());
const profile = await client.getUserProfileSettings();
```

### Configuration

Both classes accept these options:

| Option | Default | Description |
| --- | --- | --- |
| `timeoutSeconds` | `30` | Per-request timeout. Must be greater than zero. |
| `fetch` | `globalThis.fetch` | A `fetch`-compatible function, for proxies, retries, or tests. |
| `logger` | silent info, warnings to stderr | An object with `info(message)` and `warn(message)`. Request activity is logged at `info`; tokens and keys are never logged. |

`PersonalApiAuthenticator` also accepts `bearerTokenCacheFile`. Set
`GARMIN_PERSONAL_API_BASE_URL` to use another API base URL.

`close()` aborts in-flight requests. Both classes also implement
`Symbol.dispose`, so they work with `using` declarations.

### Downloading activity files

`downloadActivity()` resolves to ZIP bytes in a `Buffer`, without writing or
extracting files:

```js
import { writeFile } from 'node:fs/promises';

const content = await client.downloadActivity(123456789);
await writeFile('activity-123456789.zip', content);
```

The whole ZIP is held in memory. Unlike the CLI, `writeFile()` overwrites an
existing file.

## Examples

The [`examples`](examples/) folder has ready-to-run scripts. Each one reads the
key the same way the CLI does.

| Script | What it does |
| --- | --- |
| [`sleep-report.js`](examples/sleep-report.js) | Prints a table of the last few nights' sleep stages, scores, and HRV |
| [`export-daily-csv.js`](examples/export-daily-csv.js) | Exports daily steps, heart rate, stress, Body Battery, and sleep to CSV for spreadsheets |
| [`backup-activities.js`](examples/backup-activities.js) | Downloads original activity files to a folder, skipping ones already saved; safe to schedule |
| [`fetch-sleep.js`](examples/fetch-sleep.js), [`fetch-activities.js`](examples/fetch-activities.js), [`get-token.js`](examples/get-token.js) | Minimal starting points |

```shell
node examples/sleep-report.js --days 14
node examples/export-daily-csv.js --start-date 2026-01-01 -o daily.csv
node examples/backup-activities.js --dir ~/garmin-activities
```

## AI assistants (MCP)

The [MCP server](mcp/) exposes every endpoint as a read-only tool, so you can
ask Claude Desktop, Claude Code, or another MCP client about your data. To add
it to Claude Code:

```shell
claude mcp add garmin --env GARMIN_PERSONAL_API_KEY=your-key -- npx -y garmin-connect-personal-api-mcp
```

See the [MCP server README](mcp/) for Claude Desktop and other clients.

## Endpoint wrappers

Every wrapper returns a promise of the decoded JSON response. Wrappers may lag
behind the endpoints available through the Personal API; see the
[Personal API Swagger documentation](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/),
and use `get()` for endpoints without a wrapper.

| JavaScript wrapper | CLI command | HTTP request |
| --- | --- | --- |
| `getDailyStress(startDate, endDate)` | `stress` | `GET /usersummary-service/stats/stress/daily/{startDate}/{endDate}` |
| `getDailySteps(startDate, endDate)` | `steps` | `GET /usersummary-service/stats/steps/daily/{startDate}/{endDate}` |
| `getDailyHydration(startDate, endDate)` | `hydration` | `GET /usersummary-service/stats/hydration/daily/{startDate}/{endDate}` |
| `getEffectiveWeightGoals(startDate, endDate)` | `effective-weight-goals` | `GET /goal-service/goal/user/effective/weightgoal/{startDate}/{endDate}` |
| `getWeightMeasurements(startDate, endDate)` | `weight-measurements` | `GET /weight-service/weight/range/{startDate}/{endDate}?includeAll=true` |
| `getDailyFoodLogs(calendarDate)` | `food-logs` | `GET /nutrition-service/food/logs/{calendarDate}` |
| `getUserProfileSettings()` | `profile-settings` | `GET /userprofile-service/userprofile/settings` |
| `getDailySleep(calendarDate)` | `sleep` | `GET /sleep-service/sleep/dailySleep?date={calendarDate}` |
| `getDailySleepSummaries(startDate, endDate)` | `sleep-summaries` | `GET /sleep-service/sleep/dailySleepSummariesByDate?startDate=…&endDate=…` |
| `getDailyBodyBattery(startDate, endDate, { chunks })` | `body-battery` | `GET /wellness-service/wellness/bodyBattery/reports/daily?startDate=…&endDate=…[&chunks=…]` |
| `getDailySummaries(startDate, endDate)` | `daily-summaries` | `GET /usersummary-service/v2/dailysummaries?startDate=…&endDate=…` |
| `getDailyHeartRate(calendarDate)` | `heart-rate` | `GET /wellness-service/wellness/dailyHeartRate?date={calendarDate}` |
| `getDailyHrv(calendarDate)` | `hrv` | `GET /hrv-service/hrv/{calendarDate}` |
| `getDailyHrvSummaries(startDate, endDate)` | `hrv-summaries` | `GET /hrv-service/hrv/daily/{startDate}/{endDate}` |
| `getHeartRateZones()` | `heart-rate-zones` | `GET /biometric-service/heartRateZones/v2` |
| `getMenstrualCycleSummary(calendarDate)` | `menstrual-cycle-summary` | `GET /periodichealth-service/menstrualcycle/summary/{calendarDate}` |
| `getMenstrualCycleDayView(calendarDate, todayDate)` | `menstrual-cycle-day-view` | `GET /periodichealth-service/menstrualcycle/dayview/{calendarDate}?todayDate=…` |
| `getFitnessAge(calendarDate)` | `fitness-age` | `GET /fitnessage-service/fitnessage/v2/{calendarDate}` |
| `getDailySpo2(calendarDate)` | `spo2` | `GET /wellness-service/wellness/daily/spo2acclimation/{calendarDate}` |
| `getWellnessActivitySummaries(startDate, endDate)` | `wellness-activity-summaries` | `GET /wellnessactivity-service/activity/summary/range/{startDate}/{endDate}` |
| `searchActivities({ start, limit, startDate, endDate, activityType })` | `activities` | `GET /activitylist-service/activities/search/activities?start=0&limit=20[&startDate=…&endDate=…&activityType=…]` |
| `getActivity(activityId)` | `activity` | `GET /activity-service/activity/{activityId}` |
| `getActivityWorkouts(activityId)` | `activity-workouts` | `GET /activity-service/activity/{activityId}/workouts` |
| `downloadActivity(activityId)` | `activity-download` | `GET /download-service/files/activity/{activityId}` (ZIP bytes) |

Dates accept `YYYY-MM-DD` strings or `Date` objects, which are formatted in
local time. Validation of dates, ranges, and other arguments is left to the
API, except download activity IDs, which must be positive integers.

### Call an endpoint without a wrapper

```js
const customData = await client.get('/some-service/some-resource', {
  params: { calendarDate: '2026-08-24' },
});
```

The client adds bearer-token authorization and resolves to decoded JSON. A
successful response with no content resolves to `null`.

## Errors

- `GarminPersonalApiError` for missing, unreadable, or empty credentials,
  invalid local settings such as a non-positive timeout or an invalid download
  activity ID, an empty download response, a token response that is not a JWT
  with an `exp` claim, or a download file that can't be saved by the CLI.
- `HttpError`, a subclass of `GarminPersonalApiError`, for unsuccessful token
  or data responses. It exposes `statusCode`, `method`, `url`, and
  `responseText`.
- Node.js file-system errors when the bearer-token cache can't be read or
  written, for example because of file permissions.

Network failures surface as the `TypeError` that `fetch` throws, timeouts as a
`TimeoutError` `DOMException`, and invalid JSON responses as a `SyntaxError`.

## Differences from the Python client

- Methods and options use camelCase, and network methods return promises.
- `timeout` is named `timeoutSeconds`; it is still in seconds.
- A custom `fetch` function replaces the `requests.Session` option, and a
  `logger` option replaces the `logging` module.
- Interactive mode is built in rather than an optional extra, and its date
  arrow-key navigation works on every platform, including Windows.

## Development

```shell
npm install
npm test           # node:test, no credentials or network access needed
npm run typecheck  # tsc over the JSDoc types
```

## License

Copyright 2026 Garmin Ltd. or its subsidiaries. This port is distributed under
the Apache 2.0 License. See [LICENSE](LICENSE) for the complete license text.

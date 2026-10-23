---
title: Export your Garmin sleep and HRV data with Node.js, and ask Claude about it
published: false
tags: garmin, node, javascript, ai
---

Garmin's **Personal API** is an official way to read your own Garmin Connect
data with a personal API key, instead of scraping the website. In this post
we'll use it from Node.js to:

1. Print a sleep and HRV report for the last week
2. Export a year of daily stats to CSV
3. Let Claude answer questions about your data

Everything below uses
[`garmin-connect-personal-api-js`](https://www.npmjs.com/package/garmin-connect-personal-api-js),
an unofficial, dependency-free client I ported from Garmin's Python reference
client. It isn't affiliated with Garmin.

## Get an API key

Open [Personal API Tokens](https://connect.garmin.com/app/settings/personalApiToken)
in Garmin Connect and create a key. Treat it like a password: anyone with it
can read your health data.

Save it where the client looks for it:

```shell
# macOS / Linux
mkdir -p ~/.config/garmin
echo 'your-key' > ~/.config/garmin/connect-personal-api-key
chmod 600 ~/.config/garmin/connect-personal-api-key
```

On Windows, save it to `%USERPROFILE%\.config\garmin\connect-personal-api-key`
instead. Alternatively, set the `GARMIN_PERSONAL_API_KEY` environment variable.

## Try it from the command line

The package includes a CLI, so you can check that everything works before
writing code:

```shell
npx -p garmin-connect-personal-api-js gc-personal sleep-summaries --start-date 2026-10-16 --end-date 2026-10-22
```

It prints JSON, so you can pipe it to `jq`. Run `gc-personal` without a command
for an interactive menu.

## A weekly sleep report

Create a project and install the client (Node.js 20.4 or newer):

```shell
mkdir garmin-report && cd garmin-report
npm init -y && npm pkg set type=module
npm install garmin-connect-personal-api-js
```

The key goes to a `PersonalApiAuthenticator`, which exchanges it for a bearer
token and caches the token for about a day. The token goes to
`GarminPersonalApiClient`, which has one method per endpoint:

```js
// sleep.js
import {
  GarminPersonalApiClient,
  PersonalApiAuthenticator,
  resolveApiKey,
} from 'garmin-connect-personal-api-js';

const token = await new PersonalApiAuthenticator().obtainToken(resolveApiKey());
const client = new GarminPersonalApiClient(token.accessToken);

const end = new Date();
const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);

const [nights, hrv] = await Promise.all([
  client.getDailySleepSummaries(start, end),
  client.getDailyHrvSummaries(start, end),
]);
const hrvByDate = new Map(hrv.hrvSummaries.map((day) => [day.calendarDate, day]));

const hours = (seconds) => (seconds / 3600).toFixed(1);
console.table(
  nights.map((night) => ({
    date: night.calendarDate,
    hours: hours(night.sleepTimeSeconds),
    deep: hours(night.deepSleepSeconds),
    rem: hours(night.remSleepSeconds),
    score: night.sleepScores?.overall?.value,
    hrv: hrvByDate.get(night.calendarDate)?.lastNightAvg,
  })),
);
```

```shell
node sleep.js
```

A few things to know about the data:

- Dates are `YYYY-MM-DD` strings or `Date` objects, and ranges are inclusive.
- Durations are in seconds.
- Summary endpoints such as `getDailySleepSummaries` return one entry per day,
  which is much smaller than the detailed per-day endpoints. Use them for
  trends.

## A year of daily stats in a spreadsheet

`getDailySummaries` returns one record per day with steps, calories, resting
heart rate, stress, Body Battery, and intensity minutes. The repository has a
complete script that combines it with sleep data and writes CSV:

```shell
git clone https://github.com/DynamicsNinja/connect-personal-api-js
cd connect-personal-api-js
node examples/export-daily-csv.js --start-date 2026-01-01 -o daily.csv
```

It requests long ranges in 28-day chunks. Open `daily.csv` in Excel or Google
Sheets and chart resting heart rate against sleep score.

There's also `examples/backup-activities.js`, which downloads the original FIT
file of every activity and skips files it already has, so you can schedule it
as a nightly backup.

## Ask Claude about your data

The most fun part: the same client powers an
[MCP server](https://www.npmjs.com/package/garmin-connect-personal-api-mcp),
which lets AI assistants call the API as tools. In Claude Code:

```shell
claude mcp add garmin --env GARMIN_PERSONAL_API_KEY=your-key -- npx -y garmin-connect-personal-api-mcp
```

For Claude Desktop, add this to its config (**Settings → Developer → Edit
Config**):

```json
{
  "mcpServers": {
    "garmin": {
      "command": "npx",
      "args": ["-y", "garmin-connect-personal-api-mcp"],
      "env": { "GARMIN_PERSONAL_API_KEY": "your-key" }
    }
  }
}
```

Then ask things like:

> Compare my sleep this week with last week. Did my HRV follow the same pattern?

> Summarize my last five runs and tell me whether my average heart rate at the same pace is improving.

Claude picks the right tools (sleep summaries, HRV summaries, activity search)
and works with the actual numbers. The server is read-only, so it can't change
anything in your account. Keep in mind that the data you ask about is sent to
the AI provider you use.

## Wrapping up

The Personal API makes your own Garmin data easy to reach. The client,
CLI, examples, and MCP server are on GitHub:
[DynamicsNinja/connect-personal-api-js](https://github.com/DynamicsNinja/connect-personal-api-js).
Issues and pull requests are welcome, and I'd love to hear what you build.

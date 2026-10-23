# Garmin Connect Personal API MCP Server

[![npm](https://img.shields.io/npm/v/garmin-connect-personal-api-mcp)](https://www.npmjs.com/package/garmin-connect-personal-api-mcp)
[![License](https://img.shields.io/npm/l/garmin-connect-personal-api-mcp)](https://github.com/DynamicsNinja/connect-personal-api-js/blob/main/LICENSE)

> **Unofficial.** This is a community project. It isn't affiliated with or endorsed by Garmin.

An [MCP](https://modelcontextprotocol.io) server that lets Claude and other AI assistants read your Garmin Connect data through Garmin's official
[Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api). Ask questions such as:

- "How has my sleep been this week compared with last week?"
- "Is my HRV trending up or down this month?"
- "Summarize my last five runs."
- "On days I slept less than 6 hours, what was my stress like?"

It's built on [garmin-connect-personal-api-js](https://www.npmjs.com/package/garmin-connect-personal-api-js) and is read-only: it can't change anything in your account.

## Setup

1. Create a Personal API key on
   [Garmin Connect](https://connect.garmin.com/app/settings/personalApiToken).
2. Add the server to your AI client, as shown below, with the key in
   `GARMIN_PERSONAL_API_KEY`. You need Node.js 20.4 or newer.

### Claude Desktop

Open **Settings → Developer → Edit Config** and add:

```json
{
  "mcpServers": {
    "garmin": {
      "command": "npx",
      "args": ["-y", "garmin-connect-personal-api-mcp"],
      "env": {
        "GARMIN_PERSONAL_API_KEY": "your-personal-api-key"
      }
    }
  }
}
```

Restart Claude Desktop afterward.

### Claude Code

```shell
claude mcp add garmin --env GARMIN_PERSONAL_API_KEY=your-personal-api-key -- npx -y garmin-connect-personal-api-mcp
```

### Other MCP clients

Run `npx -y garmin-connect-personal-api-mcp` as a stdio server with
`GARMIN_PERSONAL_API_KEY` set.

### Keeping the key out of client config

Instead of the environment variable, you can save the key in
`~/.config/garmin/connect-personal-api-key` (on Windows,
`%USERPROFILE%\.config\garmin\connect-personal-api-key`) and leave `env` out of
the configuration. This is the same key file the `gc-personal` CLI uses.

## Tools

| Tool | Data |
| --- | --- |
| `get_daily_sleep_summaries` | One summary per night: duration, stages, sleep score |
| `get_daily_sleep` | Detailed sleep for one night |
| `get_daily_summaries` | Daily steps, calories, heart rate, stress, Body Battery, intensity minutes |
| `get_daily_hrv`, `get_daily_hrv_summaries` | Heart rate variability for a night, or per night over a range |
| `get_daily_heart_rate`, `get_heart_rate_zones` | Heart rate samples for a day, and heart rate zones |
| `get_daily_stress`, `get_daily_steps`, `get_daily_hydration` | Daily statistics over a date range |
| `get_daily_body_battery`, `get_daily_spo2` | Body Battery and SpO2 |
| `search_activities`, `get_activity`, `get_activity_workouts` | Activities and their details |
| `get_weight_measurements`, `get_effective_weight_goals`, `get_daily_food_logs` | Weight, goals, and nutrition |
| `get_fitness_age`, `get_user_profile_settings` | Fitness age and profile settings |
| `get_menstrual_cycle_summary`, `get_menstrual_cycle_day_view` | Menstrual cycle data |
| `get_wellness_activity_summaries` | Wellness activity summaries |
| `api_get` | Any other Personal API GET endpoint |

Dates use `YYYY-MM-DD` and default to today. Date ranges are inclusive.

## How it works

The server exchanges your API key for a bearer token and caches it in
`~/.config/garmin/connect-personal-api-bearer-token.json`, shared with the
`gc-personal` CLI. Tokens are renewed before they expire, and a rejected token
is replaced automatically.

Your data goes from Garmin to the AI client you connect, so it's subject to
that client's privacy terms.

## License

Apache 2.0. See [LICENSE](https://github.com/DynamicsNinja/connect-personal-api-js/blob/main/LICENSE).

// Command-line reference application for Garmin Personal API reads.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { resolveApiKey } from './apiKeys.js';
import { PersonalApiAuthenticator } from './auth.js';
import { GarminPersonalApiClient } from './client.js';
import { COMMANDS, COMMANDS_BY_NAME, TOKEN_REFRESH_COMMAND } from './commands.js';
import {
  DEFAULT_API_KEY_ENV_VAR,
  DEFAULT_API_KEY_FILE,
  DEFAULT_BEARER_TOKEN_CACHE_FILE,
  DEFAULT_TIMEOUT_SECONDS,
} from './constants.js';
import { saveDownload } from './downloads.js';
import { GarminPersonalApiError } from './errors.js';
import { describeError, printHeading, printRequestStatus, runInteractive, statusLogger } from './interactive.js';
import { formatJson, todayIso } from './terminal.js';
import { VERSION } from './version.js';

const PROG = 'gc-personal';

/**
 * Ends argument parsing: `code` 0 for `--help` and `--version`, 2 for usage errors.
 */
export class CliExit extends Error {
  /**
   * @param {number} code
   * @param {string} text
   */
  constructor(code, text) {
    super(text);
    this.name = 'CliExit';
    this.code = code;
    this.text = text;
  }
}

/**
 * @typedef {object} OptionDef
 * @property {string[]} flags
 * @property {string} key
 * @property {'flag' | 'string' | 'int' | 'float'} type
 * @property {string} [metavar]
 * @property {string} help
 * @property {unknown} [defaultValue]
 */

/**
 * @typedef {object} ParserDef
 * @property {string} prog
 * @property {string} description
 * @property {OptionDef[]} options
 * @property {{key: string, metavar: string, help: string}[]} positionals
 */

/** @returns {OptionDef[]} */
function globalOptions() {
  return [
    { flags: ['-h', '--help'], key: 'help', type: 'flag', help: 'Show this help message and exit.' },
    { flags: ['--version'], key: 'version', type: 'flag', help: "Show the program's version and exit." },
    {
      flags: ['--api-key'],
      key: 'apiKey',
      type: 'string',
      metavar: 'API_KEY',
      help:
        'Personal API key. Prefer the environment variable or key file to avoid ' +
        'shell-history and process-list exposure.',
    },
    {
      flags: ['--api-key-file'],
      key: 'apiKeyFile',
      type: 'string',
      metavar: 'API_KEY_FILE',
      help:
        `Plain-text API key file; overrides ${DEFAULT_API_KEY_ENV_VAR} unless --api-key ` +
        `is given. Without either option, use the environment variable, then ` +
        `${DEFAULT_API_KEY_FILE}.`,
    },
    {
      flags: ['--bearer-token-cache-file'],
      key: 'bearerTokenCacheFile',
      type: 'string',
      metavar: 'BEARER_TOKEN_CACHE_FILE',
      defaultValue: DEFAULT_BEARER_TOKEN_CACHE_FILE,
      help: `Bearer-token cache file (default: ${DEFAULT_BEARER_TOKEN_CACHE_FILE}).`,
    },
    {
      flags: ['--timeout'],
      key: 'timeout',
      type: 'float',
      metavar: 'TIMEOUT',
      defaultValue: DEFAULT_TIMEOUT_SECONDS,
      help: `Request timeout in seconds (default: ${DEFAULT_TIMEOUT_SECONDS}).`,
    },
    {
      flags: ['--quiet'],
      key: 'quiet',
      type: 'flag',
      help: 'Suppress request logging for non-interactive commands.',
    },
    { flags: ['--no-color'], key: 'noColor', type: 'flag', help: 'Disable interactive terminal colors.' },
  ];
}

/**
 * @param {Readonly<import('./commands.js').CommandSpec>} spec
 * @returns {string}
 */
function commandHelp(spec) {
  return (
    spec.description ??
    (spec.outputKind === 'download' ? `${spec.label}.` : `Get ${spec.label.toLowerCase()}.`)
  );
}

/**
 * Build the argument definition for one command.
 * @param {Readonly<import('./commands.js').CommandSpec>} spec
 * @returns {ParserDef}
 */
function commandParser(spec) {
  const today = todayIso();
  /** @type {OptionDef[]} */
  const options = [
    { flags: ['-h', '--help'], key: 'help', type: 'flag', help: 'Show this help message and exit.' },
  ];
  /** @type {ParserDef['positionals']} */
  const positionals = [];
  /**
   * @param {string} flag
   * @param {string} key
   * @param {string} metavar
   * @param {string} help
   * @param {unknown} [defaultValue]
   */
  const dateOption = (flag, key, metavar, help, defaultValue = today) =>
    options.push({ flags: [flag], key, type: 'string', metavar, help, defaultValue });

  if (spec.inputKind === 'date') {
    dateOption('--date', 'date', 'DATE', 'Calendar date in YYYY-MM-DD format (default: today).');
  } else if (spec.inputKind === 'date_with_today') {
    dateOption('--date', 'date', 'DATE', 'Calendar date in YYYY-MM-DD format (default: today).');
    dateOption(
      '--today-date',
      'todayDate',
      'DATE',
      'Reference today date in YYYY-MM-DD format (default: today).',
    );
  } else if (spec.inputKind === 'date_range') {
    dateOption('--start-date', 'startDate', 'START_DATE', 'Start date in YYYY-MM-DD format (default: today).');
    dateOption('--end-date', 'endDate', 'END_DATE', 'End date in YYYY-MM-DD format (default: today).');
    if (spec.command === 'body-battery') {
      options.push({
        flags: ['--chunks'],
        key: 'chunks',
        type: 'int',
        metavar: 'CHUNKS',
        defaultValue: 1,
        help: 'Number of min/max body battery pairs per day.',
      });
    }
  } else if (spec.inputKind === 'activities') {
    options.push(
      {
        flags: ['--start'],
        key: 'start',
        type: 'int',
        metavar: 'START',
        defaultValue: 0,
        help: 'Zero-based result offset (default: 0).',
      },
      {
        flags: ['--limit'],
        key: 'limit',
        type: 'int',
        metavar: 'COUNT',
        defaultValue: 20,
        help: 'Maximum number of activities to return (default: 20).',
      },
    );
    dateOption('--start-date', 'startDate', 'DATE', 'Optional start date in YYYY-MM-DD format.', null);
    dateOption('--end-date', 'endDate', 'DATE', 'Optional end date in YYYY-MM-DD format.', null);
    dateOption(
      '--activity-type',
      'activityType',
      'TYPE',
      'Optional activity type filter, such as running or hiking.',
      null,
    );
  } else if (spec.inputKind === 'activity') {
    positionals.push({
      key: 'activityId',
      metavar: 'ACTIVITY_ID',
      help: spec.outputKind === 'download' ? 'Activity ID to download.' : 'Activity ID to look up.',
    });
  }
  if (spec.outputKind === 'download') {
    options.push(
      {
        flags: ['-o', '--output'],
        key: 'output',
        type: 'string',
        metavar: 'PATH',
        defaultValue: null,
        help: "Save ZIP to PATH (default: activity-ID.zip); '-' writes binary stdout.",
      },
      { flags: ['--force'], key: 'force', type: 'flag', help: 'Replace an existing output file.' },
    );
  }
  return { prog: `${PROG} ${spec.command}`, description: commandHelp(spec), options, positionals };
}

/** @returns {ParserDef} */
function refreshParser() {
  return {
    prog: `${PROG} ${TOKEN_REFRESH_COMMAND}`,
    description: 'Obtain and cache a new bearer token, replacing any cached token.',
    options: [
      { flags: ['-h', '--help'], key: 'help', type: 'flag', help: 'Show this help message and exit.' },
    ],
    positionals: [],
  };
}

/**
 * @param {string} text
 * @param {number} indent
 * @param {number} [width]
 */
function wrap(text, indent, width = 80) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && indent + line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push(line);
  return lines.join(`\n${' '.repeat(indent)}`);
}

/**
 * @param {[string, string][]} rows
 * @returns {string}
 */
function formatRows(rows) {
  const indent = 26;
  return rows
    .map(([name, help]) => {
      const head = `  ${name}`;
      return head.length <= indent - 2
        ? `${head.padEnd(indent)}${wrap(help, indent)}`
        : `${head}\n${' '.repeat(indent)}${wrap(help, indent)}`;
    })
    .join('\n');
}

/** @param {OptionDef} option */
function optionLabel(option) {
  return option.type === 'flag'
    ? option.flags.join(', ')
    : option.flags.map((flag) => `${flag} ${option.metavar}`).join(', ');
}

/**
 * @param {ParserDef} parser
 * @param {string} [commandList]
 */
function usage(parser, commandList) {
  const parts = parser.options.map((option) =>
    option.type === 'flag' ? `[${option.flags[0]}]` : `[${option.flags[0]} ${option.metavar}]`,
  );
  parts.push(...parser.positionals.map((positional) => positional.metavar));
  if (commandList) {
    parts.push(commandList, '...');
  }
  const lines = [`usage: ${parser.prog}`];
  for (const part of parts) {
    const line = lines[lines.length - 1];
    if (line.length > 7 && line.length + 1 + part.length > 80) {
      lines.push(`       ${part}`);
    } else {
      lines[lines.length - 1] = `${line} ${part}`;
    }
  }
  return lines.join('\n');
}

/**
 * @param {ParserDef} parser
 * @param {[string, string][]} [commands]
 */
function helpText(parser, commands) {
  const commandList = commands ? `{${commands.map(([name]) => name).join(',')}}` : undefined;
  const sections = [usage(parser, commandList), wrap(parser.description, 0)];
  if (commands) {
    sections.push(`commands:\n${formatRows(commands)}`);
  }
  if (parser.positionals.length > 0) {
    sections.push(
      `positional arguments:\n${formatRows(parser.positionals.map((p) => [p.metavar, p.help]))}`,
    );
  }
  sections.push(
    `options:\n${formatRows(parser.options.map((option) => [optionLabel(option), option.help]))}`,
  );
  return `${sections.join('\n\n')}\n`;
}

/**
 * @param {ParserDef} parser
 * @param {string} message
 * @param {string} [commandList]
 * @returns {never}
 */
function usageError(parser, message, commandList) {
  throw new CliExit(2, `${usage(parser, commandList)}\n${parser.prog}: error: ${message}\n`);
}

/**
 * Parse options and positionals for one parser.
 *
 * Without `stopAtPositional`, every token must belong to this parser. With it,
 * parsing stops at the first positional, which is returned with the remaining tokens.
 * @param {ParserDef} parser
 * @param {string[]} argv
 * @param {{stopAtPositional?: boolean, commandList?: string}} [options]
 * @returns {{values: Record<string, unknown>, rest: string[]}}
 */
function parseTokens(parser, argv, { stopAtPositional = false, commandList } = {}) {
  /** @type {Record<string, unknown>} */
  const values = {};
  for (const option of parser.options) {
    values[option.key] = option.type === 'flag' ? false : (option.defaultValue ?? null);
  }
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('-') || token === '-' || /^-\d/.test(token)) {
      if (stopAtPositional) {
        return { values, rest: argv.slice(index) };
      }
      positionals.push(token);
      continue;
    }
    const [flag, inlineValue] = token.startsWith('--') && token.includes('=')
      ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)]
      : [token, undefined];
    const option = parser.options.find((candidate) => candidate.flags.includes(flag));
    if (option === undefined) {
      usageError(parser, `unrecognized arguments: ${token}`, commandList);
    }
    if (option.type === 'flag') {
      if (inlineValue !== undefined) {
        usageError(parser, `argument ${flag}: ignored explicit argument '${inlineValue}'`, commandList);
      }
      if (option.key === 'help') {
        throw new CliExit(0, '');
      }
      values[option.key] = true;
      continue;
    }
    let raw = inlineValue;
    if (raw === undefined) {
      index += 1;
      if (index >= argv.length) {
        usageError(parser, `argument ${option.flags.join('/')}: expected one argument`, commandList);
      }
      raw = argv[index];
    }
    values[option.key] = convert(parser, option, raw, commandList);
  }
  if (stopAtPositional) {
    return { values, rest: positionals };
  }
  const missing = parser.positionals.slice(positionals.length);
  if (missing.length > 0) {
    usageError(
      parser,
      `the following arguments are required: ${missing.map((p) => p.metavar).join(', ')}`,
    );
  }
  if (positionals.length > parser.positionals.length) {
    usageError(
      parser,
      `unrecognized arguments: ${positionals.slice(parser.positionals.length).join(' ')}`,
    );
  }
  parser.positionals.forEach((positional, index) => {
    values[positional.key] = positionals[index];
  });
  return { values, rest: [] };
}

/**
 * @param {ParserDef} parser
 * @param {OptionDef} option
 * @param {string} raw
 * @param {string} [commandList]
 */
function convert(parser, option, raw, commandList) {
  if (option.type === 'int') {
    if (!/^\s*[+-]?\d+\s*$/.test(raw)) {
      usageError(parser, `argument ${option.flags.join('/')}: invalid int value: '${raw}'`, commandList);
    }
    return Number.parseInt(raw, 10);
  }
  if (option.type === 'float') {
    const value = Number(raw);
    if (!raw.trim() || Number.isNaN(value)) {
      usageError(parser, `argument ${option.flags.join('/')}: invalid float value: '${raw}'`, commandList);
    }
    return value;
  }
  return raw;
}

/**
 * @typedef {object} CliArgs
 * @property {string | null} command
 * @property {string | null} apiKey
 * @property {string | null} apiKeyFile
 * @property {string} bearerTokenCacheFile
 * @property {number} timeout
 * @property {boolean} quiet
 * @property {boolean} noColor
 * @property {Record<string, any>} commandArgs
 */

/**
 * Parse CLI arguments. Throws `CliExit` for help, version, and usage errors.
 * @param {string[]} argv
 * @returns {CliArgs}
 */
export function parseCliArgs(argv) {
  /** @type {ParserDef} */
  const mainParser = {
    prog: PROG,
    description: 'Retrieve Garmin data with a personal API key.',
    options: globalOptions(),
    positionals: [],
  };
  /** @type {[string, string][]} */
  const commands = [
    ...COMMANDS.map((spec) => /** @type {[string, string]} */ ([spec.command, commandHelp(spec)])),
    [TOKEN_REFRESH_COMMAND, refreshParser().description],
  ];
  const commandList = `{${commands.map(([name]) => name).join(',')}}`;

  let parsed;
  try {
    parsed = parseTokens(mainParser, argv, { stopAtPositional: true, commandList });
  } catch (error) {
    if (error instanceof CliExit && error.code === 0) {
      throw new CliExit(0, helpText(mainParser, commands));
    }
    throw error;
  }
  const { values, rest } = parsed;
  if (values.version) {
    throw new CliExit(0, `${PROG} ${VERSION}\n`);
  }

  /** @type {string | null} */
  let command = null;
  /** @type {Record<string, any>} */
  let commandArgs = {};
  if (rest.length > 0) {
    command = rest[0];
    const spec = COMMANDS_BY_NAME.get(command);
    if (spec === undefined && command !== TOKEN_REFRESH_COMMAND) {
      const choices = commands.map(([name]) => `'${name}'`).join(', ');
      usageError(
        mainParser,
        `argument command: invalid choice: '${command}' (choose from ${choices})`,
        commandList,
      );
    }
    const parser = spec === undefined ? refreshParser() : commandParser(spec);
    try {
      commandArgs = parseTokens(parser, rest.slice(1)).values;
    } catch (error) {
      if (error instanceof CliExit && error.code === 0) {
        throw new CliExit(0, helpText(parser));
      }
      throw error;
    }
  }

  return {
    command,
    apiKey: /** @type {string | null} */ (values.apiKey),
    apiKeyFile: /** @type {string | null} */ (values.apiKeyFile),
    bearerTokenCacheFile: /** @type {string} */ (values.bearerTokenCacheFile),
    timeout: /** @type {number} */ (values.timeout),
    quiet: /** @type {boolean} */ (values.quiet),
    noColor: /** @type {boolean} */ (values.noColor),
    commandArgs,
  };
}

/**
 * Run the parsed command against a client.
 * @param {GarminPersonalApiClient} client
 * @param {CliArgs} args
 * @returns {Promise<unknown>}
 */
export async function executeCommand(client, args) {
  const spec = /** @type {Readonly<import('./commands.js').CommandSpec>} */ (
    COMMANDS_BY_NAME.get(/** @type {string} */ (args.command))
  );
  const method = /** @type {(...params: any[]) => Promise<unknown>} */ (client[spec.method]).bind(
    client,
  );
  const options = args.commandArgs;
  switch (spec.inputKind) {
    case 'date':
      return method(options.date);
    case 'date_with_today':
      return method(options.date, options.todayDate);
    case 'date_range':
      if (spec.command === 'body-battery') {
        return method(options.startDate, options.endDate, { chunks: options.chunks });
      }
      return method(options.startDate, options.endDate);
    case 'activities':
      return method({
        start: options.start,
        limit: options.limit,
        startDate: options.startDate,
        endDate: options.endDate,
        activityType: options.activityType,
      });
    case 'activity':
      return method(options.activityId);
    default:
      return method();
  }
}

/**
 * @typedef {object} CliDependencies
 * @property {typeof PersonalApiAuthenticator} [Authenticator]
 * @property {typeof GarminPersonalApiClient} [Client]
 * @property {typeof runInteractive} [interactive]
 * @property {NodeJS.WritableStream & {isTTY?: boolean}} [stdout]
 * @property {NodeJS.WritableStream & {isTTY?: boolean}} [stderr]
 * @property {Record<string, string | undefined>} [env]
 * @property {string} [defaultKeyFile]
 */

/**
 * Authenticate once, then execute a command or open the interactive menu.
 * @param {string[]} [argv]
 * @param {CliDependencies} [dependencies]
 * @returns {Promise<number>} The process exit code.
 */
export async function main(
  argv = process.argv.slice(2),
  {
    Authenticator = PersonalApiAuthenticator,
    Client = GarminPersonalApiClient,
    interactive: runMenu = runInteractive,
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    defaultKeyFile = DEFAULT_API_KEY_FILE,
  } = {},
) {
  /** @type {CliArgs} */
  let args;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof CliExit) {
      (error.code === 0 ? stdout : stderr).write(error.text);
      return error.code;
    }
    throw error;
  }

  const interactive = args.command === null;
  const refreshOnly = args.command === TOKEN_REFRESH_COMMAND;
  const color = args.noColor ? false : null;
  const logger = interactive
    ? statusLogger(stdout, color)
    : {
        info: args.quiet ? () => {} : (/** @type {string} */ message) => stderr.write(`INFO ${message}\n`),
        warn: (/** @type {string} */ message) => stderr.write(`WARNING ${message}\n`),
      };

  /** @type {unknown} */
  let result;
  try {
    const download =
      !interactive && !refreshOnly && COMMANDS_BY_NAME.get(/** @type {string} */ (args.command))?.outputKind === 'download';
    if (download && args.commandArgs.output === '-' && stdout.isTTY) {
      throw new GarminPersonalApiError('Refusing to write ZIP bytes to a terminal; use -o PATH');
    }
    const apiKey = resolveApiKey({
      apiKey: args.apiKey,
      keyFile: args.apiKeyFile,
      env,
      defaultKeyFile,
      logger,
    });
    const authenticator = new Authenticator({
      timeoutSeconds: args.timeout,
      bearerTokenCacheFile: args.bearerTokenCacheFile,
      logger,
    });
    try {
      if (interactive) {
        printHeading('Garmin Personal API', { output: stdout, color });
        printRequestStatus('Checking bearer-token cache', { output: stdout, color });
      }
      const token = await authenticator.obtainToken(apiKey, { forceRefresh: refreshOnly });
      if (refreshOnly) {
        stderr.write(`Cached a new bearer token that expires at ${localIsoSeconds(token.expiresAt)}\n`);
        return 0;
      }
      const client = new Client(token.accessToken, { timeoutSeconds: args.timeout, logger });
      try {
        if (interactive) {
          return await runMenu(client, {
            color,
            showHeader: false,
            output: stdout,
            refreshToken: async () => {
              const refreshed = await authenticator.obtainToken(apiKey, { forceRefresh: true });
              client.updateBearerToken(refreshed.accessToken);
            },
          });
        }
        result = await executeCommand(client, args);
        if (download) {
          if (!(result instanceof Uint8Array)) {
            throw new GarminPersonalApiError('Expected binary download content');
          }
          if (args.commandArgs.output === '-') {
            await writeAll(stdout, result);
          } else {
            const destination = await saveDownload(
              result,
              args.commandArgs.output ?? `activity-${args.commandArgs.activityId}.zip`,
              { overwrite: args.commandArgs.force },
            );
            stderr.write(`Saved ${destination} (${result.length} bytes)\n`);
          }
          return 0;
        }
      } finally {
        client.close();
      }
    } finally {
      authenticator.close();
    }
  } catch (error) {
    stderr.write(`Error: ${describeError(error)}\n`);
    return 1;
  }

  await writeAll(stdout, `${formatJson(result)}\n`);
  return 0;
}

/**
 * Write to a stream and wait until it accepts the data.
 * @param {NodeJS.WritableStream} stream
 * @param {string | Uint8Array} chunk
 * @returns {Promise<void>}
 */
function writeAll(stream, chunk) {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Format epoch seconds as a local ISO 8601 timestamp with its UTC offset.
 * @param {number} epochSeconds
 * @returns {string}
 */
export function localIsoSeconds(epochSeconds) {
  const value = new Date(epochSeconds * 1000);
  const pad = (/** @type {number} */ n) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const offset = -value.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    `T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

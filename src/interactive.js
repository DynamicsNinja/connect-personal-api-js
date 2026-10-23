// Interactive menu for exploring Personal API data.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { lstat } from 'node:fs/promises';

import { COMMANDS, TOKEN_REFRESH_COMMAND } from './commands.js';
import { expandUser } from './credentials.js';
import { saveDownload } from './downloads.js';
import {
  createTerminalInput,
  highlightJson,
  InputClosedError,
  InputInterruptedError,
  styler,
  todayIso,
} from './terminal.js';

/** @typedef {import('./client.js').GarminPersonalApiClient} GarminPersonalApiClient */
/** @typedef {import('./commands.js').CommandSpec} CommandSpec */
/** @typedef {import('./terminal.js').InputFunc} InputFunc */
/** @typedef {import('./terminal.js').TextOutput} TextOutput */
/** @typedef {{output: TextOutput, errorOutput: TextOutput, color: boolean | null | undefined}} Screen */

const ACTIVITY_PAGE_SIZE = 10;
const HEADING_WIDTH = 56;
const QUIT = new Set(['q', 'quit', 'exit']);
const BACK = new Set(['b', 'back']);
// Activity commands need an activity ID, so they are reached from the activity browser.
const MENU_COMMANDS = COMMANDS.filter((spec) => spec.inputKind !== 'activity');
const MENU_COMMANDS_BY_NAME = new Map(MENU_COMMANDS.map((spec) => [spec.command, spec]));
/** @type {ReadonlyArray<readonly [number, string, string]>} */
export const INTERACTIVE_MENU_ITEMS = Object.freeze([
  ...MENU_COMMANDS.map((spec, index) => /** @type {const} */ ([index + 1, spec.label, spec.command])),
  /** @type {const} */ ([MENU_COMMANDS.length + 1, 'Reload Bearer Token', TOKEN_REFRESH_COMMAND]),
]);
const INTERACTIVE_MENU_ACTIONS = new Map(
  INTERACTIVE_MENU_ITEMS.map(([number, , command]) => [String(number), command]),
);

/** Return from the current interactive screen. */
class InteractiveBack extends Error {}

/** Leave the interactive client from any screen. */
class InteractiveExit extends Error {}

/**
 * @typedef {object} RunInteractiveOptions
 * @property {InputFunc} [inputFunc] Reads one line; defaults to a terminal reader on stdin.
 * @property {TextOutput} [output]
 * @property {TextOutput} [errorOutput]
 * @property {boolean | null} [color]
 * @property {boolean} [showHeader]
 * @property {(() => void | Promise<void>) | null} [refreshToken]
 */

/**
 * Run the reference client's interactive menu.
 * @param {GarminPersonalApiClient} client
 * @param {RunInteractiveOptions} [options]
 * @returns {Promise<number>} The process exit code.
 */
export async function runInteractive(
  client,
  {
    inputFunc,
    output = process.stdout,
    errorOutput = process.stderr,
    color = null,
    showHeader = true,
    refreshToken = null,
  } = {},
) {
  const terminalInput = inputFunc === undefined ? createTerminalInput() : null;
  const screen = { output, errorOutput, color };
  const previousLogger = client.logger;
  client.logger = statusLogger(output, color);
  try {
    return await runInteractiveSession(client, {
      inputFunc: inputFunc ?? /** @type {InputFunc} */ (terminalInput),
      screen,
      showHeader,
      refreshToken,
    });
  } finally {
    client.logger = previousLogger;
    terminalInput?.close();
  }
}

/**
 * @param {GarminPersonalApiClient} client
 * @param {{inputFunc: InputFunc, screen: Screen, showHeader: boolean, refreshToken: (() => void | Promise<void>) | null}} options
 * @returns {Promise<number>}
 */
async function runInteractiveSession(client, { inputFunc, screen, showHeader, refreshToken }) {
  const today = todayIso();
  const dateState = { lastDate: today, lastEndDate: today };
  const { output, errorOutput } = screen;

  if (showHeader) {
    printHeading('Garmin Personal API', screen);
  }

  while (true) {
    printInteractiveMenu(screen);
    let result;
    try {
      const choice = (await inputFunc('\nSelection: ')).trim().toLowerCase();
      if (QUIT.has(choice)) {
        output.write('\nGoodbye.\n');
        return 0;
      }
      if (BACK.has(choice)) {
        errorOutput.write('Already at the main menu.\n');
        continue;
      }

      const command = INTERACTIVE_MENU_ACTIONS.get(choice) ?? choice;
      if (command === TOKEN_REFRESH_COMMAND) {
        if (refreshToken === null) {
          errorOutput.write('Bearer token refresh is unavailable.\n');
          continue;
        }
        await refreshToken();
        output.write('Bearer token refreshed.\n');
        continue;
      }
      const spec = MENU_COMMANDS_BY_NAME.get(command);
      if (spec === undefined) {
        errorOutput.write(
          `Invalid selection. Choose 1 through ${INTERACTIVE_MENU_ITEMS.length} or q.\n`,
        );
        continue;
      }
      if (spec.inputKind === 'activities') {
        await browseActivities(client, { inputFunc, screen });
        continue;
      }

      result = await runInteractiveCommand(client, spec, { dateState, inputFunc, screen });
    } catch (error) {
      if (
        error instanceof InputClosedError ||
        error instanceof InputInterruptedError ||
        error instanceof InteractiveExit
      ) {
        output.write('\nGoodbye.\n');
        return 0;
      }
      if (error instanceof InteractiveBack) {
        continue;
      }
      errorOutput.write(`Error: ${describeError(error)}\n`);
      continue;
    }

    printJson(result, screen);
  }
}

/**
 * @param {GarminPersonalApiClient} client
 * @param {Readonly<CommandSpec>} spec
 * @param {{dateState: {lastDate: string, lastEndDate: string}, inputFunc: InputFunc, screen: Screen}} options
 */
async function runInteractiveCommand(client, spec, { dateState, inputFunc, screen }) {
  const method = /** @type {(...args: any[]) => Promise<unknown>} */ (client[spec.method]).bind(
    client,
  );
  if (spec.inputKind === 'date') {
    const requestedDate = await promptWithDefault(inputFunc, 'Date', dateState.lastDate);
    dateState.lastDate = requestedDate;
    printHeading(`${spec.label} | ${requestedDate}`, screen);
    return method(requestedDate);
  }

  if (spec.inputKind === 'date_with_today') {
    const requestedDate = await promptWithDefault(inputFunc, 'Date', dateState.lastDate);
    const todayDate = await promptWithDefault(inputFunc, 'Today date', dateState.lastEndDate);
    dateState.lastDate = requestedDate;
    dateState.lastEndDate = todayDate;
    printHeading(`${spec.label} | ${requestedDate} (today: ${todayDate})`, screen);
    return method(requestedDate, todayDate);
  }

  if (spec.inputKind === 'date_range') {
    const startDate = await promptWithDefault(inputFunc, 'Start date', dateState.lastDate);
    const endDate = await promptWithDefault(inputFunc, 'End date', dateState.lastEndDate);
    dateState.lastDate = startDate;
    dateState.lastEndDate = endDate;
    printHeading(`${spec.label} | ${startDate} to ${endDate}`, screen);
    return method(startDate, endDate);
  }

  printHeading(spec.label, screen);
  return method();
}

/**
 * @param {GarminPersonalApiClient} client
 * @param {{inputFunc: InputFunc, screen: Screen}} options
 */
async function browseActivities(client, { inputFunc, screen }) {
  const { output, errorOutput } = screen;
  printHeading('Activities', screen);
  const activities = activityRecords(await client.searchActivities({ limit: 30 }));
  if (activities.length === 0) {
    output.write('No activities found.\n');
    return;
  }

  let page = 0;
  while (true) {
    const pageStart = page * ACTIVITY_PAGE_SIZE;
    const pageEnd = Math.min(pageStart + ACTIVITY_PAGE_SIZE, activities.length);
    printActivityTable(activities.slice(pageStart, pageEnd), {
      pageStart,
      total: activities.length,
      screen,
    });
    const navigation = ['number  view activity', 'b  back'];
    if (page > 0) {
      navigation.push('p  previous page');
    }
    if (pageEnd < activities.length) {
      navigation.push('n  next page');
    }
    navigation.push('q  quit');
    printNavigationLine(navigation, screen);

    let choice;
    try {
      choice = (await inputFunc('\nActivity: ')).trim().toLowerCase();
    } catch (error) {
      if (error instanceof InputClosedError || error instanceof InputInterruptedError) {
        return;
      }
      throw error;
    }
    if (QUIT.has(choice)) {
      throw new InteractiveExit();
    }
    if (BACK.has(choice)) {
      return;
    }
    if (choice === 'n' || choice === 'next') {
      if (pageEnd < activities.length) {
        page += 1;
      } else {
        errorOutput.write('Already on the last page.\n');
      }
      continue;
    }
    if (choice === 'p' || choice === 'previous' || choice === 'prev') {
      if (page > 0) {
        page -= 1;
      } else {
        errorOutput.write('Already on the first page.\n');
      }
      continue;
    }
    if (!/^[+-]?\d+$/.test(choice)) {
      errorOutput.write('Invalid selection. Choose an activity number, n, p, b, or q.\n');
      continue;
    }
    const activityIndex = pageStart + Number.parseInt(choice, 10) - 1;
    if (!(pageStart <= activityIndex && activityIndex < pageEnd)) {
      errorOutput.write('Invalid selection. Choose an activity number from this page.\n');
      continue;
    }
    await showActivity(client, activities[activityIndex], { inputFunc, screen });
  }
}

/**
 * Show one activity and its follow-up actions.
 * @param {GarminPersonalApiClient} client
 * @param {Record<string, any>} activity
 * @param {{inputFunc: InputFunc, screen: Screen}} options
 */
export async function showActivity(client, activity, { inputFunc, screen }) {
  const { output, errorOutput } = screen;
  const activityId = activity.activityId;
  if (activityId == null) {
    errorOutput.write('Selected activity does not contain an activityId.\n');
    return;
  }

  printHeading(`Activity | ${activityDate(activity)} | ${activityTitle(activity)}`, screen);
  printJson(activity, screen);
  /** @type {Record<string, [string, 'getActivity' | 'getActivityWorkouts']>} */
  const actions = {
    1: ['Activity Details', 'getActivity'],
    2: ['Activity Workouts', 'getActivityWorkouts'],
  };

  while (true) {
    printNavigationLine(
      [
        '1  activity details',
        '2  activity workouts',
        '3  download activity file',
        'b  back to activities',
        'q  quit',
      ],
      screen,
    );
    let choice;
    try {
      choice = (await inputFunc('\nActivity option: ')).trim().toLowerCase();
    } catch (error) {
      if (error instanceof InputClosedError || error instanceof InputInterruptedError) {
        return;
      }
      throw error;
    }
    if (QUIT.has(choice)) {
      throw new InteractiveExit();
    }
    if (BACK.has(choice)) {
      return;
    }
    if (choice === '3') {
      try {
        await downloadActivityInteractively(client, activityId, { inputFunc, screen });
      } catch (error) {
        if (error instanceof InteractiveExit) {
          throw error;
        }
        if (error instanceof InputClosedError || error instanceof InputInterruptedError) {
          return;
        }
        errorOutput.write(`Error: ${describeError(error)}\n`);
      }
      continue;
    }
    if (!Object.hasOwn(actions, choice)) {
      errorOutput.write('Invalid selection. Choose 1, 2, 3, b, or q.\n');
      continue;
    }

    const [title, method] = actions[choice];
    printHeading(title, screen);
    let result;
    try {
      result = await client[method](activityId);
    } catch (error) {
      errorOutput.write(`Error: ${describeError(error)}\n`);
      continue;
    }
    printJson(result, screen);
  }
}

/**
 * @param {GarminPersonalApiClient} client
 * @param {string | number} activityId
 * @param {{inputFunc: InputFunc, screen: Screen}} options
 */
async function downloadActivityInteractively(client, activityId, { inputFunc, screen }) {
  const entered = (
    await inputFunc(`Save as [default: activity-${activityId}.zip] (b to cancel): `)
  ).trim();
  if (QUIT.has(entered.toLowerCase())) {
    throw new InteractiveExit();
  }
  if (BACK.has(entered.toLowerCase())) {
    return;
  }
  const destination = expandUser(entered || `activity-${activityId}.zip`);
  let overwrite = false;
  if (await pathExists(destination)) {
    const answer = (await inputFunc(`Replace ${destination}? [y/N]: `)).trim().toLowerCase();
    if (QUIT.has(answer)) {
      throw new InteractiveExit();
    }
    if (answer !== 'y' && answer !== 'yes') {
      screen.output.write('Download cancelled.\n');
      return;
    }
    overwrite = true;
  }
  const content = await client.downloadActivity(activityId);
  const saved = await saveDownload(content, destination, { overwrite });
  screen.output.write(`Saved ${saved} (${content.length} bytes)\n`);
}

/**
 * True for an existing path, including a dangling symlink.
 * @param {string} filePath
 */
async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * @param {string} title
 * @param {{output: TextOutput, color?: boolean | null}} screen
 * @param {number} [width]
 */
export function printHeading(title, { output, color }, width = HEADING_WIDTH) {
  const style = styler(output, color);
  const separator = '='.repeat(Math.max(width, title.length));
  output.write(
    `\n${style(separator, 'dim')}\n${style(title, 'boldCyan')}\n${style(separator, 'dim')}\n`,
  );
}

/** @param {Screen} screen */
function printInteractiveMenu(screen) {
  printHeading('Available data sets', screen);
  const style = styler(screen.output, screen.color);
  const rows = INTERACTIVE_MENU_ITEMS.map(([number, label]) => `${String(number).padEnd(2)} ${label}`);
  rows.push(style('q   Quit', 'dim'));
  screen.output.write(`${rows.join('\n')}\n`);
}

/**
 * @param {string} message
 * @param {{output: TextOutput, color?: boolean | null}} screen
 */
export function printRequestStatus(message, { output, color }) {
  output.write(`${styler(output, color)(`> ${message}`, 'dim')}\n`);
}

/**
 * A logger that renders request activity as interactive status lines.
 * @param {TextOutput} output
 * @param {boolean | null | undefined} color
 * @returns {import('./logging.js').Logger}
 */
export function statusLogger(output, color) {
  const log = (/** @type {string} */ message) => printRequestStatus(message, { output, color });
  return { info: log, warn: log };
}

/**
 * @param {InputFunc} inputFunc
 * @param {string} label
 * @param {string} defaultValue
 * @returns {Promise<string>}
 */
async function promptWithDefault(inputFunc, label, defaultValue) {
  const entered = (
    await inputFunc(`${label} [default: ${defaultValue}]: `, { date: defaultValue })
  ).trim();
  if (QUIT.has(entered.toLowerCase())) {
    throw new InteractiveExit();
  }
  if (BACK.has(entered.toLowerCase())) {
    throw new InteractiveBack();
  }
  return entered || defaultValue;
}

/**
 * @param {Record<string, any>[]} activities
 * @param {{pageStart: number, total: number, screen: Screen}} options
 */
function printActivityTable(activities, { pageStart, total, screen }) {
  const pageEnd = pageStart + activities.length;
  printHeading(`Activities ${pageStart + 1}-${pageEnd} of ${total}`, screen);
  const style = styler(screen.output, screen.color);
  const width = Math.max(1, String(activities.length).length);
  const rows = [`${style('#'.padStart(width), 'bold')} Activity`];
  activities.forEach((activity, index) => {
    const number = style(String(index + 1).padStart(width), 'bold');
    rows.push(`${number} ${activityDate(activity)} | ${activityTitle(activity)}`);
  });
  screen.output.write(`${rows.join('\n')}\n`);
}

/**
 * @param {string[]} actions
 * @param {Screen} screen
 */
function printNavigationLine(actions, screen) {
  const style = styler(screen.output, screen.color);
  screen.output.write(`${style(`  ${actions.join('   ')}`, 'dim')}\n`);
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>[]}
 */
function activityRecords(value) {
  const isRecord = (/** @type {unknown} */ record) =>
    record !== null && typeof record === 'object' && !Array.isArray(record);
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (isRecord(value)) {
    for (const key of ['activities', 'activityList']) {
      const nested = /** @type {Record<string, unknown>} */ (value)[key];
      if (Array.isArray(nested)) {
        return nested.filter(isRecord);
      }
    }
  }
  return [];
}

/**
 * @param {Record<string, any>} activity
 * @param {string[]} keys
 * @param {string} fallback
 */
function firstPresent(activity, keys, fallback) {
  for (const key of keys) {
    const value = activity[key];
    if (value != null && String(value).trim()) {
      return String(value);
    }
  }
  return fallback;
}

/** @param {Record<string, any>} activity */
function activityDate(activity) {
  return firstPresent(
    activity,
    ['startTimeLocal', 'startTimeGMT', 'activityDate', 'date'],
    'Unknown date',
  );
}

/** @param {Record<string, any>} activity */
function activityTitle(activity) {
  return firstPresent(activity, ['activityName', 'title', 'name'], 'Untitled activity');
}

/**
 * @param {unknown} value
 * @param {{output: TextOutput, color?: boolean | null}} screen
 */
function printJson(value, { output, color }) {
  output.write(`${highlightJson(value, output, color)}\n`);
}

/**
 * Describe an error for display, including the network cause behind `fetch failed`.
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = /** @type {{cause?: unknown}} */ (error).cause;
  if (error instanceof TypeError && cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`;
  }
  return error.message;
}

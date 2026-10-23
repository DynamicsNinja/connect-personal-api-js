// Terminal styling, JSON rendering, and line input for the CLI.
//
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';

import { iso } from './client.js';

/** @typedef {{write(chunk: string): unknown, isTTY?: boolean}} TextOutput */

/** Raised when the input stream ends, like Python's `EOFError`. */
export class InputClosedError extends Error {
  constructor() {
    super('Input closed');
    this.name = 'InputClosedError';
  }
}

/** Raised when the user presses Ctrl+C at a prompt, like Python's `KeyboardInterrupt`. */
export class InputInterruptedError extends Error {
  constructor() {
    super('Input interrupted');
    this.name = 'InputInterruptedError';
  }
}

const ANSI = {
  bold: ['\x1b[1m', '\x1b[22m'],
  dim: ['\x1b[2m', '\x1b[22m'],
  cyan: ['\x1b[36m', '\x1b[39m'],
  boldCyan: ['\x1b[1;36m', '\x1b[22;39m'],
  blue: ['\x1b[1;34m', '\x1b[22;39m'],
  green: ['\x1b[32m', '\x1b[39m'],
  magenta: ['\x1b[35m', '\x1b[39m'],
};

/** @typedef {keyof typeof ANSI} StyleName */

/**
 * Return a function that applies a style when color is enabled for `output`.
 *
 * `color` is `true` to force color, `false` to disable it, or `null` to detect
 * a terminal that doesn't set `NO_COLOR`.
 * @param {TextOutput} output
 * @param {boolean | null | undefined} color
 * @returns {(text: string, style: StyleName) => string}
 */
export function styler(output, color) {
  const enabled = color ?? Boolean(output.isTTY && !process.env.NO_COLOR);
  return (text, style) => {
    if (!enabled) {
      return text;
    }
    const [open, close] = ANSI[style];
    return `${open}${text}${close}`;
  };
}

/**
 * Recursively sort object keys, matching Python's `json.dumps(sort_keys=True)`.
 * @param {unknown} value
 * @returns {unknown}
 */
function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(/** @type {Record<string, unknown>} */ (value)[key])]),
    );
  }
  return value;
}

/**
 * Serialize a value as indented JSON with sorted keys.
 * @param {unknown} value
 * @returns {string}
 */
export function formatJson(value) {
  return JSON.stringify(sortKeys(value === undefined ? null : value), null, 2);
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/**
 * Serialize a value as JSON and highlight it when color is enabled.
 * @param {unknown} value
 * @param {TextOutput} output
 * @param {boolean | null | undefined} color
 * @returns {string}
 */
export function highlightJson(value, output, color) {
  const style = styler(output, color);
  return formatJson(value).replace(JSON_TOKEN, (match, string, colon, literal) => {
    if (string !== undefined) {
      return colon !== undefined ? style(string, 'blue') + colon : style(string, 'green');
    }
    return style(match, literal !== undefined ? 'magenta' : 'cyan');
  });
}

/**
 * @typedef {(prompt: string, options?: {date?: string}) => string | Promise<string>} InputFunc
 * Reads one line. When `options.date` is set, terminals let up/down change the date.
 */

/**
 * Create a line reader for the interactive menu.
 *
 * On a terminal, date prompts accept the up and down arrows to move the entered
 * date, or the default date, by one day.
 * @param {{input?: NodeJS.ReadStream, output?: NodeJS.WriteStream}} [streams]
 * @returns {InputFunc & {close(): void}}
 */
export function createTerminalInput({ input = process.stdin, output = process.stdout } = {}) {
  const terminal = Boolean(input.isTTY && output.isTTY);
  const rl = createInterface({ input, output, terminal, historySize: 0 });
  if (terminal) {
    emitKeypressEvents(input, rl);
  }
  // Queue lines ourselves: piped input can deliver several lines before the next prompt.
  /** @type {string[]} */
  const lines = [];
  let closed = false;
  /** @type {{resolve(line: string): void, reject(error: Error): void} | null} */
  let pending = null;
  // Readline can emit several lines synchronously, so a waiter is detached as soon as it settles.
  const settle = () => {
    const waiter = pending;
    pending = null;
    return waiter;
  };
  rl.on('line', (line) => {
    const waiter = settle();
    if (waiter === null) {
      lines.push(line);
    } else {
      waiter.resolve(line);
    }
  });
  rl.on('close', () => {
    closed = true;
    settle()?.reject(new InputClosedError());
  });
  rl.on('SIGINT', () => {
    rl.write(null, { ctrl: true, name: 'e' });
    rl.write(null, { ctrl: true, name: 'u' });
    settle()?.reject(new InputInterruptedError());
  });

  /** @type {(prompt: string, options?: {date?: string}) => Promise<string>} */
  const ask = async (prompt, { date } = {}) => {
    rl.setPrompt(prompt);
    rl.prompt();
    if (lines.length > 0) {
      if (!terminal) {
        output.write('\n');
      }
      return /** @type {string} */ (lines.shift());
    }
    if (closed) {
      throw new InputClosedError();
    }
    /** @type {((text: string, key: {name?: string}) => void) | null} */
    let onKeypress = null;
    if (terminal && date !== undefined) {
      onKeypress = (_text, key) => {
        if (key?.name !== 'up' && key?.name !== 'down') {
          return;
        }
        const next = shiftIsoDate(rl.line || date, key.name === 'up' ? 1 : -1);
        if (next !== null) {
          rl.write(null, { ctrl: true, name: 'e' });
          rl.write(null, { ctrl: true, name: 'u' });
          rl.write(next);
        }
      };
      input.on('keypress', onKeypress);
    }
    try {
      return await new Promise((resolve, reject) => {
        pending = { resolve, reject };
      });
    } finally {
      if (onKeypress !== null) {
        input.off('keypress', onKeypress);
      }
    }
  };
  return Object.assign(ask, { close: () => rl.close() });
}

/**
 * Move a `YYYY-MM-DD` date by whole days, or return `null` for an invalid date.
 * @param {string} value
 * @param {number} days
 * @returns {string | null}
 */
export function shiftIsoDate(value, days) {
  const parsed = parseIsoDate(value);
  if (parsed === null) {
    return null;
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * @param {string} value
 * @returns {Date | null}
 */
function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
}

/** Return today's local date as `YYYY-MM-DD`. */
export function todayIso() {
  return iso(new Date());
}

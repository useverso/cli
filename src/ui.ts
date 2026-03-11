import chalk from 'chalk';
import type { State } from './core/types.js';

export function heading(text: string): string {
  return chalk.bold(text);
}

export function success(text: string): string {
  return chalk.green.bold(text);
}

export function error(text: string): string {
  return chalk.red.bold(text);
}

export function warn(text: string): string {
  return chalk.yellow.bold(text);
}

export function dim(text: string): string {
  return chalk.dim(text);
}

export function stateColor(state: State): string {
  switch (state) {
    case 'captured':
      return chalk.cyan(state);
    case 'refined':
      return chalk.blue(state);
    case 'queued':
      return chalk.white(state);
    case 'building':
      return chalk.yellow(state);
    case 'verifying':
      return chalk.magenta(state);
    case 'pr_ready':
      return chalk.green(state);
    case 'done':
      return chalk.greenBright(state);
    case 'blocked':
      return chalk.red(state);
    case 'cancelled':
      return chalk.gray(state);
    default:
      return state;
  }
}

export function workTypeColor(wt: string): string {
  switch (wt) {
    case 'feature':
      return chalk.cyanBright(wt);
    case 'bug':
      return chalk.red(wt);
    case 'hotfix':
      return chalk.redBright(wt);
    case 'refactor':
      return chalk.blue(wt);
    case 'chore':
      return chalk.gray(wt);
    default:
      return wt;
  }
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Format an ISO date string to just the date part (YYYY-MM-DD). */
export function shortDate(iso: string): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

/** Draw a unicode box around lines of text. Width is the inner content width. */
export function box(lines: string[], plainLines: string[], minWidth = 50): void {
  const innerWidth = Math.max(minWidth, ...plainLines.map(l => l.length + 4));
  console.log(dim('┌' + '─'.repeat(innerWidth) + '┐'));
  for (let i = 0; i < lines.length; i++) {
    const pad = innerWidth - plainLines[i].length - 4;
    console.log(dim('│') + '  ' + lines[i] + ' '.repeat(Math.max(0, pad)) + '  ' + dim('│'));
  }
  console.log(dim('└' + '─'.repeat(innerWidth) + '┘'));
}

import chalk from 'chalk';
import ora, { type Ora } from 'ora';

// Custom error class for expected user-facing errors
export class VersoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VersoError';
  }
}

// Top-level error handler — call in catch blocks
export function handleError(error: unknown): never {
  if (error instanceof VersoError) {
    console.error(chalk.red(`\n  Error: ${error.message}\n`));
    process.exit(1);
  }
  // Unexpected errors — show stack trace
  console.error(chalk.red('\n  Unexpected error:'));
  console.error(error);
  process.exit(1);
}

// Styled console output helpers
export const ui = {
  heading(text: string): void {
    console.log(chalk.bold(`\n  ${text}\n`));
  },
  success(text: string): void {
    console.log(chalk.green(`  \u2714 ${text}`));
  },
  warn(text: string): void {
    console.log(chalk.yellow(`  \u26A0 ${text}`));
  },
  error(text: string): void {
    console.log(chalk.red(`  \u2718 ${text}`));
  },
  info(text: string): void {
    console.log(chalk.dim(`  ${text}`));
  },
  blank(): void {
    console.log();
  },
  // Creates and returns a spinner
  spinner(text: string): Ora {
    return ora({ text: `  ${text}`, indent: 0 }).start();
  },
};

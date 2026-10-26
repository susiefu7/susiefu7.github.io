// Shared helpers for the command-line scripts.

import path from 'node:path';
import { defaultProjectPath } from '../server/paths.ts';

export function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

/** Positional arguments, skipping "--flag value" pairs. */
export function positionals(): string[] {
  const out: string[] = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) i++;
    else out.push(args[i]);
  }
  return out;
}

export function projectPath(): string {
  return path.resolve(option('project') ?? defaultProjectPath());
}

export async function main(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`\n${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  }
}

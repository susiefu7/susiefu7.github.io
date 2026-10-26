// A thin wrapper around the system `git` binary. The project folder is an ordinary
// Git repository, so its whole history stays readable without this application.

import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { HttpError } from './fsutil.ts';

const COMMIT_RE = /^[0-9a-f]{7,40}$/;

export interface LogEntry {
  commit: string;
  date: string;
  subject: string;
}

export class Git {
  constructor(private cwd: string) {}

  run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        // Commits are made by the app on the author's behalf; never block on a signing prompt.
        ['-c', 'commit.gpgsign=false', '-c', 'core.quotepath=false', ...args],
        { cwd: this.cwd, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
        (error, stdout, stderr) => {
          if (error) reject(new Error(`git ${args[0]} failed: ${stderr || error.message}`));
          else resolve(stdout);
        },
      );
    });
  }

  /**
   * True only if this folder is itself the root of a repository. A project folder
   * that happens to sit inside another repository (e.g. the application's own)
   * must get its own repository, never commit into the enclosing one.
   */
  async isRepo(): Promise<boolean> {
    try {
      const top = (await this.run(['rev-parse', '--show-toplevel'])).trim();
      return realpathSync(top) === realpathSync(this.cwd);
    } catch {
      return false;
    }
  }

  async init(): Promise<void> {
    await this.run(['init', '--quiet']);
    await this.ensureIdentity();
  }

  /** Commits need an identity; fall back to a repo-local one if the user has none configured. */
  async ensureIdentity(): Promise<void> {
    const name = await this.run(['config', 'user.name']).catch(() => '');
    if (!name.trim()) await this.run(['config', 'user.name', 'The Long Picture Workspace']);
    const email = await this.run(['config', 'user.email']).catch(() => '');
    if (!email.trim()) await this.run(['config', 'user.email', 'workspace@localhost']);
  }

  /** Stage exactly these paths and commit them. Returns null when nothing changed. */
  async commit(paths: string[], message: string): Promise<string | null> {
    // Optional files (e.g. a chapter with no comments yet) may not exist; skip them —
    // unless Git tracks them, in which case their removal (e.g. a move) must be recorded.
    const tracked = (await this.run(['ls-files', '-z', '--', ...paths])).split('\0').filter(Boolean);
    paths = paths.filter((p) => existsSync(path.join(this.cwd, p)) || tracked.some((t) => t === p || t.startsWith(`${p}/`)));
    if (paths.length === 0) return null;
    await this.run(['add', '--all', '--', ...paths]);
    try {
      await this.run(['diff', '--cached', '--quiet', '--', ...paths]);
      return null; // nothing staged
    } catch {
      // `diff --quiet` exits 1 when there are staged changes
    }
    await this.run(['commit', '--quiet', '--no-verify', '-m', message, '--', ...paths]);
    return this.head();
  }

  async head(): Promise<string | null> {
    try {
      return (await this.run(['rev-parse', 'HEAD'])).trim();
    } catch {
      return null;
    }
  }

  async log(path: string, limit = 500): Promise<LogEntry[]> {
    let out: string;
    try {
      out = await this.run(['log', `-n${limit}`, '--format=%H%x1f%aI%x1f%s', '--', path]);
    } catch {
      return []; // no commits yet
    }
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [commit, date, subject] = line.split('\x1f');
        return { commit, date, subject };
      });
  }

  async lastCommitFor(path: string): Promise<string | null> {
    return (await this.log(path, 1))[0]?.commit ?? null;
  }

  async show(commit: string, path: string): Promise<string> {
    if (!COMMIT_RE.test(commit)) throw new HttpError(400, 'Invalid version reference');
    try {
      return await this.run(['show', `${commit}:${path}`]);
    } catch {
      throw new HttpError(404, 'That version of the file does not exist');
    }
  }

  /** Paths (relative to the repo) with uncommitted changes, including untracked files. */
  async dirtyPaths(paths: string[]): Promise<string[]> {
    const out = await this.run(['status', '--porcelain', '-z', '--untracked-files=all', '--', ...paths]);
    return out
      .split('\0')
      .filter((entry) => entry.length > 3)
      .map((entry) => entry.slice(3));
  }

  async bundle(target: string): Promise<void> {
    await this.run(['bundle', 'create', target, '--all']);
    await this.run(['bundle', 'verify', target]);
  }
}

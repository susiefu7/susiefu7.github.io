// File-system primitives. Every write in the application goes through here.

import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Resolve a project-relative path, refusing anything that escapes the root. */
export function resolveInside(root: string, rel: string): string {
  if (typeof rel !== 'string' || rel.includes('\0')) throw new HttpError(400, 'Invalid path');
  const abs = path.resolve(root, rel);
  const relative = path.relative(root, abs);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new HttpError(400, `Path is outside the project: ${rel}`);
  }
  return abs;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string> {
  return fs.readFile(p, 'utf8');
}

export async function readTextIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export async function readJson<T>(p: string, fallback: T): Promise<T> {
  const raw = await readTextIfExists(p);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(500, `Could not parse ${path.basename(p)}. The file has not been changed; please check it by hand.`);
  }
}

/**
 * Write via a temporary file, fsync and rename, so a crash mid-write can never
 * leave a half-written chapter behind.
 */
export async function atomicWrite(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, p);
}

export async function writeJson(p: string, value: unknown): Promise<void> {
  await atomicWrite(p, `${JSON.stringify(value, null, 2)}\n`);
}

/** Create a file that must not already exist. Used for frozen copies (approved, superseded). */
export async function writeNewFile(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const handle = await fs.open(p, 'wx');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Return a path that does not exist yet by appending -2, -3, … before the extension. */
export async function uniquePath(p: string): Promise<string> {
  if (!(await exists(p))) return p;
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
}

export async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

/** Serialises all mutations so Git's index and our JSON files never see interleaved writes. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

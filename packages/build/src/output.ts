/**
 * @getforma/build — writing the output so a reader never sees half of it
 *
 * The application embeds `outputDir` in its binary, and in development its
 * server reads `manifest.json` while watch mode rewrites it. Both readers must
 * see either the previous output or the next one, whole (L-21):
 *
 * - A production build writes into a staging directory beside `outputDir` and
 *   swaps it in only once every step has succeeded ({@link replaceDirectory});
 *   a failure removes the staging directory and leaves `outputDir` untouched.
 * - Watch mode writes in place (esbuild owns the bundles), and replaces the
 *   files it writes itself by rename ({@link writeFileAtomic}), never by
 *   truncating them and writing again.
 *
 * Windows: `rename` cannot replace a non-empty directory on any platform, and
 * on Windows a rename also fails while another process (a virus scanner, the
 * search indexer, an editor) holds a handle on the file or on something inside
 * the directory. So the directory swap takes two renames, and each rename that
 * fails with EPERM, EACCES or EBUSY on Windows is retried for a few seconds
 * before the build gives up — with `outputDir` restored.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

/** The filesystem calls this module makes, injectable so tests can fail them. */
export interface OutputFs {
  renameSync: (from: string, to: string) => void;
  rmSync: (path: string, options: { recursive: true; force: true }) => void;
  cpSync: (from: string, to: string, options: { recursive: true }) => void;
}

/** Where the output is written from; both default to the real ones. */
export interface OutputEnv {
  fs?: OutputFs;
  platform?: NodeJS.Platform;
}

const nodeFs: OutputFs = { renameSync, rmSync, cpSync };

/** Codes Windows returns while another process holds a handle on the path. */
const TRANSIENT_ON_WINDOWS = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** How long a Windows rename is retried before the build reports it. */
const RETRY_BUDGET_MS = 5_000;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Rename, retrying the failures that are transient on Windows (a handle held
 * by another process) with a growing delay, up to {@link RETRY_BUDGET_MS}.
 * Elsewhere, and for every other error, the first failure is thrown.
 * Verified by: packages/build/tests/output.test.ts > "retries a rename Windows refuses while another process holds a handle"
 */
export function renameWithRetry(from: string, to: string, env: OutputEnv = {}): void {
  const { fs = nodeFs, platform = process.platform } = env;
  const deadline = Date.now() + RETRY_BUDGET_MS;
  for (let delay = 10; ; delay = Math.min(delay * 2, 250)) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      const transient = platform === 'win32' && TRANSIENT_ON_WINDOWS.has(errorCode(error) ?? '');
      if (!transient || Date.now() + delay > deadline) throw error;
      sleepSync(delay);
    }
  }
}

/**
 * Write `path` whole or not at all: the data goes to a temporary file in the
 * same directory, which is then renamed over `path`. A reader opening `path`
 * at any moment gets the previous content or the new content, never a
 * truncated file — the failure the watched code-splitting test hit when it
 * read `manifest.json` while a rebuild was rewriting it.
 * Verified by: packages/build/tests/code-splitting.test.ts > "replaces the watched manifest by rename, so a reader never sees half of it"
 */
export function writeFileAtomic(path: string, data: string | Uint8Array, env: OutputEnv = {}): void {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(temporary, data);
  try {
    renameWithRetry(temporary, path, env);
  } catch (error) {
    (env.fs ?? nodeFs).rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

// The siblings a build creates beside `outputDir`. The process id in the name
// tells a later build whether the one that made it is still running.
const STAGING = 'forma-staging';
const PREVIOUS = 'forma-previous';

function sibling(target: string, kind: string): string {
  return join(dirname(target), `.${basename(target)}.${kind}-${process.pid}-${randomBytes(4).toString('hex')}`);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return errorCode(error) === 'EPERM';
  }
}

/**
 * Whether a sibling may still be in use. A staging directory of this process
 * may belong to a build still running here (`build()` is asynchronous). A
 * previous output of this process cannot: the swap that sets one aside is
 * synchronous, so by the time anything else runs it has finished or failed.
 */
function inUse(kind: string, pid: number): boolean {
  if (pid === process.pid) return kind === STAGING;
  return isRunning(pid);
}

/**
 * Deal with what a build that stopped before cleaning up (Ctrl-C, a CI
 * timeout, a failed swap) left beside `target`, before anything else:
 *
 * - If `target` is absent and a previous output was set aside, the build
 *   stopped between the swap's two renames. That previous output is the last
 *   good build: it is put back (the newest, if several), not deleted.
 * - Every other abandoned staging or previous-output directory is removed.
 *
 * A directory whose build is still running is left alone.
 * Verified by: packages/build/tests/output.test.ts > "puts back the previous output a build killed between its two renames left aside, the newest if several"
 */
function recoverAbandoned(target: string): void {
  const parent = dirname(target);
  if (!existsSync(parent)) return;
  const prefix = `.${basename(target)}.`;
  const abandoned: Array<{ kind: string; path: string }> = [];
  for (const name of readdirSync(parent)) {
    if (!name.startsWith(prefix)) continue;
    const match = /^(forma-staging|forma-previous)-(\d+)-[0-9a-f]{8}$/.exec(name.slice(prefix.length));
    if (!match || inUse(match[1]!, Number(match[2]))) continue;
    abandoned.push({ kind: match[1]!, path: join(parent, name) });
  }

  if (!existsSync(target)) {
    const previous = abandoned
      .filter(entry => entry.kind === PREVIOUS)
      .map(entry => ({ ...entry, modified: statSync(entry.path).mtimeMs }))
      .sort((a, b) => b.modified - a.modified)[0];
    if (previous) {
      // If this throws, nothing has been removed yet: the build fails with the
      // previous output still where the error says.
      renameWithRetry(previous.path, target);
      console.warn(`   Warning: restored the previous build to ${target} from ${previous.path}, where a build that stopped part way through its swap left it.`);
      abandoned.splice(abandoned.findIndex(entry => entry.path === previous.path), 1);
    }
  }

  for (const entry of abandoned) rmSync(entry.path, { recursive: true, force: true });
}

/**
 * Create an empty staging directory beside `target`, on the same filesystem,
 * so the final swap is a rename rather than a copy.
 * Verified by: packages/build/tests/output.test.ts > "removes what a killed build left beside the output, and only that"
 */
export function createStagingDirectory(target: string): string {
  recoverAbandoned(target);
  const staging = sibling(target, STAGING);
  mkdirSync(staging, { recursive: true });
  return staging;
}

/**
 * Put the complete build in `staging` where `target` is, and remove the
 * previous output.
 *
 * The swap is two renames — `target` aside, then `staging` in — because no
 * platform renames a directory over a non-empty one. Between them `target` is
 * briefly absent, never partial. If the second rename fails, the first is
 * undone, so `target` holds the previous build and the error is thrown.
 *
 * When `target` cannot be renamed at all because it is a mount point (EBUSY,
 * EXDEV — a container volume), its contents are replaced in place instead:
 * not atomic, but the build being swapped in is already complete.
 *
 * Verified by: packages/build/tests/output.test.ts > "puts the previous output back when the new one cannot be moved in"
 * Verified by: packages/build/tests/output.test.ts > "replaces a mount point's contents in place"
 */
export function replaceDirectory(staging: string, target: string, env: OutputEnv = {}): void {
  const { fs = nodeFs, platform = process.platform } = env;
  if (!existsSync(target)) {
    try {
      renameWithRetry(staging, target, env);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    return;
  }

  const previous = sibling(target, PREVIOUS);
  try {
    renameWithRetry(target, previous, env);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EXDEV' || (code === 'EBUSY' && platform !== 'win32')) {
      replaceContents(staging, target, fs);
      return;
    }
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(
      `@getforma/build: could not replace ${target} (${code ?? 'error'}); the previous build is untouched. ` +
        'On Windows this usually means another process has a file in it open.',
      { cause: error },
    );
  }

  try {
    renameWithRetry(staging, target, env);
  } catch (error) {
    let restored = true;
    try {
      renameWithRetry(previous, target, env);
    } catch {
      restored = false;
    }
    fs.rmSync(staging, { recursive: true, force: true });
    // Unrestored, the previous build stays at `previous`: while `target` is
    // absent, the next build moves it back before anything else.
    throw new Error(
      restored
        ? `@getforma/build: could not move the new build into ${target}; the previous build is restored there.`
        : `@getforma/build: could not move the new build into ${target}, nor restore the previous one. ` +
          `It is at ${previous}; the next build moves it back to ${target} before it starts.`,
      { cause: error },
    );
  }

  try {
    fs.rmSync(previous, { recursive: true, force: true });
  } catch {
    // A handle still open in the old output (Windows). The new build is in
    // place; the next build removes this directory (recoverAbandoned).
    console.warn(`   Warning: could not remove the previous build at ${previous}; the next build removes it.`);
  }
}

/**
 * Verified by: packages/build/tests/output.test.ts > "says the output may be partial when a mount point's copy fails"
 */
function replaceContents(staging: string, target: string, fs: OutputFs): void {
  try {
    for (const name of readdirSync(target)) fs.rmSync(join(target, name), { recursive: true, force: true });
    for (const name of readdirSync(staging)) fs.cpSync(join(staging, name), join(target, name), { recursive: true });
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(
      `@getforma/build: copying the new build into ${target} failed (${errorCode(error) ?? 'error'}); ` +
        `${target} is a mount point, emptied first, so it may be partial: build again before embedding it.`,
      { cause: error },
    );
  }
  fs.rmSync(staging, { recursive: true, force: true });
  console.warn(`   Warning: ${target} is a mount point; its contents were replaced in place, not swapped atomically.`);
}

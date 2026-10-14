/**
 * The swap that makes a build's output appear whole or not at all (L-21).
 *
 * The end-to-end guarantee is pinned in build.test.ts ("leaves the previous
 * build byte-identical when a build fails after writing files"). These tests
 * reach the failure paths that a real build cannot be made to hit on demand:
 * a rename Windows refuses because another process holds a handle, a swap that
 * fails half way, and an output directory that is a mount point. They inject a
 * failing `renameSync` and leave every other filesystem call real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createStagingDirectory,
  renameWithRetry,
  replaceDirectory,
  writeFileAtomic,
  type OutputFs,
} from '../src/output';

function fail(code: string): never {
  throw Object.assign(new Error(`${code}: injected`), { code });
}

/** A real filesystem whose `renameSync` fails when `when` says so (and `cpSync` when `copy` does). */
function failing(
  when: (from: string, to: string, call: number) => string | undefined,
  copy: (from: string) => string | undefined = () => undefined,
): OutputFs & { calls: number } {
  const fs = {
    calls: 0,
    renameSync(from: string, to: string) {
      const code = when(from, to, ++fs.calls);
      if (code) fail(code);
      renameSync(from, to);
    },
    rmSync,
    cpSync(from: string, to: string, options: { recursive: true }) {
      const code = copy(from);
      if (code) fail(code);
      cpSync(from, to, options);
    },
  };
  return fs;
}

/** The pid of a process that has exited, so it names nothing running. */
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

let root: string;
let target: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'forma-output-'));
  target = join(root, 'dist');
  mkdirSync(target);
  writeFileSync(join(target, 'previous.js'), 'previous build');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function newBuild(): string {
  const staging = createStagingDirectory(target);
  writeFileSync(join(staging, 'next.js'), 'next build');
  return staging;
}

describe('renameWithRetry', () => {
  it('retries a rename Windows refuses while another process holds a handle', () => {
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      const from = join(root, `from-${code}`);
      writeFileSync(from, code);
      const fs = failing((_from, _to, call) => (call <= 2 ? code : undefined));
      renameWithRetry(from, join(root, `to-${code}`), { fs, platform: 'win32' });
      expect(fs.calls).toBe(3);
      expect(readFileSync(join(root, `to-${code}`), 'utf8')).toBe(code);
    }
  });

  it('does not retry elsewhere, or for an error that is not transient', () => {
    const from = join(root, 'from');
    writeFileSync(from, 'x');
    const posix = failing(() => 'EPERM');
    expect(() => renameWithRetry(from, join(root, 'to'), { fs: posix, platform: 'linux' })).toThrow('EPERM');
    expect(posix.calls).toBe(1);
    const windows = failing(() => 'ENOENT');
    expect(() => renameWithRetry(from, join(root, 'to'), { fs: windows, platform: 'win32' })).toThrow('ENOENT');
    expect(windows.calls).toBe(1);
  });
});

describe('replaceDirectory', () => {
  it('swaps the new output in and removes the previous one', () => {
    const staging = newBuild();
    replaceDirectory(staging, target);
    expect(readdirSync(target)).toEqual(['next.js']);
    expect(readdirSync(root)).toEqual(['dist']);
  });

  it('moves the new output in where there was none', () => {
    rmSync(target, { recursive: true });
    const staging = newBuild();
    replaceDirectory(staging, target);
    expect(readdirSync(target)).toEqual(['next.js']);
    expect(readdirSync(root)).toEqual(['dist']);
  });

  it('puts the previous output back when the new one cannot be moved in', () => {
    const staging = newBuild();
    const fs = failing((from, to) => (from === staging && to === target ? 'EIO' : undefined));
    expect(() => replaceDirectory(staging, target, { fs, platform: 'linux' }))
      .toThrow(/could not move the new build into .*; the previous build is restored there/);
    expect(readdirSync(target)).toEqual(['previous.js']);
    expect(readFileSync(join(target, 'previous.js'), 'utf8')).toBe('previous build');
    expect(readdirSync(root)).toEqual(['dist']);
  });

  it('leaves the previous output untouched when it cannot be moved aside', () => {
    const staging = newBuild();
    const fs = failing((from) => (from === target ? 'EACCES' : undefined));
    expect(() => replaceDirectory(staging, target, { fs, platform: 'linux' }))
      .toThrow(/could not replace .* \(EACCES\); the previous build is untouched/);
    expect(readdirSync(target)).toEqual(['previous.js']);
    expect(readdirSync(root)).toEqual(['dist']);
  });

  it('names where the previous output is when it cannot be put back either, and the next build puts it back', () => {
    const staging = newBuild();
    const fs = failing((from, to) => (to === target && from !== target ? 'EIO' : undefined));
    let message = '';
    try {
      replaceDirectory(staging, target, { fs, platform: 'linux' });
    } catch (error) {
      message = (error as Error).message;
    }
    const aside = readdirSync(root).filter(name => name.startsWith('.dist.forma-previous-'));
    expect(aside).toHaveLength(1);
    expect(existsSync(target)).toBe(false);
    expect(message).toContain(join(root, aside[0]!));
    expect(message).toContain(`the next build moves it back to ${target}`);

    // The next build (in this process too: a swap is synchronous, so no
    // previous output named with this pid can be mid-swap) keeps it.
    createStagingDirectory(target);
    expect(readFileSync(join(target, 'previous.js'), 'utf8')).toBe('previous build');
  });

  it("says the output may be partial when a mount point's copy fails", () => {
    const staging = newBuild();
    const fs = failing((from) => (from === target ? 'EXDEV' : undefined), () => 'ENOSPC');
    expect(() => replaceDirectory(staging, target, { fs, platform: 'linux' }))
      .toThrow(/copying the new build into .* failed \(ENOSPC\); .* may be partial: build again/);
    expect(readdirSync(root)).toEqual(['dist']);
  });

  it("replaces a mount point's contents in place", () => {
    // A container volume mounted at outputDir cannot be renamed (EBUSY on
    // Linux, EXDEV across filesystems); the build must still land.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const code of ['EBUSY', 'EXDEV']) {
      const staging = newBuild();
      const fs = failing((from) => (from === target ? code : undefined));
      replaceDirectory(staging, target, { fs, platform: 'linux' });
      expect(readdirSync(target)).toEqual(['next.js']);
      expect(readdirSync(root)).toEqual(['dist']);
      writeFileSync(join(target, 'previous.js'), 'previous build');
      rmSync(join(target, 'next.js'));
    }
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('is a mount point'));
  });
});

describe('createStagingDirectory', () => {
  it('puts back the previous output a build killed between its two renames left aside, the newest if several', () => {
    // The killed build moved dist aside and died before moving its staging
    // directory in: dist is absent and the last good build is beside it.
    rmSync(target, { recursive: true });
    const dead = deadPid();
    const older = join(root, `.dist.forma-previous-${dead}-0a1b2c3d`);
    const newer = join(root, `.dist.forma-previous-${dead}-4e5f6a7b`);
    mkdirSync(older); writeFileSync(join(older, 'app.js'), 'older build');
    mkdirSync(newer); writeFileSync(join(newer, 'app.js'), 'newer build');
    const past = new Date(Date.now() - 60_000);
    utimesSync(older, past, past);
    mkdirSync(join(root, `.dist.forma-staging-${dead}-0a1b2c3d`)); // its half-written staging
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const staging = createStagingDirectory(target);

    expect(readFileSync(join(target, 'app.js'), 'utf8')).toBe('newer build');
    expect(readdirSync(root).sort()).toEqual(['dist', staging.slice(root.length + 1)].sort());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`restored the previous build to ${target}`));
  });

  it('removes what a killed build left beside the output, and only that', () => {
    // A process that has exited: its pid names nothing running.
    const dead = deadPid();
    const abandoned = [`.dist.forma-staging-${dead}-0a1b2c3d`, `.dist.forma-previous-${dead}-0a1b2c3d`];
    const kept = [
      `.dist.forma-staging-${process.pid}-0a1b2c3d`, // a build still running (this one)
      `.dist.forma-staging-${dead}-not-hex`, // not a name this module makes
      '.other.forma-staging-1-0a1b2c3d', // beside another output
    ];
    for (const name of [...abandoned, ...kept]) mkdirSync(join(root, name));

    const staging = createStagingDirectory(target);

    const left = readdirSync(root);
    for (const name of abandoned) expect(left).not.toContain(name);
    for (const name of kept) expect(left).toContain(name);
    expect(existsSync(staging)).toBe(true);
    expect(readdirSync(staging)).toEqual([]);
  });
});

describe('writeFileAtomic', () => {
  it('replaces a file whole, and leaves the old one and no temporary file when the rename fails', () => {
    const path = join(target, 'manifest.json');
    writeFileAtomic(path, '{"version":1}');
    expect(readFileSync(path, 'utf8')).toBe('{"version":1}');

    const fs = failing(() => 'EIO');
    expect(() => writeFileAtomic(path, '{"version":2}', { fs, platform: 'linux' })).toThrow('EIO');
    expect(readFileSync(path, 'utf8')).toBe('{"version":1}');
    expect(readdirSync(target).sort()).toEqual(['manifest.json', 'previous.js']);
  });
});

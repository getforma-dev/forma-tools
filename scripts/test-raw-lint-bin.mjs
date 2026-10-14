#!/usr/bin/env node
// SR8 through the package as an application installs it (FORMA-126): pack
// @getforma/build, install the tarball into a scratch application, seed a
// string body_prefix, and run the `forma-raw-lint` bin the way the
// application's CI would. It must fail unlisted, pass listed, and fail once
// the entry is past its end date. Run after `npm run build -w packages/build`;
// CI runs it on every runner, Windows' .cmd shim included.
//
// Usage: node scripts/test-raw-lint-bin.mjs

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const scratch = mkdtempSync(join(tmpdir(), 'forma-raw-lint-bin-'));

function run(command, args, cwd) {
  // A .cmd shim needs a shell on Windows, which joins arguments unquoted: a
  // path with a space is quoted. Nothing here is user input.
  const quote = (s) => (windows && /\s/.test(s) ? `"${s}"` : s);
  const result = spawnSync(quote(command), args.map(quote), { cwd, encoding: 'utf8', shell: windows });
  if (result.error) throw result.error;
  return result;
}

function fail(message, result) {
  console.error(`test-raw-lint-bin: ${message}`);
  if (result) console.error(`exit ${result.status}\n--- stdout\n${result.stdout}\n--- stderr\n${result.stderr}`);
  process.exit(1);
}

try {
  const packed = run('npm', ['pack', '--pack-destination', scratch, '--ignore-scripts'], join(repo, 'packages', 'build'));
  if (packed.status !== 0) fail('npm pack failed', packed);
  const tarball = readdirSync(scratch).find((f) => f.endsWith('.tgz'));
  if (!tarball) fail('npm pack wrote no tarball', packed);

  const app = join(scratch, 'app');
  mkdirSync(join(app, 'src'), { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'raw-lint-consumer', private: true }));
  const installed = run('npm', ['install', join(scratch, tarball), '--no-audit', '--no-fund', '--ignore-scripts', '--prefer-offline'], app);
  if (installed.status !== 0) fail('installing the packed tarball failed', installed);

  writeFileSync(join(app, 'src', 'main.rs'), [
    'const SHELL: &str = "<main id=\\"app\\"></main>";',
    'pub fn page(manifest: &AssetManifest) {',
    '    let config = PageConfig { title: "Home", body_prefix: Some(SHELL), config_json: None };',
    '}',
    '',
  ].join('\n'));
  const allow = (entries) => writeFileSync(join(app, 'forma-raw-allowlist.json'), JSON.stringify({ version: 1, entries }));
  const bin = join(app, 'node_modules', '.bin', windows ? 'forma-raw-lint.cmd' : 'forma-raw-lint');
  const lint = (today) => run(bin, ['--today', today, 'src'], app);

  allow([]);
  const seeded = lint('2026-10-14');
  if (seeded.status !== 1 || !seeded.stdout.includes('BUILD-810 error body_prefix in src/main.rs:3:46 (in page)')) {
    fail('a seeded body_prefix outside the allowlist did not fail with BUILD-810', seeded);
  }

  allow([{ path: 'src/main.rs', symbol: 'page', exit: 'body_prefix', owner: 'web', until: '2026-12-31', reason: 'the shell' }]);
  const listed = lint('2026-10-14');
  if (listed.status !== 0 || !listed.stdout.includes('1 listed, 0 not on the allowlist')) fail('the listed body_prefix did not pass', listed);

  const late = lint('2027-01-01');
  if (late.status !== 1 || !late.stdout.includes('BUILD-811 error body_prefix in src/main.rs:3:46')) {
    fail('an entry past its end date did not fail with BUILD-811', late);
  }

  const usage = run(bin, ['--nope'], app);
  if (usage.status !== 2) fail('a usage error did not exit 2', usage);

  console.log('test-raw-lint-bin: the packed bin fails a seeded body_prefix (1), passes it listed (0), fails it past its end date (1), and exits 2 on a usage error');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

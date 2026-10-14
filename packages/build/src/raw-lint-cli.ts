#!/usr/bin/env node
/**
 * `forma-raw-lint`: the raw-entry allowlist lint for an application's CI
 * (FORMA-126; SR8). See `raw-lint.ts` and the package README.
 */
import { runRawLintCli } from './raw-lint.js';

process.exitCode = runRawLintCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text + '\n'),
  stderr: (text) => process.stderr.write(text + '\n'),
  cwd: process.cwd(),
});

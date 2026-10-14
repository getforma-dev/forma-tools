/**
 * Run `build(config)` once in a child process whose working directory is
 * `cwd`, and return its manifest or its error.
 *
 * esbuild resolves `formaAlias`'s target from its working directory, which it
 * takes from the process when it starts: a test cannot change it with
 * `process.chdir`, so a build run from another directory (a monorepo's root)
 * runs in a child.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AssetManifest, BuildConfig, BuildDiagnostic } from '../../src/types';
import { bundleBuildRunner } from './runner';

export interface ChildBuild {
  manifest?: AssetManifest;
  message?: string;
  diagnostics?: BuildDiagnostic[];
  /** Everything the child printed, both streams in arrival order. */
  output: string;
  /** What the child printed on stdout: the build's own lines. */
  stdout: string;
  /** What the child printed on stderr: esbuild's warnings and errors. */
  stderr: string;
}

export async function buildInChild(config: BuildConfig, cwd: string, scratch: string): Promise<ChildBuild> {
  const runner = join(scratch, `build-runner-${process.pid}.mjs`);
  const result = join(scratch, `build-result-${process.pid}.json`);
  if (!existsSync(runner)) await bundleBuildRunner(runner);
  rmSync(result, { force: true });
  const script = [
    `import { writeFileSync } from 'node:fs';`,
    `import { build } from ${JSON.stringify(pathToFileURL(runner).href)};`,
    `try {`,
    `  const { manifest } = await build(${JSON.stringify(config)});`,
    `  writeFileSync(${JSON.stringify(result)}, JSON.stringify({ manifest }));`,
    `} catch (error) {`,
    `  writeFileSync(${JSON.stringify(result)}, JSON.stringify({ message: error.message, diagnostics: error.diagnostics }));`,
    `}`,
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { output += chunk; stdout += chunk; });
  child.stderr.on('data', chunk => { output += chunk; stderr += chunk; });
  await once(child, 'exit');
  if (!existsSync(result)) throw new Error(`the child build wrote no result:\n${output}`);
  return { ...JSON.parse(readFileSync(result, 'utf8')), output, stdout, stderr };
}

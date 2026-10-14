/**
 * Run `build({ ...config, watch: true })` in a child process for the length
 * of a test body. Watch mode never returns its esbuild contexts, so an
 * in-process watcher would outlive the test; a child is killed afterwards.
 *
 * The child runs `src/build.ts` bundled together with the compiler's source,
 * so a watched SSR build emits real FMIR from this checkout. Fixtures use
 * `.ts` with `h()` calls rather than `.tsx`: the compiler resolves esbuild for
 * its JSX transform relative to its own module, which is the bundle here.
 */

import { expect } from 'vitest';
import { build as bundle } from 'esbuild';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BuildConfig } from '../../src/types';

export interface Watcher {
  /** The current `manifest.json`, parsed; fails the test if the child died. */
  manifest(): any;
  /** Everything the child has printed so far. */
  output(): string;
}

export async function watching(config: BuildConfig, body: (watcher: Watcher) => Promise<void>): Promise<void> {
  const runner = join(config.outputDir, '..', `watch-runner-${process.pid}.mjs`);
  const require = createRequire(import.meta.url);
  await bundle({
    entryPoints: [fileURLToPath(new URL('../../src/build.ts', import.meta.url))],
    outfile: runner,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'warning',
    // The compiler's Babel dependencies are CommonJS and require Node built-ins.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    plugins: [{
      name: 'watch-runner',
      setup(builder) {
        builder.onResolve({ filter: /^esbuild$/ }, () => ({ path: pathToFileURL(require.resolve('esbuild')).href, external: true }));
        builder.onResolve({ filter: /^@getforma\/compiler$/ }, () => ({ path: fileURLToPath(new URL('../../../compiler/src/index.ts', import.meta.url)) }));
      },
    }],
  });
  // On POSIX the child leads its own process group, so the kill below also
  // reaches the esbuild service it starts, which otherwise can still be
  // writing into the output directory while the test removes it (ENOTEMPTY).
  const group = process.platform !== 'win32';
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {build} from ${JSON.stringify(pathToFileURL(runner).href)}; await build(${JSON.stringify({ ...config, watch: true })});`], { stdio: ['ignore', 'pipe', 'pipe'], detached: group });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const watcher: Watcher = {
    manifest: () => {
      expect(child.exitCode, output).toBeNull();
      return JSON.parse(readFileSync(join(config.outputDir, 'manifest.json'), 'utf8'));
    },
    output: () => output,
  };
  try {
    await body(watcher);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      if (group && child.pid !== undefined) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
      await exited;
    }
  }
}

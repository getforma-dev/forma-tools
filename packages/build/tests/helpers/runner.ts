/**
 * Bundle `src/build.ts`, with the compiler's source, into one ES module a
 * child process can import: the watch helper (watch.ts) and the child-build
 * helper (child-build.ts) run `build()` outside the test's process with it.
 * The compiler resolves esbuild for its JSX transform relative to its own
 * module, which is the bundle here.
 */

import { build as bundle } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function bundleBuildRunner(outfile: string): Promise<void> {
  const require = createRequire(import.meta.url);
  await bundle({
    entryPoints: [fileURLToPath(new URL('../../src/build.ts', import.meta.url))],
    outfile,
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
}

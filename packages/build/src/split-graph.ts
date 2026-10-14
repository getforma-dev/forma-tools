import type { Metafile } from 'esbuild';
import { basename, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import type { BuildEntry } from './types.js';

export interface SplitGraph {
  /** Logical entry names and all emitted chunks map to their existing graph-safe filenames. */
  assets: Record<string, string>;
  staticDependencies: Record<string, string[]>;
  files: Set<string>;
}

/** esbuild hashes depend on linked chunks. Renaming those files afterward breaks
 * both static and dynamic imports; preserve this graph as one immutable unit. */
export function splitGraph(meta: Metafile, entries: BuildEntry[], outputDir: string): SplitGraph {
  const assets: Record<string, string> = {};
  const files = new Set<string>();
  const outputs = new Map(Object.entries(meta.outputs).map(([path, value]) => [resolve(path), { file: basename(path), value }]));
  const entryOutputs = new Map<string, string>();
  for (const [path, output] of outputs) {
    if (resolve(outputDir, output.file) !== path) throw new Error('Split build emitted a nested output; the manifest requires flat asset filenames.');
    files.add(output.file);
    assets[output.file] = output.file;
    if (!output.value.entryPoint || !output.file.endsWith('.js')) continue;
    const entry = entries.find(candidate => realpathSync(candidate.entry) === realpathSync(resolve(output.value.entryPoint!))
      && (output.file === candidate.outfile || output.file.startsWith(`${basename(candidate.outfile, '.js')}.`)));
    if (entry) { assets[entry.outfile] = output.file; entryOutputs.set(entry.outfile, path); }
  }
  const staticDependencies: Record<string, string[]> = {};
  for (const entry of entries) {
    const entryPath = entryOutputs.get(entry.outfile);
    if (!entryPath) throw new Error(`Split build is missing entry ${entry.outfile}.`);
    const visited = new Set<string>([entryPath]);
    const files: string[] = [];
    const visit = (path: string) => {
      const output = outputs.get(path);
      if (!output) throw new Error(`Split build references missing output ${path}.`);
      for (const dependency of output.value.imports) {
        if (dependency.external || dependency.kind === 'dynamic-import') continue;
        const dependencyPath = resolve(dependency.path);
        if (visited.has(dependencyPath)) continue;
        visited.add(dependencyPath);
        const imported = outputs.get(dependencyPath);
        if (!imported) throw new Error(`Split build references missing dependency ${dependency.path}.`);
        files.push(imported.file);
        visit(dependencyPath);
      }
    };
    visit(entryPath);
    staticDependencies[assets[entry.outfile]] = files;
  }
  return { assets, staticDependencies, files };
}

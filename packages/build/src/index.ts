/**
 * @getforma/build — Public API
 *
 * Parameterized build pipeline for Forma applications.
 * Handles esbuild bundling, CSS generation, SSR IR emission,
 * content hashing, compression, manifest generation, and more.
 */

export { build } from './build.js';

export type {
  BuildConfig,
  BuildEntry,
  BuildResult,
  CssEntry,
  RouteMapping,
  AssetManifest,
  RouteManifest,
} from './types.js';

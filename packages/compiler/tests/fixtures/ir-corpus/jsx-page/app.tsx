// Corpus case: the shape a real JSX project actually compiles to.
//
// Every file here is .tsx, so the compiler runs esbuild over each one before
// parsing — and esbuild rewrites `export function JsxPage() {…}` into
//
//     function JsxPage() { … }
//     export { JsxPage };
//
// An analyzer that reads only `ExportNamedDeclaration.declaration` finds
// NOTHING in any of these files. That was the state of the world: 100% of .tsx
// pages fell back to placeholder IR (`<div id="app"></div>`, no slots, no
// islands, zero server-rendered content) while the build printed one
// misleading line and exited 0.
//
// Nothing in this directory is written in the `export function` + `.ts` shape
// the analyzer's unit tests hand it as a string. The extension is the whole
// point: it is what makes the transform run.
import { mount, activateIslands } from 'formajs';
import { JsxPage } from './page';
import { CounterBadge } from './counter-badge';

activateIslands({ CounterBadge });

mount(() => JsxPage(), '#app');

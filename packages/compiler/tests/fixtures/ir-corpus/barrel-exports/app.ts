// Corpus case: every component reached through an `index.ts` barrel.
//
// This is how a real project organises components, and it used to be a total
// loss: the analyzer read the barrel, found `export { BarrelPage } from
// './page'`, and — having no way to follow a re-export across files — reported
// "could not find return h() tree", then fell back to placeholder IR.
//
// Three export forms are in play here, all previously unresolvable:
//   export { BarrelPage } from './page'         (named cross-file re-export)
//   export * from './tag'                       (star re-export)
//   export { StatusChipImpl as StatusChip }     (ALIASED specifier export, in
//                                                the file that declares it)
import { mount, activateIslands } from 'formajs';
import { BarrelPage } from './components';
import { StatusChip } from './components';

activateIslands({ StatusChip });

mount(() => BarrelPage(), '#app');

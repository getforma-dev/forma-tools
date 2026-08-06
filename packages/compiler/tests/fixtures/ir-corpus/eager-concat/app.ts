// Corpus case: expressions the page computes EAGERLY, with no `() => …`
// wrapper — the form `'Player ' + name()` takes.
//
// Every other case binds its dynamic values through a function, which is the
// shape the walker had a fold for. This one uses the shape it did not: in
// child position it shipped an empty island shell, and in attribute position
// it minted a slot with no default AND no diagnostic, so the attribute went
// out with no value and the build stayed green. The case therefore pins two
// things the JS side cannot check alone — that the folded value reaches the
// Rust walker as real content, and that a NUMBER survives concatenation as
// "3" rather than an object or an empty string.
import { mount } from 'formajs';
import { ConcatPage } from './page';

mount(() => ConcatPage(), '#app');

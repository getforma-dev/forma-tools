import { h, createSignal } from 'formajs';
import { Panel } from './panel';

// Scope 1: the ROOT PAGE FILE's module scope. This is where a page's
// top-level state naturally lives, and it was the one scope the named-mount
// path deliberately refused to read.
const [heading] = createSignal('Scopes');

export function ScopesPage() {
  // The component body — the only scope that always worked. Kept here so the
  // case shows the new scopes alongside the old one rather than instead of it.
  const [subtitle] = createSignal('four ways to declare');

  return h('main', { id: 'app' },
    h('h1', null, () => heading()),
    h('h2', null, () => subtitle()),
    Card(),
    Panel(),
    Blocked(),
  );
}

// Scope 2: an inlined FILE-LOCAL sub-component's body.
//
// `count` defaults to ZERO, which is the case that proves "no default" and
// "default 0" are different: with no default the slot is Null and the server
// renders nothing, while the client renders `0`. `ready` is a boolean bound
// straight to an attribute, so the server must emit the bare attribute name
// exactly when the client would.
function Card() {
  const [count] = createSignal(0);
  const [ready] = createSignal(true);

  return h('article', { class: 'card', 'data-ready': () => ready() },
    h('span', null, () => count()),
  );
}

// Scope 4: a declaration BELOW the top level of a scope. The statement list
// walker used to iterate only the top level, so this signal was invisible even
// though the tree it feeds is the one the component returns.
function Blocked() {
  if (heading()) {
    const [note] = createSignal('from a nested block');
    return h('p', { class: 'note' }, () => note());
  }
  return h('p', { class: 'note' }, 'unreachable');
}

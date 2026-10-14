// The review's b01, b02 and b03 (FORMA-126 review, should-fix 2): the prop
// written through a computed or string key, a const holding its name, or
// Reflect.set; and an __html key wherever it is written.
import { h } from '@getforma/core';

export function computedMember(s: string) {
  const props: Record<string, unknown> = {};
  props['dangerously' + 'SetInnerHTML'] = { __html: s }; // expect: dangerouslySetInnerHTML in computedMember
  return h('div', props);
}

const K = 'dangerouslySetInnerHTML';
export function constKey(s: string) {
  return h('div', { [K]: { __html: s } }); // expect: dangerouslySetInnerHTML in constKey
}

export function reflect(s: string) {
  const props = {};
  Reflect.set(props, 'dangerouslySetInnerHTML', { __html: s }); // expect: dangerouslySetInnerHTML in reflect
  return h('div', props);
}

export function reflectHeld(inner: unknown) {
  const props = {};
  Reflect.set(props, K, inner); // expect: dangerouslySetInnerHTML in reflectHeld
  return h('div', props);
}

export function memberHeld(props: Record<string, unknown>, inner: unknown) {
  props['dangerouslySetInnerHTML'] = inner; // expect: dangerouslySetInnerHTML in memberHeld
}

export const loose = { __html: '<b>an __html key means one thing</b>' }; // expect: dangerouslySetInnerHTML
export const quoted = { ['__html']: location.hash }; // expect: dangerouslySetInnerHTML

import { h } from '@getforma/core';

const inner = { __html: '<b>bold</b>' };
export const held = h('div', { dangerouslySetInnerHTML: inner }); // expect: dangerouslySetInnerHTML
export const reactive = h('div', {
  dangerouslySetInnerHTML: () => ({ __html: String(Date.now()) }), // expect: dangerouslySetInnerHTML
});
export function passed(props: Record<string, unknown>) {
  const dangerouslySetInnerHTML = props.raw;
  return h('div', { dangerouslySetInnerHTML }); // expect: dangerouslySetInnerHTML in passed
}
export const quoted = h('div', { 'dangerouslySetInnerHTML': { __html: location.hash } }); // expect: dangerouslySetInnerHTML
export function assigned(props: { dangerouslySetInnerHTML?: unknown }, s: string) {
  props.dangerouslySetInnerHTML = { __html: s }; // expect: dangerouslySetInnerHTML in assigned
}

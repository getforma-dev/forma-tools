// The A2 audit's S2: mountMarkup(root, markup, …), core 2.1.0's tiered mount
// (FORMA-128), is a raw sink, as reconcile() is: a string still works in 2.x.
import { mountMarkup, trustedHtml } from '@getforma/core/runtime';
import * as R from '@getforma/core/runtime';

export function widget(root: Element, generated: string) {
  return mountMarkup(root, generated, { tier: 'reviewed', grants: {} }); // expect: mountMarkup in widget
}

export function vouched(root: Element, generated: string) {
  return mountMarkup(root, trustedHtml(generated), { tier: 'reviewed', grants: {} }); // expect: trustedHtml in vouched
}

export const namespaced = (root: Element, html: string) => R.mountMarkup(root, html, { tier: 'compiled' }); // expect: mountMarkup
export const bracket = (root: Element, html: string) => R['mountMarkup'](root, html, { tier: 'compiled' }); // expect: mountMarkup
export const cdn = (root: Element, html: string) => (window as any).FormaRuntime.mountMarkup(root, html, { tier: 'compiled' }); // expect: mountMarkup
export const later = R.mountMarkup; // expect: mountMarkup

export { mountMarkup as mount } from '@getforma/core/runtime'; // expect: mountMarkup

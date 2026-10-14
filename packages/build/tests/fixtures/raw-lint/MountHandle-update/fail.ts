// The A2 audit's S2: a mount handle's update(markup) renders new markup into
// the root, the same raw sink as mountMarkup()'s.
import { mountMarkup, trustedHtml } from '@getforma/core/runtime';

export function refresh(root: Element, first: string, next: string) {
  const widget = mountMarkup(root, trustedHtml(first), { tier: 'reviewed' }); // expect: trustedHtml in refresh
  widget.update(next); // expect: MountHandle.update in refresh
  widget.update(trustedHtml(next)); // expect: trustedHtml in refresh
}

export class Host {
  handle = mountMarkup(document.body, trustedHtml('<main></main>'), { tier: 'compiled' }); // expect: trustedHtml in Host
  render(markup: string) {
    this.handle.update(markup); // expect: MountHandle.update in Host.render
  }
}

export function chained(root: Element, a: string, b: string) {
  mountMarkup(root, trustedHtml(a), { tier: 'reviewed' }).update(b); // expect: trustedHtml in chained expect: MountHandle.update in chained
}

let current: ReturnType<typeof mountMarkup> | null = null;
export function assigned(root: Element, a: string, b: string) {
  current = mountMarkup(root, trustedHtml(a), { tier: 'reviewed' }); // expect: trustedHtml in assigned
  current?.update(b); // expect: MountHandle.update in assigned
}

export function destructured(root: Element, a: string, b: string) {
  const { update } = mountMarkup(root, trustedHtml(a), { tier: 'reviewed' }); // expect: trustedHtml in destructured
  update(b); // expect: MountHandle.update in destructured
}

export function passed(root: Element, a: string, stream: { on(e: string, f: (s: string) => void): void }) {
  const w = mountMarkup(root, trustedHtml(a), { tier: 'reviewed' }); // expect: trustedHtml in passed
  stream.on('data', w.update); // expect: MountHandle.update in passed
}

// Handles from core's namespace, the CDN global and a bracket.
import * as R from '@getforma/core/runtime';

export function namespaced(root: Element, a: string, b: string) {
  const nsWidget = R.mountMarkup(root, R.trustedHtml(a), { tier: 'reviewed' }); // expect: trustedHtml in namespaced
  nsWidget.update(b); // expect: MountHandle.update in namespaced
}

export function cdn(root: Element, a: string, b: string) {
  const cdnWidget = (window as any).FormaRuntime.mountMarkup(root, trustedHtml(a), { tier: 'reviewed' }); // expect: trustedHtml in cdn
  cdnWidget.update(b); // expect: MountHandle.update in cdn
}

export function bracket(root: Element, a: string, b: string) {
  const bracketWidget = R['mountMarkup'](root, trustedHtml(a), { tier: 'reviewed' }); // expect: trustedHtml in bracket
  bracketWidget.update(b); // expect: MountHandle.update in bracket
}

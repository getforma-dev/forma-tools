// The review's b11 and b12 (FORMA-126 review, should-fix 1): trust is the
// binding's, not the name's. Only a const bound to trustedHtml() is trusted,
// and only where no nearer binding of its name shadows it.
import { h, trustedHtml } from '@getforma/core';

export function good(md: string) {
  const html = trustedHtml(md); // expect: trustedHtml in good
  return h('div', { dangerouslySetInnerHTML: { __html: html } });
}

export function bad(html: string) {
  return h('div', { dangerouslySetInnerHTML: { __html: html } }); // expect: dangerouslySetInnerHTML in bad
}

export function reassigned(md: string, evil: string) {
  let html = trustedHtml(md); // expect: trustedHtml in reassigned
  html = evil as any;
  return h('div', { dangerouslySetInnerHTML: { __html: html } }); // expect: dangerouslySetInnerHTML in reassigned
}

export function letNotConst(md: string) {
  let html = trustedHtml(md); // expect: trustedHtml in letNotConst
  return h('div', { dangerouslySetInnerHTML: { __html: html } }); // expect: dangerouslySetInnerHTML in letNotConst
}

export function shadowed(md: string, rows: string[]) {
  const html = trustedHtml(md); // expect: trustedHtml in shadowed
  return rows.map((html) => h('li', { dangerouslySetInnerHTML: { __html: html } })); // expect: dangerouslySetInnerHTML in shadowed
}

export function nested(md: string) {
  const html = trustedHtml(md); // expect: trustedHtml in nested
  return () => h('div', { dangerouslySetInnerHTML: { __html: html } });
}

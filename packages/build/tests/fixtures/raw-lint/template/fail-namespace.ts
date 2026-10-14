// The review's b07, b10 and b19 (FORMA-126 review, should-fix 4): core's
// namespace reached by destructuring, an alias, a bracket or require().
import * as F from '@getforma/core';

const { template } = F;
export const destructured = (s: string) => template(s); // expect: template

const G = F;
export const aliased = (s: string) => G.template(s); // expect: template

export const bracket = (s: string) => F['template'](s); // expect: template

const { templateMany: many } = G;
export function renamed(s: string) {
  return many(s); // expect: templateMany in renamed
}

export const required = require('@getforma/core').template; // expect: template

export async function awaited(s: string) {
  return (await import('@getforma/core')).template(s); // expect: template in awaited
}

export const vouched = (s: string) => F['trustedHtml'](s); // expect: trustedHtml
export const typed = (s: string) => G.template(F['trustedHtml'](s)); // expect: trustedHtml

// trustedHtml called, renamed, on a namespace, held in a variable, exported
// under another name: each is one raw entry.
import { trustedHtml, trustedHtml as vouch } from '@getforma/core';
import * as forma from '@getforma/core';

export function logo(markup: string) {
  return trustedHtml(markup); // expect: trustedHtml in logo
}

export const shell = (markup: string) => {
  return vouch(markup); // expect: trustedHtml in shell
};

export class Docs {
  render(markup: string) {
    return forma.trustedHtml(markup); // expect: trustedHtml in Docs.render
  }
}

const mint = trustedHtml; // expect: trustedHtml
export function later(s: string) {
  return mint(s); // expect: trustedHtml in later
}

export { trustedHtml as th }; // expect: trustedHtml

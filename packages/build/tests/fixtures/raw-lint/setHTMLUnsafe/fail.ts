import { setHTMLUnsafe, trustedHtml } from '@getforma/core';

export function paint(el: HTMLElement, markup: string) {
  setHTMLUnsafe(el, markup); // expect: setHTMLUnsafe in paint
  setHTMLUnsafe(el, trustedHtml(markup)); // expect: trustedHtml in paint
  const vouched = trustedHtml(markup); // expect: trustedHtml in paint
  setHTMLUnsafe(el, vouched);
}

export const later = setHTMLUnsafe; // expect: setHTMLUnsafe

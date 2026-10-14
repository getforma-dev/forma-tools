import { reconcile, trustedHtml } from '@getforma/core/runtime';

// Vector Studio's and Generative UI's shape: generated markup, a string.
export class Stage {
  update(el: Element, html: string) {
    reconcile(el, html); // expect: reconcile in Stage.update
    reconcile(el, trustedHtml(html)); // expect: trustedHtml in Stage.update
  }
}

// Generative UI's shape: a private method.
export class Host {
  #paint(el: Element, html: string) {
    reconcile(el, html); // expect: reconcile in Host.#paint
  }
}

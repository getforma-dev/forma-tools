const { reconcile } = require('@getforma/core/runtime');

export function paint(el, html) {
  reconcile(el, html); // expect: reconcile in paint
}

export function morph(el, html) {
  window.FormaRuntime.reconcile(el, html); // expect: reconcile in morph
}

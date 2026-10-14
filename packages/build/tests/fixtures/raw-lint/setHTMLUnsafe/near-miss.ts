// setHTMLUnsafe(el, markup) in a comment.
// The browser's own Element.setHTMLUnsafe is not one of Forma's exits: a
// page enforcing Trusted Types refuses a string there (DR-20).
export function native(el: Element, markup: string) {
  el.setHTMLUnsafe(markup);
}
function setHTMLUnsafeLocal(el: Element, text: string) {
  el.textContent = text;
}
export const note = 'setHTMLUnsafe(el, markup)';
export { setHTMLUnsafeLocal };

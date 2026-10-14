// mountMarkup(root, html, { tier: 'reviewed' }) in a comment.
import { mountMarkup } from './my-mount';

export const note = 'mountMarkup(root, markup) is a raw sink';
export const local = (root: Element, html: string) => mountMarkup(root, html);
export function viaObject(lib: { mountMarkup(root: Element, html: string): void }, root: Element) {
  lib.mountMarkup(root, '<p>x</p>');
}

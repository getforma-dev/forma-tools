// widget.update(next) in a comment.
import { createStore } from './store';

export const note = 'handle.update(markup) is a raw sink';
export function other(next: string) {
  const widget = createStore();
  widget.update(next);
  const { update } = createStore();
  update(next);
  return new Map<string, string>().set('update', next);
}
export function renamed(next: string) {
  const { update: up } = createStore();
  up(next);
}

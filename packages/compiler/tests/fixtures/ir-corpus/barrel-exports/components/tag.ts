// Reached through `export * from './tag'` — a star re-export names nothing, so
// the resolver has to search the modules a barrel spreads.
import { h } from 'formajs';

export function Tag(props: { label: string }) {
  return h('span', { class: 'tag' }, props.label);
}

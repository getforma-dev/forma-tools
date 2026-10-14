import { h } from '@getforma/core';

// h('script', { src }) in a comment.
export function Help() {
  return (
    <div>
      <noscript>Enable JavaScript.</noscript>
      {h('p', null, 'script')}
      {h('pre', null, "h('script')")}
    </div>
  );
}
export const scripts = h('ul', { class: 'script-list' });

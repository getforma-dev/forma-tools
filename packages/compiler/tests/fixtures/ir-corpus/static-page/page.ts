import { h } from 'formajs';

export function StaticPage() {
  return h('main', { id: 'app', class: 'shell' },
    h('h1', null, 'Forma'),
    h('p', { class: 'lede' }, 'Rendered entirely from static opcodes.'),
    h('img', { src: '/logo.svg', alt: 'Forma logo', width: 64 }),
    h('ul', { class: 'links' },
      h('li', null, h('a', { href: '/docs' }, 'Docs')),
      h('li', null, h('a', { href: '/blog' }, 'Blog')),
    ),
    h('hr', null),
  );
}

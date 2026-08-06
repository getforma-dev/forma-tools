// SSR root component fixture. Deliberately combines every construct that
// mints a slot name — dynamic attributes, dynamic text children, a list, a
// show, an inlined sub-component and an island — so the page-wide slot-name
// namespace is exercised end to end through the real plugin.
import { h, createSignal, createList, createShow } from 'formajs';
import { StatusPanel } from './status-panel';
import { SummaryCard } from './summary-card';

const [title] = createSignal('Dashboard');
const [busy] = createSignal(false);

const NAV_ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'Reports', href: '/reports' },
];

export function DashboardPage() {
  return h('section', { id: 'app', class: () => busy() ? 'page busy' : 'page' },
    h('header', null, h('h1', null, () => title())),
    h('nav', null, ...NAV_ITEMS.map((item) => h('a', { href: item.href }, item.label))),
    SummaryCard(),
    StatusPanel(),
    // Two dynamic text children at the same child index under different
    // parents, and two dynamic attributes sharing a key across nesting levels.
    h('div', { class: 'metrics' },
      h('span', null, () => formatUptime()),
      h('span', null, () => formatLatency()),
    ),
    createList(rows, (r) => r.id, (r) => h('li', { class: () => rowClass(r) }, r.name)),
    createShow(() => busy(), () => h('p', null, 'Loading...'), () => h('p', null, 'Ready')),
    h('form', { onSubmit: handleSubmit },
      h('input', { type: 'search', placeholder: 'Filter' }),
      h('button', { disabled: () => busy() }, 'Apply'),
    ),
  );
}

// The entry. On a server-rendered page the islands are activated from a
// literal registry, and the browser-only chart is registered as browserOnly()
// returns it: activation calls it with the island's element and props. With
// no island (development, Phase 1) the page is mounted whole, and the chart
// renders as any component does.
import { h, mount, activateIslands } from '@getforma/core';
import { Chart } from './chart';
import { ReportPage } from './page';

if (document.querySelector('[data-forma-island]')) {
  activateIslands({ Chart });
} else {
  mount(() => ReportPage(), '#app');
}

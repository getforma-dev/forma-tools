// A server-rendered page with one subtree the server does not render: the
// chart, declared browserOnly() (L-1). The compiler emits it as a registered
// island whose server output is its empty host element with its declared
// props; the rest of the page is the walker's HTML as usual.
import { h } from '@getforma/core';
import { Chart } from './chart';

export function ReportPage() {
  return (
    <main class="report">
      <h1 id="report-title">Quarterly report</h1>
      <p id="report-summary">Revenue rose in every region.</p>
      <Chart title="Sales" points={3} />
    </main>
  );
}

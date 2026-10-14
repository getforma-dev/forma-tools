// A component that renders in the browser alone: a stand-in for a chart
// library that measures the viewport. browserOnly() is the one searchable
// marker for it (DR-1, L-1).
import { h, createSignal, browserOnly } from '@getforma/core';

function ChartImpl(props: { title?: string; points?: number }) {
  const [points, setPoints] = createSignal(props.points ?? 0);
  return (
    <figure id="chart" data-width={String(window.innerWidth)}>
      <figcaption id="chart-caption">{() => `${props.title}: ${points()} points`}</figcaption>
      <button id="chart-add" type="button" onClick={() => setPoints(points() + 1)}>Add a point</button>
    </figure>
  );
}

export const Chart = browserOnly(ChartImpl);

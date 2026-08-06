// A sibling-file sub-component, taking props. Reached only by resolving the
// page's own import — it is not imported by the entry point, which is exactly
// the case that used to degrade to an empty island shell.
import { h } from 'formajs';

export function SummaryCard(props: { title: string; body: string }) {
  return (
    <article class="card">
      <h2>{props.title}</h2>
      <p>{props.body}</p>
    </article>
  );
}

import { h } from '@getforma/core';
import { sanitize } from './sanitize';

// kmd's shape: its own sanitiser's output, a string.
export function Snippet(props: { snippet: string }) {
  return <p dangerouslySetInnerHTML={{ __html: sanitize(props.snippet) }} />; // expect: dangerouslySetInnerHTML in Snippet
}

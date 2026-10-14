import { h } from '@getforma/core';

// trustedHtml(markup)
export function Help() {
  const rawHtml = 'escaped by h()';
  return <p title="trustedHtml(markup)">Use trustedHtml(markup) for raw markup: {rawHtml}</p>;
}

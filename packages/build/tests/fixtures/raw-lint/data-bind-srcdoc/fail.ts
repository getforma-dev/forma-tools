export function bind(frame: HTMLIFrameElement) {
  frame.setAttribute('data-bind:srcdoc', '{doc}'); // expect: data-bind:srcdoc in bind
}

export const page = `
<section>
  <iframe sandbox data-bind:srcdoc="{doc}"></iframe> <!-- expect: data-bind:srcdoc -->
</section>`;

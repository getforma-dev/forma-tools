import { h, setAttr, trustedHtml } from '@getforma/core';

export function Preview(props: { doc: string }) {
  return <iframe sandbox="" srcdoc={props.doc} />; // expect: srcdoc in Preview
}

export function Vouched(props: { doc: string }) {
  return <iframe sandbox="" srcdoc={trustedHtml(props.doc)} />; // expect: trustedHtml in Vouched
}

export function attribute(el: HTMLElement, doc: string) {
  setAttr(el, 'srcdoc', doc); // expect: srcdoc in attribute
  el.setAttribute('srcdoc', doc); // expect: srcdoc in attribute
  (el as HTMLIFrameElement).srcdoc = doc; // expect: srcdoc in attribute
}

export const cased = h('iframe', { srcDoc: '<p>static</p>' }); // expect: srcdoc

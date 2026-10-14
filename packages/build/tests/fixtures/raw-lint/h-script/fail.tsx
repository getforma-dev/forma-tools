// h('script') (the lead's decision on the FORMA-126 review): a script element
// core builds runs its src under 'strict-dynamic'; 3.0.0 refuses it.
import { h, h as el } from '@getforma/core';
import * as F from '@getforma/core';

export function Analytics(props: { src: string }) {
  return <script src={props.src} />; // expect: h('script') in Analytics
}

export const loader = (src: string) => h('script', { src }); // expect: h('script')
export const renamed = (src: string) => el('SCRIPT', { src }); // expect: h('script')
export const namespaced = (src: string) => F.h('script', { src }); // expect: h('script')

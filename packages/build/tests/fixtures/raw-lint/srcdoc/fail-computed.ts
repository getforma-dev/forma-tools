// The review's b05, b06 and r.ts (FORMA-126 review, should-fix 2): srcdoc
// written through a string index, a template literal name, Reflect.set,
// Object.defineProperty or a const holding its name.
export function stringIndex(el: HTMLIFrameElement, s: string) {
  el['srcdoc'] = s; // expect: srcdoc in stringIndex
}

export function templateName(el: HTMLIFrameElement, s: string) {
  el.setAttribute(`srcdoc`, s); // expect: srcdoc in templateName
}

export function reflect(el: HTMLIFrameElement, s: string) {
  Reflect.set(el, 'srcdoc', s); // expect: srcdoc in reflect
}

export function define(el: HTMLIFrameElement, s: string) {
  Object.defineProperty(el, 'srcdoc', { value: s }); // expect: srcdoc in define
}

const SRCDOC = 'srcdoc';
export function constName(el: any, s: string) {
  el[SRCDOC] = s; // expect: srcdoc in constName
  el.setAttribute(SRCDOC, s); // expect: srcdoc in constName
}

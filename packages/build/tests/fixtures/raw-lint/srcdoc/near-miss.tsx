import { h } from '@getforma/core';

// <iframe srcdoc={doc} /> in a comment.
export function Embed() {
  return <iframe sandbox="" src="/doc.html" title="srcdoc is not used here" />;
}
export function read(frame: HTMLIFrameElement) {
  const current = frame.srcdoc;
  return current + frame.getAttribute('srcdoc');
}
export const note = 'set srcdoc only through trustedHtml()';
export const names = ['srcdoc', 'title'];
export const codes: Record<string, readonly string[]> = { frame: ['FORMA_W_RAW_SRCDOC', 'srcdoc', 'note'] };

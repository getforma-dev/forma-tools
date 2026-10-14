// The CDN runtime's global, and a destructured rename of it.
export function frame(markup) {
  return window.FormaRuntime.trustedHtml(markup); // expect: trustedHtml in frame
}

const { trustedHtml: vouch } = FormaRuntime;
export function doc(markup) {
  return vouch(markup); // expect: trustedHtml in doc
}

// trustedHtml(markup) in a comment is not a use.
/* trustedHtml(markup) in a block comment either */
export const note = 'call trustedHtml(markup) to vouch for markup';
export const rawHtml = '<b>a variable named rawHtml</b>';
export const trustedHtmlNote = `a template mentioning trustedHtml(${1})`;
export const settings = { trustedHtmlish: true };
export function TrustedHtmlView() {
  return rawHtml;
}

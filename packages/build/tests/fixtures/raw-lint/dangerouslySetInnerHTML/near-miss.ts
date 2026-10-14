// dangerouslySetInnerHTML: { __html: x } in a comment.
export const note = 'dangerouslySetInnerHTML takes { __html: trustedHtml(x) }';
export function isRaw(key: string, props: { dangerouslySetInnerHTML?: unknown }) {
  if (props.dangerouslySetInnerHTML) return true;
  return key === 'dangerouslySetInnerHTML';
}
export const json = { __html: 'an __html key alone is data' };

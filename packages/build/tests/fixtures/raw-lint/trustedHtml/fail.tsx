import { h, trustedHtml } from '@getforma/core';

// The typed form is one raw entry, the trustedHtml() call: the sink taking it
// is not reported.
export function Article(props: { html: string }) {
  return (
    <article
      class="prose"
      dangerouslySetInnerHTML={{
        __html: trustedHtml(props.html) /* expect: trustedHtml in Article */,
      }}
    />
  );
}

export function Frame(props: { doc: string }) {
  const doc = trustedHtml(props.doc); // expect: trustedHtml in Frame
  return <iframe sandbox="" srcdoc={doc} title="preview" />;
}

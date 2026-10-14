// The review's b14 and Generative UI's client/runtime-page.ts (FORMA-126
// review, should-fix 5): a sink re-exported from core reaches importers the
// lint does not follow, so the re-export is the raw entry.
import { setHTMLUnsafe } from '@getforma/core';

export { mount, reconcile, unmount } from '@getforma/core/runtime'; // expect: reconcile
export { template as tpl } from '@getforma/core'; // expect: template
export { setHTMLUnsafe }; // expect: setHTMLUnsafe
// trustedHtml under its own name is found by name wherever it is imported.
export { trustedHtml } from '@getforma/core';
export { reconcile as reconcileLedger } from './ledger';

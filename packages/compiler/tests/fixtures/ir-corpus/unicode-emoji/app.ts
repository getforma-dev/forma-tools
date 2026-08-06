// Corpus case: non-ASCII text, non-ASCII static attribute values and a
// non-ASCII signal default.
//
// Every FMIR string is length-prefixed in BYTES. A prefix counting UTF-16 code
// units instead is invisible to an all-ASCII corpus — the two counts are equal
// for every character below U+0080 — and invisible to a JS-side reader that
// makes the same mistake in the same direction. The Rust parser is the only
// consumer that reads the prefix as bytes and rejects the file when it is
// wrong, so this case is what makes that prefix testable at all.
import { mount } from 'formajs';
import { UnicodePage } from './page';

mount(() => UnicodePage(), '#app');

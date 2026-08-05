// Corpus case: dynamic text children (DYN_TEXT).
// Several of them sit at the SAME child index under different parents, which
// is the second half of the slot-name collision the page-wide text registry
// prevents. Each DYN_TEXT also carries its own marker id — a marker collision
// is invisible to a reader that only checks slot ids, but shows up in the
// rendered comment markers.
import { mount } from 'formajs';
import { TextPage } from './page';

mount(() => TextPage(), '#app');

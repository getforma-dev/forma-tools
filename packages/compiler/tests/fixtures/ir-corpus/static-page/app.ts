// Corpus case: a page with no slots and no islands at all.
// Pins the degenerate FMIR shape — empty slot table, empty island table —
// which is exactly the shape a reader is most likely to mis-handle.
import { mount } from 'formajs';
import { StaticPage } from './page';

mount(() => StaticPage(), '#app');

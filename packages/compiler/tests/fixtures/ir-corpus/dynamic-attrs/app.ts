// Corpus case: dynamic attributes on both open and void tags.
// TWO of them bind the same `class` key, which is the collision the page-wide
// attr-name registry exists to prevent: duplicate slot NAMES collapse in the
// Rust name -> id map (last insert wins), silently stranding the earlier slot.
import { mount } from 'formajs';
import { AttrsPage } from './page';

mount(() => AttrsPage(), '#app');

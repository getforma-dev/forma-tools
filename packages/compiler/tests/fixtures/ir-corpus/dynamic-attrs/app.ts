// Corpus case: dynamic attributes on both open and void tags.
// TWO of them bind the same `class` key, which is the collision the page-wide
// attr-name registry exists to prevent: forma-ir resolves a duplicated slot
// NAME to the first slot in table order, silently stranding the later one.
// Two more are HTML BOOLEAN attributes over TYPE_BOOL slots, where presence —
// not value — is what the browser reads.
import { mount } from 'formajs';
import { AttrsPage } from './page';

mount(() => AttrsPage(), '#app');

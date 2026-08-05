import { h } from 'formajs';
import { OuterPanel } from './outer-panel';
import { InnerBadge } from './inner-badge';

export function NestedPage() {
  return h('main', { id: 'app' },
    // Island 0, whose own subtree starts island 1.
    OuterPanel(),
    h('hr', null),
    // The same island component again, this time at page level: a second
    // island entry over one component name, with its own id and byte_offset.
    InnerBadge(),
  );
}

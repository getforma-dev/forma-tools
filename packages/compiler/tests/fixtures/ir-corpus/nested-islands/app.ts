// Corpus case: an island whose subtree contains another island, plus that
// same inner island again at page level.
//
// Nesting is where the island table stops being a flat list: the outer entry's
// byte_offset must still land on its own ISLAND_START, its slot_ids must
// include the slots the inner island referenced, and every island still owes
// the walker a shell element of its own to hang data-forma-* on. A nested
// ISLAND_START reached before the outer island has opened a tag is
// IrError::NestedIslandRoot, not a silently dropped island identity.
import { mount, activateIslands } from 'formajs';
import { NestedPage } from './page';
import { OuterPanel } from './outer-panel';
import { InnerBadge } from './inner-badge';

activateIslands({ OuterPanel, InnerBadge });

mount(() => NestedPage(), '#app');

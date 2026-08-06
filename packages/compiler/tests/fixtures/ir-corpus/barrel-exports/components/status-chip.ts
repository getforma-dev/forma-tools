// Island declared under a DIFFERENT name than the one it is exported as, and
// exported by specifier rather than declaration — `export { X as Y }`, the form
// all three copies of the old lookup were blind to.
//
// Its signal lives at module scope in THIS file, while the compiler is pointed
// at the barrel. Reading only the barrel's module scope finds nothing, so the
// island would keep its identity but lose its named slot and SSR default.
import { h, createSignal } from 'formajs';

const [chipState] = createSignal('degraded');
const [chipPinned] = createSignal(false);

function StatusChipImpl() {
  return h('em', { class: 'chip', hidden: () => chipPinned() },
    () => chipState(),
  );
}

export { StatusChipImpl as StatusChip };

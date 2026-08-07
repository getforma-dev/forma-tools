// The barrel, aliasing on the way through. The island imports `liveStatus`;
// the binding it must resolve to is `status` in store.ts — same declaration,
// same frame, same slot as the page's direct import.
export { status as liveStatus } from '../store';

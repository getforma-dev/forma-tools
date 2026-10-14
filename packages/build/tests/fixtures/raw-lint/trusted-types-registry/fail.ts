// Core's registry reaches the forma policy's mint without trustedHtml().
export const handle = (globalThis as any)[Symbol.for('@getforma/core#trusted-types')]; // expect: trusted-types-registry

export function key() {
  return `@getforma/core#trusted-types`; // expect: trusted-types-registry in key
}

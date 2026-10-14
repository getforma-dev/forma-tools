// Core's registry reaches the forma policy's mint without trustedHtml().
export const handle = (globalThis as any)[Symbol.for('@getforma/core#trusted-types')]; // expect: trusted-types-registry

export function key() {
  return `@getforma/core#trusted-types`; // expect: trusted-types-registry in key
}

// The review's b15 and b22: a sum of literals and an escape, both folded by esbuild.
export const folded = Symbol.for('@getforma/core' + '#trusted-types'); // expect: trusted-types-registry
export const escaped = Symbol.for('@getforma/core\x23trusted-types'); // expect: trusted-types-registry

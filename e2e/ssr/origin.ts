/**
 * Where the SSR e2e server listens. One definition, read by
 * playwright.config.ts (which starts e2e/ssr/serve.mjs on it) and by
 * regressions.spec.ts. Several clones of this repo may run the lane on one
 * machine at once; give each its own port with FORMA_SSR_E2E_PORT.
 */
export const SSR_PORT = Number(process.env.FORMA_SSR_E2E_PORT || 3458);
export const SSR_ORIGIN = `http://127.0.0.1:${SSR_PORT}`;

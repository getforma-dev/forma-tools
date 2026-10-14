/**
 * Server functions are deprecated, and are removed in 3.0.0 with
 * `@getforma/core/server` and `formaServer` (FORMA-131; DR-22).
 * `transformServerFunctions`, the "use server" transform, logs BUILD-901 on
 * its first call in a process, and transforms as before.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('transformServerFunctions is deprecated (FORMA-131)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('transformServerFunctions logs BUILD-901 once, naming 3.0.0', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { transformServerFunctions } = await import('../src/index');
    const withDirective = 'export async function save(x: string) {\n  "use server";\n  return x;\n}\n';

    // The first call warns whatever the module holds: this one has no directive.
    expect(transformServerFunctions('export const x = 1;\n', '/app/plain.ts', { mode: 'client' })).toBeNull();
    const client = transformServerFunctions(withDirective, '/app/save.ts', { mode: 'client' });
    const server = transformServerFunctions(withDirective, '/app/save.ts', { mode: 'server' });

    const ours = warn.mock.calls.map((args) => String(args[0])).filter((line) => line.includes('BUILD-901'));
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatch(/^\[@getforma\/compiler\] BUILD-901 transformServerFunctions/);
    expect(ours[0]).toContain('removed in 3.0.0');
    expect(ours[0]).toContain('Rust server');
    // Deprecated, not changed: the stub and the registration are still written.
    expect(client!.code).toContain('$$serverFunction("/rpc/save_');
    expect(server!.code).toContain('registerServerFunction("/rpc/save_');
  });
});

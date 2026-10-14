import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { serviceWorkerSource } from '../src/service-worker';

function harness(development: boolean, onDemand = false) {
  const listeners = new Map<string, (event: any) => void>();
  const entries = new Map<string, Map<string, Response>>([
    ['forma-dev', new Map()], ['forma-old', new Map()], ['other-app', new Map()],
  ]);
  let content = 'before-change';
  const fetch = vi.fn(async () => new Response(content, { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' } }));
  const put = vi.fn(async (cache: Map<string, Response>, request: Request, response: Response) => { cache.set(new URL(request.url).pathname, response); });
  const pendingWrites: Promise<unknown>[] = [];
  const storage = {
    keys: async () => [...entries.keys()],
    delete: async (name: string) => entries.delete(name),
    open: vi.fn(async (name: string) => {
      if (!entries.has(name)) entries.set(name, new Map());
      const cache = entries.get(name)!;
      return {
        addAll: async (urls: string[]) => {
          for (const url of urls) cache.set(url, await fetch());
        },
        match: async (request: Request) => cache.get(new URL(request.url).pathname)?.clone(),
        put: (request: Request, response: Response) => put(cache, request, response),
      };
    }),
  };
  const self = {
    location: { origin: 'https://forma.test' },
    addEventListener: (type: string, callback: (event: any) => void) => { listeners.set(type, callback); },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  runInNewContext(serviceWorkerSource('forma-new', ['/_assets/app.hash.css'], development, onDemand ? ['/_assets/app.hash.js', '/_assets/later.hash.js'] : undefined), {
    self, caches: storage, fetch, URL, Headers, Response,
  });
  return {
    entries, fetch, storage, self, put,
    settleWrites: async () => { await Promise.all(pendingWrites.splice(0)); },
    change: () => { content = 'after-change'; },
    lifecycle: async (type: 'install' | 'activate') => {
      let pending: Promise<unknown> | undefined;
      listeners.get(type)!({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
      await pending;
    },
    request: (path: string, method = 'GET', options: RequestInit = {}) => {
      let response: Promise<Response> | undefined;
      listeners.get('fetch')!({
        request: new Request(new URL(path, self.location.origin), { method, ...options }),
        respondWith: (value: Promise<Response>) => { response = value; },
        waitUntil: (promise: Promise<unknown>) => { pendingWrites.push(promise); },
      });
      return response;
    },
  };
}

describe('generated service workers', () => {
  it('on-demand installation fetches nothing and only retains requested immutable manifest assets', async () => {
    const worker = harness(false, true);
    await worker.lifecycle('install'); await worker.lifecycle('activate');
    expect(worker.fetch).not.toHaveBeenCalled(); expect(worker.storage.open).not.toHaveBeenCalled();
    expect([...worker.entries.keys()]).toEqual(['other-app']);
    expect(await (await worker.request('/_assets/app.hash.js'))!.text()).toBe('before-change');
    await worker.settleWrites(); worker.change();
    expect(await (await worker.request('/_assets/app.hash.js'))!.text()).toBe('before-change');
    expect(worker.fetch).toHaveBeenCalledOnce();
    expect(worker.entries.get('forma-new')?.has('/_assets/later.hash.js')).toBe(false);
  });

  it('on-demand never intercepts private pages/APIs, writes, unlisted assets, queries or cache bypass requests', () => {
    const worker = harness(false, true);
    for (const path of ['/household', '/', '/api/v1/household/state', '/api/v1/vault', '/_assets/unknown.hash.js', '/_assets/app.hash.js?secret=value', 'https://other.test/_assets/app.hash.js']) {
      expect(worker.request(path), path).toBeUndefined();
    }
    expect(worker.request('/_assets/app.hash.js', 'POST')).toBeUndefined();
    for (const cache of ['no-store', 'reload'] as const) expect(worker.request('/_assets/app.hash.js', 'GET', { cache })).toBeUndefined();
    expect(worker.fetch).not.toHaveBeenCalled(); expect(worker.storage.open).not.toHaveBeenCalled();
  });

  it.each([
    { 'Content-Type': 'text/html', 'Cache-Control': 'public, immutable' },
    { 'Content-Type': 'application/json', 'Cache-Control': 'public, immutable' },
    { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store, immutable' },
    { 'Content-Type': 'application/javascript', 'Cache-Control': 'private, immutable' },
    { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' },
  ])('on-demand refuses to persist private/HTML/API or mutable responses: %j', async headers => {
    const worker = harness(false, true); worker.fetch.mockResolvedValueOnce(new Response('not cacheable', { headers }));
    expect(await (await worker.request('/_assets/app.hash.js'))!.text()).toBe('not cacheable');
    await worker.settleWrites(); expect(worker.put).not.toHaveBeenCalled();
  });

  it('on-demand cache and quota failures cannot turn successful network assets into broken pages', async () => {
    const worker = harness(false, true);
    worker.storage.open.mockRejectedValueOnce(new Error('CacheStorage disabled'));
    expect(await (await worker.request('/_assets/app.hash.js'))!.text()).toBe('before-change');
    worker.put.mockRejectedValueOnce(new Error('QuotaExceededError'));
    expect(await (await worker.request('/_assets/later.hash.js'))!.text()).toBe('before-change');
    await expect(worker.settleWrites()).resolves.toBeUndefined(); expect(worker.fetch).toHaveBeenCalledTimes(2);
  });

  it('development immediately takes control and retires only Forma caches', async () => {
    const worker = harness(true);
    await worker.lifecycle('install');
    await worker.lifecycle('activate');
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
    expect(worker.self.clients.claim).toHaveBeenCalledOnce();
    expect([...worker.entries.keys()]).toEqual(['other-app']);
    expect(worker.storage.open).not.toHaveBeenCalled();
  });

  it('development reloads get new CSS and JS bytes without either cache', async () => {
    const worker = harness(true);
    for (const path of ['/_assets/app.js', '/_assets/app.css']) {
      expect(await (await worker.request(path))!.text()).toBe('before-change');
    }
    worker.change();
    for (const path of ['/_assets/app.js', '/_assets/app.css']) {
      const response = (await worker.request(path))!;
      expect(await response.text()).toBe('after-change');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(worker.fetch).toHaveBeenCalledTimes(4);
    for (const call of worker.fetch.mock.calls as unknown[][]) expect(call[1]).toEqual({ cache: 'no-store' });
    expect(worker.storage.open).not.toHaveBeenCalled();
  });

  it('does not hide a development network failure behind stale cached assets', async () => {
    const worker = harness(true);
    worker.fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(worker.request('/_assets/app.js')).rejects.toThrow('offline');
  });

  it('production keeps hashed-asset cache-first behavior scoped to its own cache', async () => {
    const worker = harness(false);
    worker.entries.get('other-app')!.set('/_assets/app.hash.js', new Response('unrelated-cache'));
    await worker.lifecycle('install');
    await worker.lifecycle('activate');
    expect([...worker.entries.keys()].sort()).toEqual(['forma-new', 'other-app']);
    expect(await (await worker.request('/_assets/app.hash.css'))!.text()).toBe('before-change');
    expect(await (await worker.request('/_assets/app.hash.js'))!.text()).toBe('before-change');
    worker.change();
    expect(await (await worker.request('/_assets/app.hash.js'))!.text()).toBe('before-change');
    expect(worker.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('does not intercept cross-origin, API, or non-GET requests (dev=%s)', (development) => {
    const worker = harness(development);
    expect(worker.request('https://other.test/_assets/app.js')).toBeUndefined();
    expect(worker.request('/api/v1/vault')).toBeUndefined();
    expect(worker.request('/_assets/app.js', 'POST')).toBeUndefined();
    expect(worker.fetch).not.toHaveBeenCalled();
  });
});

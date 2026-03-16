"use strict";
var FormaJS = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var src_exports = {};
  __export(src_exports, {
    $: () => $,
    $$: () => $$,
    Fragment: () => Fragment,
    activateIslands: () => activateIslands,
    addClass: () => addClass,
    batch: () => batch,
    children: () => children,
    cleanup: () => cleanup,
    closest: () => closest,
    createBus: () => createBus,
    createComputed: () => createComputed,
    createContext: () => createContext,
    createEffect: () => createEffect,
    createErrorBoundary: () => createErrorBoundary,
    createHistory: () => createHistory,
    createList: () => createList,
    createMemo: () => createMemo,
    createPortal: () => createPortal,
    createReducer: () => createReducer,
    createRef: () => createRef,
    createResource: () => createResource,
    createRoot: () => createRoot,
    createShow: () => createShow,
    createSignal: () => createSignal,
    createStore: () => createStore,
    createSuspense: () => createSuspense,
    createSwitch: () => createSwitch,
    createText: () => createText,
    deactivateAllIslands: () => deactivateAllIslands,
    deactivateIsland: () => deactivateIsland,
    defineComponent: () => defineComponent,
    delegate: () => delegate,
    disposeComponent: () => disposeComponent,
    fragment: () => fragment,
    getBatchDepth: () => getBatchDepth,
    h: () => h,
    hydrateIsland: () => hydrateIsland,
    inject: () => inject,
    isComputed: () => isComputed,
    isEffect: () => isEffect,
    isEffectScope: () => isEffectScope,
    isSignal: () => isSignal,
    mount: () => mount,
    nextSibling: () => nextSibling,
    on: () => on,
    onCleanup: () => onCleanup,
    onError: () => onError,
    onIntersect: () => onIntersect,
    onKey: () => onKey,
    onMount: () => onMount,
    onMutation: () => onMutation,
    onResize: () => onResize,
    onUnmount: () => onUnmount,
    parent: () => parent,
    persist: () => persist,
    prevSibling: () => prevSibling,
    provide: () => provide,
    reconcileList: () => reconcileList,
    removeClass: () => removeClass,
    setAttr: () => setAttr,
    setHTMLUnsafe: () => setHTMLUnsafe,
    setStyle: () => setStyle,
    setText: () => setText,
    siblings: () => siblings,
    template: () => template,
    templateMany: () => templateMany,
    toggleClass: () => toggleClass,
    trackDisposer: () => trackDisposer,
    trigger: () => trigger,
    unprovide: () => unprovide,
    untrack: () => untrack
  });

  // node_modules/alien-signals/esm/system.mjs
  function createReactiveSystem({ update, notify, unwatched }) {
    return {
      link: link2,
      unlink: unlink2,
      propagate: propagate2,
      checkDirty: checkDirty2,
      shallowPropagate: shallowPropagate2
    };
    function link2(dep, sub, version) {
      const prevDep = sub.depsTail;
      if (prevDep !== void 0 && prevDep.dep === dep) {
        return;
      }
      const nextDep = prevDep !== void 0 ? prevDep.nextDep : sub.deps;
      if (nextDep !== void 0 && nextDep.dep === dep) {
        nextDep.version = version;
        sub.depsTail = nextDep;
        return;
      }
      const prevSub = dep.subsTail;
      if (prevSub !== void 0 && prevSub.version === version && prevSub.sub === sub) {
        return;
      }
      const newLink = sub.depsTail = dep.subsTail = {
        version,
        dep,
        sub,
        prevDep,
        nextDep,
        prevSub,
        nextSub: void 0
      };
      if (nextDep !== void 0) {
        nextDep.prevDep = newLink;
      }
      if (prevDep !== void 0) {
        prevDep.nextDep = newLink;
      } else {
        sub.deps = newLink;
      }
      if (prevSub !== void 0) {
        prevSub.nextSub = newLink;
      } else {
        dep.subs = newLink;
      }
    }
    function unlink2(link3, sub = link3.sub) {
      const dep = link3.dep;
      const prevDep = link3.prevDep;
      const nextDep = link3.nextDep;
      const nextSub = link3.nextSub;
      const prevSub = link3.prevSub;
      if (nextDep !== void 0) {
        nextDep.prevDep = prevDep;
      } else {
        sub.depsTail = prevDep;
      }
      if (prevDep !== void 0) {
        prevDep.nextDep = nextDep;
      } else {
        sub.deps = nextDep;
      }
      if (nextSub !== void 0) {
        nextSub.prevSub = prevSub;
      } else {
        dep.subsTail = prevSub;
      }
      if (prevSub !== void 0) {
        prevSub.nextSub = nextSub;
      } else if ((dep.subs = nextSub) === void 0) {
        unwatched(dep);
      }
      return nextDep;
    }
    function propagate2(link3) {
      let next = link3.nextSub;
      let stack;
      top: do {
        const sub = link3.sub;
        let flags = sub.flags;
        if (!(flags & (4 | 8 | 16 | 32))) {
          sub.flags = flags | 32;
        } else if (!(flags & (4 | 8))) {
          flags = 0;
        } else if (!(flags & 4)) {
          sub.flags = flags & ~8 | 32;
        } else if (!(flags & (16 | 32)) && isValidLink(link3, sub)) {
          sub.flags = flags | (8 | 32);
          flags &= 1;
        } else {
          flags = 0;
        }
        if (flags & 2) {
          notify(sub);
        }
        if (flags & 1) {
          const subSubs = sub.subs;
          if (subSubs !== void 0) {
            const nextSub = (link3 = subSubs).nextSub;
            if (nextSub !== void 0) {
              stack = { value: next, prev: stack };
              next = nextSub;
            }
            continue;
          }
        }
        if ((link3 = next) !== void 0) {
          next = link3.nextSub;
          continue;
        }
        while (stack !== void 0) {
          link3 = stack.value;
          stack = stack.prev;
          if (link3 !== void 0) {
            next = link3.nextSub;
            continue top;
          }
        }
        break;
      } while (true);
    }
    function checkDirty2(link3, sub) {
      let stack;
      let checkDepth = 0;
      let dirty = false;
      top: do {
        const dep = link3.dep;
        const flags = dep.flags;
        if (sub.flags & 16) {
          dirty = true;
        } else if ((flags & (1 | 16)) === (1 | 16)) {
          if (update(dep)) {
            const subs = dep.subs;
            if (subs.nextSub !== void 0) {
              shallowPropagate2(subs);
            }
            dirty = true;
          }
        } else if ((flags & (1 | 32)) === (1 | 32)) {
          if (link3.nextSub !== void 0 || link3.prevSub !== void 0) {
            stack = { value: link3, prev: stack };
          }
          link3 = dep.deps;
          sub = dep;
          ++checkDepth;
          continue;
        }
        if (!dirty) {
          const nextDep = link3.nextDep;
          if (nextDep !== void 0) {
            link3 = nextDep;
            continue;
          }
        }
        while (checkDepth--) {
          const firstSub = sub.subs;
          const hasMultipleSubs = firstSub.nextSub !== void 0;
          if (hasMultipleSubs) {
            link3 = stack.value;
            stack = stack.prev;
          } else {
            link3 = firstSub;
          }
          if (dirty) {
            if (update(sub)) {
              if (hasMultipleSubs) {
                shallowPropagate2(firstSub);
              }
              sub = link3.sub;
              continue;
            }
            dirty = false;
          } else {
            sub.flags &= ~32;
          }
          sub = link3.sub;
          const nextDep = link3.nextDep;
          if (nextDep !== void 0) {
            link3 = nextDep;
            continue top;
          }
        }
        return dirty;
      } while (true);
    }
    function shallowPropagate2(link3) {
      do {
        const sub = link3.sub;
        const flags = sub.flags;
        if ((flags & (32 | 16)) === 32) {
          sub.flags = flags | 16;
          if ((flags & (2 | 4)) === 2) {
            notify(sub);
          }
        }
      } while ((link3 = link3.nextSub) !== void 0);
    }
    function isValidLink(checkLink, sub) {
      let link3 = sub.depsTail;
      while (link3 !== void 0) {
        if (link3 === checkLink) {
          return true;
        }
        link3 = link3.prevDep;
      }
      return false;
    }
  }

  // node_modules/alien-signals/esm/index.mjs
  var cycle = 0;
  var batchDepth = 0;
  var notifyIndex = 0;
  var queuedLength = 0;
  var activeSub;
  var queued = [];
  var { link, unlink, propagate, checkDirty, shallowPropagate } = createReactiveSystem({
    update(node) {
      if (node.depsTail !== void 0) {
        return updateComputed(node);
      } else {
        return updateSignal(node);
      }
    },
    notify(effect2) {
      let insertIndex = queuedLength;
      let firstInsertedIndex = insertIndex;
      do {
        queued[insertIndex++] = effect2;
        effect2.flags &= ~2;
        effect2 = effect2.subs?.sub;
        if (effect2 === void 0 || !(effect2.flags & 2)) {
          break;
        }
      } while (true);
      queuedLength = insertIndex;
      while (firstInsertedIndex < --insertIndex) {
        const left = queued[firstInsertedIndex];
        queued[firstInsertedIndex++] = queued[insertIndex];
        queued[insertIndex] = left;
      }
    },
    unwatched(node) {
      if (!(node.flags & 1)) {
        effectScopeOper.call(node);
      } else if (node.depsTail !== void 0) {
        node.depsTail = void 0;
        node.flags = 1 | 16;
        purgeDeps(node);
      }
    }
  });
  function setActiveSub(sub) {
    const prevSub = activeSub;
    activeSub = sub;
    return prevSub;
  }
  function getBatchDepth() {
    return batchDepth;
  }
  function startBatch() {
    ++batchDepth;
  }
  function endBatch() {
    if (!--batchDepth) {
      flush();
    }
  }
  function isSignal(fn) {
    return fn.name === "bound " + signalOper.name;
  }
  function isComputed(fn) {
    return fn.name === "bound " + computedOper.name;
  }
  function isEffect(fn) {
    return fn.name === "bound " + effectOper.name;
  }
  function isEffectScope(fn) {
    return fn.name === "bound " + effectScopeOper.name;
  }
  function signal(initialValue) {
    return signalOper.bind({
      currentValue: initialValue,
      pendingValue: initialValue,
      subs: void 0,
      subsTail: void 0,
      flags: 1
    });
  }
  function computed(getter) {
    return computedOper.bind({
      value: void 0,
      subs: void 0,
      subsTail: void 0,
      deps: void 0,
      depsTail: void 0,
      flags: 0,
      getter
    });
  }
  function effect(fn) {
    const e = {
      fn,
      subs: void 0,
      subsTail: void 0,
      deps: void 0,
      depsTail: void 0,
      flags: 2 | 4
    };
    const prevSub = setActiveSub(e);
    if (prevSub !== void 0) {
      link(e, prevSub, 0);
    }
    try {
      e.fn();
    } finally {
      activeSub = prevSub;
      e.flags &= ~4;
    }
    return effectOper.bind(e);
  }
  function effectScope(fn) {
    const e = {
      deps: void 0,
      depsTail: void 0,
      subs: void 0,
      subsTail: void 0,
      flags: 0
    };
    const prevSub = setActiveSub(e);
    if (prevSub !== void 0) {
      link(e, prevSub, 0);
    }
    try {
      fn();
    } finally {
      activeSub = prevSub;
    }
    return effectScopeOper.bind(e);
  }
  function trigger(fn) {
    const sub = {
      deps: void 0,
      depsTail: void 0,
      flags: 2
    };
    const prevSub = setActiveSub(sub);
    try {
      fn();
    } finally {
      activeSub = prevSub;
      let link2 = sub.deps;
      while (link2 !== void 0) {
        const dep = link2.dep;
        link2 = unlink(link2, sub);
        const subs = dep.subs;
        if (subs !== void 0) {
          sub.flags = 0;
          propagate(subs);
          shallowPropagate(subs);
        }
      }
      if (!batchDepth) {
        flush();
      }
    }
  }
  function updateComputed(c) {
    ++cycle;
    c.depsTail = void 0;
    c.flags = 1 | 4;
    const prevSub = setActiveSub(c);
    try {
      const oldValue = c.value;
      return oldValue !== (c.value = c.getter(oldValue));
    } finally {
      activeSub = prevSub;
      c.flags &= ~4;
      purgeDeps(c);
    }
  }
  function updateSignal(s) {
    s.flags = 1;
    return s.currentValue !== (s.currentValue = s.pendingValue);
  }
  function run(e) {
    const flags = e.flags;
    if (flags & 16 || flags & 32 && checkDirty(e.deps, e)) {
      ++cycle;
      e.depsTail = void 0;
      e.flags = 2 | 4;
      const prevSub = setActiveSub(e);
      try {
        e.fn();
      } finally {
        activeSub = prevSub;
        e.flags &= ~4;
        purgeDeps(e);
      }
    } else {
      e.flags = 2;
    }
  }
  function flush() {
    try {
      while (notifyIndex < queuedLength) {
        const effect2 = queued[notifyIndex];
        queued[notifyIndex++] = void 0;
        run(effect2);
      }
    } finally {
      while (notifyIndex < queuedLength) {
        const effect2 = queued[notifyIndex];
        queued[notifyIndex++] = void 0;
        effect2.flags |= 2 | 8;
      }
      notifyIndex = 0;
      queuedLength = 0;
    }
  }
  function computedOper() {
    const flags = this.flags;
    if (flags & 16 || flags & 32 && (checkDirty(this.deps, this) || (this.flags = flags & ~32, false))) {
      if (updateComputed(this)) {
        const subs = this.subs;
        if (subs !== void 0) {
          shallowPropagate(subs);
        }
      }
    } else if (!flags) {
      this.flags = 1 | 4;
      const prevSub = setActiveSub(this);
      try {
        this.value = this.getter();
      } finally {
        activeSub = prevSub;
        this.flags &= ~4;
      }
    }
    const sub = activeSub;
    if (sub !== void 0) {
      link(this, sub, cycle);
    }
    return this.value;
  }
  function signalOper(...value2) {
    if (value2.length) {
      if (this.pendingValue !== (this.pendingValue = value2[0])) {
        this.flags = 1 | 16;
        const subs = this.subs;
        if (subs !== void 0) {
          propagate(subs);
          if (!batchDepth) {
            flush();
          }
        }
      }
    } else {
      if (this.flags & 16) {
        if (updateSignal(this)) {
          const subs = this.subs;
          if (subs !== void 0) {
            shallowPropagate(subs);
          }
        }
      }
      let sub = activeSub;
      while (sub !== void 0) {
        if (sub.flags & (1 | 2)) {
          link(this, sub, cycle);
          break;
        }
        sub = sub.subs?.sub;
      }
      return this.currentValue;
    }
  }
  function effectOper() {
    effectScopeOper.call(this);
  }
  function effectScopeOper() {
    this.depsTail = void 0;
    this.flags = 0;
    purgeDeps(this);
    const sub = this.subs;
    if (sub !== void 0) {
      unlink(sub);
    }
  }
  function purgeDeps(sub) {
    const depsTail = sub.depsTail;
    let dep = depsTail !== void 0 ? depsTail.nextDep : sub.deps;
    while (dep !== void 0) {
      dep = unlink(dep, sub);
    }
  }

  // src/reactive/signal.ts
  function applySignalSet(s, v, equals) {
    if (typeof v !== "function") {
      if (equals) {
        const prevSub2 = setActiveSub(void 0);
        const prev2 = s();
        setActiveSub(prevSub2);
        if (equals(prev2, v)) return;
      }
      s(v);
      return;
    }
    const prevSub = setActiveSub(void 0);
    const prev = s();
    setActiveSub(prevSub);
    const next = v(prev);
    if (equals && equals(prev, next)) return;
    s(next);
  }
  function createSignal(initialValue, options) {
    const s = signal(initialValue);
    const getter = s;
    const eq = options?.equals;
    const setter = (v) => applySignalSet(s, v, eq);
    return [getter, setter];
  }

  // src/reactive/root.ts
  var currentRoot = null;
  var rootStack = [];
  function createRoot(fn) {
    const scope = { disposers: [], scopeDispose: null };
    rootStack.push(currentRoot);
    currentRoot = scope;
    const dispose = () => {
      if (scope.scopeDispose) {
        try {
          scope.scopeDispose();
        } catch {
        }
        scope.scopeDispose = null;
      }
      for (const d of scope.disposers) {
        try {
          d();
        } catch {
        }
      }
      scope.disposers.length = 0;
    };
    let result;
    try {
      scope.scopeDispose = effectScope(() => {
        result = fn(dispose);
      });
    } finally {
      currentRoot = rootStack.pop() ?? null;
    }
    return result;
  }
  function registerDisposer(dispose) {
    if (currentRoot) {
      currentRoot.disposers.push(dispose);
    }
  }
  function hasActiveRoot() {
    return currentRoot !== null;
  }

  // src/reactive/cleanup.ts
  var currentCleanupCollector = null;
  function onCleanup(fn) {
    currentCleanupCollector?.(fn);
  }
  function setCleanupCollector(collector) {
    const prev = currentCleanupCollector;
    currentCleanupCollector = collector;
    return prev;
  }

  // src/reactive/dev.ts
  var __DEV__ = typeof process !== "undefined" ? process.env?.NODE_ENV !== "production" : true;
  var _errorHandler = null;
  function onError(handler) {
    _errorHandler = handler;
  }
  function reportError(error, source) {
    if (_errorHandler) {
      try {
        _errorHandler(error, source ? { source } : {});
      } catch {
      }
    }
    if (__DEV__) {
      console.error(`[forma] ${source ?? "Unknown"} error:`, error);
    }
  }

  // src/reactive/effect.ts
  var POOL_SIZE = 32;
  var MAX_REENTRANT_RUNS = 100;
  var pool = [];
  for (let i = 0; i < POOL_SIZE; i++) pool.push([]);
  var poolIdx = POOL_SIZE;
  function acquireArray() {
    if (poolIdx > 0) {
      const arr = pool[--poolIdx];
      arr.length = 0;
      return arr;
    }
    return [];
  }
  function releaseArray(arr) {
    arr.length = 0;
    if (poolIdx < POOL_SIZE) {
      pool[poolIdx++] = arr;
    }
  }
  function runCleanup(fn) {
    if (fn === void 0) return;
    try {
      fn();
    } catch (e) {
      reportError(e, "effect cleanup");
    }
  }
  function runCleanups(bag) {
    if (bag === void 0) return;
    for (let i = 0; i < bag.length; i++) {
      try {
        bag[i]();
      } catch (e) {
        reportError(e, "effect cleanup");
      }
    }
  }
  function internalEffect(fn) {
    const dispose = effect(fn);
    if (hasActiveRoot()) {
      registerDisposer(dispose);
    }
    return dispose;
  }
  function createEffect(fn) {
    const shouldRegister = hasActiveRoot();
    let cleanup2;
    let cleanupBag;
    let nextCleanup;
    let nextCleanupBag;
    const addCleanup = (cb) => {
      if (nextCleanupBag !== void 0) {
        nextCleanupBag.push(cb);
        return;
      }
      if (nextCleanup !== void 0) {
        const bag = acquireArray();
        bag.push(nextCleanup, cb);
        nextCleanup = void 0;
        nextCleanupBag = bag;
        return;
      }
      nextCleanup = cb;
    };
    let skipCleanupInfra = false;
    let firstRun = true;
    let running = false;
    let rerunRequested = false;
    const runOnce = () => {
      if (cleanup2 !== void 0) {
        runCleanup(cleanup2);
        cleanup2 = void 0;
      }
      if (cleanupBag !== void 0) {
        runCleanups(cleanupBag);
        releaseArray(cleanupBag);
        cleanupBag = void 0;
      }
      if (skipCleanupInfra) {
        try {
          fn();
        } catch (e) {
          reportError(e, "effect");
        }
        return;
      }
      nextCleanup = void 0;
      nextCleanupBag = void 0;
      const prevCollector = setCleanupCollector(addCleanup);
      try {
        const result = fn();
        if (typeof result === "function") {
          addCleanup(result);
        }
        if (nextCleanup === void 0 && nextCleanupBag === void 0) {
          if (firstRun) skipCleanupInfra = true;
          return;
        }
        if (nextCleanupBag !== void 0) {
          cleanupBag = nextCleanupBag;
        } else {
          cleanup2 = nextCleanup;
        }
      } catch (e) {
        reportError(e, "effect");
        if (nextCleanupBag !== void 0) {
          cleanupBag = nextCleanupBag;
        } else {
          cleanup2 = nextCleanup;
        }
      } finally {
        setCleanupCollector(prevCollector);
        firstRun = false;
      }
    };
    const safeFn = () => {
      if (running) {
        rerunRequested = true;
        return;
      }
      running = true;
      try {
        let reentrantRuns = 0;
        do {
          rerunRequested = false;
          runOnce();
          if (rerunRequested) {
            reentrantRuns++;
            if (reentrantRuns >= MAX_REENTRANT_RUNS) {
              reportError(
                new Error(`createEffect exceeded ${MAX_REENTRANT_RUNS} re-entrant runs`),
                "effect"
              );
              rerunRequested = false;
            }
          }
        } while (rerunRequested);
      } finally {
        running = false;
      }
    };
    const dispose = effect(safeFn);
    let disposed = false;
    const wrappedDispose = () => {
      if (disposed) return;
      disposed = true;
      dispose();
      if (cleanup2 !== void 0) {
        runCleanup(cleanup2);
        cleanup2 = void 0;
      }
      if (cleanupBag !== void 0) {
        runCleanups(cleanupBag);
        releaseArray(cleanupBag);
        cleanupBag = void 0;
      }
    };
    if (shouldRegister) {
      registerDisposer(wrappedDispose);
    }
    return wrappedDispose;
  }

  // src/reactive/computed.ts
  function createComputed(fn) {
    return computed(fn);
  }

  // src/reactive/memo.ts
  var createMemo = createComputed;

  // src/reactive/batch.ts
  function batch(fn) {
    startBatch();
    try {
      fn();
    } finally {
      endBatch();
    }
  }

  // src/reactive/untrack.ts
  function untrack(fn) {
    const prev = setActiveSub(void 0);
    try {
      return fn();
    } finally {
      setActiveSub(prev);
    }
  }

  // src/reactive/on.ts
  function on(deps, fn, options) {
    let prev;
    let isFirst = true;
    return () => {
      const value2 = deps();
      if (options?.defer && isFirst) {
        isFirst = false;
        prev = value2;
        return void 0;
      }
      const result = untrack(() => fn(value2, prev));
      prev = value2;
      return result;
    };
  }

  // src/reactive/ref.ts
  function createRef(initialValue) {
    return { current: initialValue };
  }

  // src/reactive/reducer.ts
  function createReducer(reducer, initialState) {
    const [state, setState] = createSignal(initialState);
    const dispatch = (action) => {
      setState((prev) => reducer(prev, action));
    };
    return [state, dispatch];
  }

  // src/reactive/suspense-context.ts
  var currentSuspenseContext = null;
  var suspenseStack = [];
  function pushSuspenseContext(ctx) {
    suspenseStack.push(currentSuspenseContext);
    currentSuspenseContext = ctx;
  }
  function popSuspenseContext() {
    currentSuspenseContext = suspenseStack.pop() ?? null;
  }
  function getSuspenseContext() {
    return currentSuspenseContext;
  }

  // src/reactive/resource.ts
  function createResource(source, fetcher, options) {
    const [data, setData] = createSignal(options?.initialValue);
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal(void 0);
    const suspenseCtx = getSuspenseContext();
    let abortController = null;
    let fetchVersion = 0;
    const doFetch = () => {
      const sourceValue = untrack(source);
      if (abortController) {
        abortController.abort();
      }
      const controller = new AbortController();
      abortController = controller;
      const version = ++fetchVersion;
      const isLatest = () => version === fetchVersion;
      let suspensePending = false;
      if (suspenseCtx) {
        suspenseCtx.increment();
        suspensePending = true;
      }
      setLoading(true);
      setError(void 0);
      Promise.resolve(fetcher(sourceValue)).then((result) => {
        if (isLatest() && !controller.signal.aborted) {
          setData(() => result);
        }
      }).catch((err) => {
        if (isLatest() && !controller.signal.aborted) {
          if (err?.name !== "AbortError") {
            setError(err);
          }
        }
      }).finally(() => {
        if (suspensePending) suspenseCtx?.decrement();
        if (isLatest()) {
          setLoading(false);
          if (abortController === controller) {
            abortController = null;
          }
        }
      });
    };
    internalEffect(() => {
      source();
      doFetch();
    });
    const resource = (() => data());
    resource.loading = loading;
    resource.error = error;
    resource.refetch = doFetch;
    resource.mutate = (value2) => setData(() => value2);
    return resource;
  }

  // src/dom/list.ts
  function longestIncreasingSubsequence(arr) {
    const n = arr.length;
    if (n === 0) return [];
    const tails = new Int32Array(n);
    const tailIndices = new Int32Array(n);
    const predecessor = new Int32Array(n).fill(-1);
    let tailsLen = 0;
    for (let i = 0; i < n; i++) {
      const val = arr[i];
      let lo = 0, hi = tailsLen;
      while (lo < hi) {
        const mid = lo + hi >> 1;
        if (tails[mid] < val) lo = mid + 1;
        else hi = mid;
      }
      tails[lo] = val;
      tailIndices[lo] = i;
      if (lo > 0) predecessor[i] = tailIndices[lo - 1];
      if (lo >= tailsLen) tailsLen++;
    }
    const result = new Array(tailsLen);
    let idx = tailIndices[tailsLen - 1];
    for (let i = tailsLen - 1; i >= 0; i--) {
      result[i] = idx;
      idx = predecessor[idx];
    }
    return result;
  }
  var SMALL_LIST_THRESHOLD = 32;
  var ABORT_SYM = /* @__PURE__ */ Symbol.for("forma-abort");
  var CACHE_SYM = /* @__PURE__ */ Symbol.for("forma-attr-cache");
  var DYNAMIC_CHILD_SYM = /* @__PURE__ */ Symbol.for("forma-dynamic-child");
  function canPatchStaticElement(target, source) {
    return target instanceof HTMLElement && source instanceof HTMLElement && target.tagName === source.tagName && !target[ABORT_SYM] && !target[CACHE_SYM] && !target[DYNAMIC_CHILD_SYM] && !source[ABORT_SYM] && !source[CACHE_SYM] && !source[DYNAMIC_CHILD_SYM];
  }
  function patchStaticElement(target, source) {
    const sourceAttrNames = /* @__PURE__ */ new Set();
    for (const attr of Array.from(source.attributes)) {
      sourceAttrNames.add(attr.name);
      if (target.getAttribute(attr.name) !== attr.value) {
        target.setAttribute(attr.name, attr.value);
      }
    }
    for (const attr of Array.from(target.attributes)) {
      if (!sourceAttrNames.has(attr.name)) {
        target.removeAttribute(attr.name);
      }
    }
    target.replaceChildren(...Array.from(source.childNodes));
  }
  function reconcileSmall(parent2, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks) {
    const oldLen = oldItems.length;
    const newLen = newItems.length;
    const oldKeys = new Array(oldLen);
    for (let i = 0; i < oldLen; i++) {
      oldKeys[i] = keyFn(oldItems[i]);
    }
    const oldIndices = new Array(newLen);
    const oldUsed = new Uint8Array(oldLen);
    for (let i = 0; i < newLen; i++) {
      const key = keyFn(newItems[i]);
      let found = -1;
      for (let j = 0; j < oldLen; j++) {
        if (!oldUsed[j] && oldKeys[j] === key) {
          found = j;
          oldUsed[j] = 1;
          break;
        }
      }
      oldIndices[i] = found;
    }
    for (let i = 0; i < oldLen; i++) {
      if (!oldUsed[i]) {
        if (hooks?.onBeforeRemove) {
          const node = oldNodes[i];
          hooks.onBeforeRemove(node, () => {
            if (node.parentNode) node.parentNode.removeChild(node);
          });
        } else {
          parent2.removeChild(oldNodes[i]);
        }
      }
    }
    if (oldLen === newLen) {
      let allSameOrder = true;
      for (let i = 0; i < newLen; i++) {
        if (oldIndices[i] !== i) {
          allSameOrder = false;
          break;
        }
      }
      if (allSameOrder) {
        const nodes = new Array(newLen);
        for (let i = 0; i < newLen; i++) {
          const node = oldNodes[i];
          updateFn(node, newItems[i]);
          nodes[i] = node;
        }
        return { nodes, items: newItems };
      }
    }
    const reusedIndices = [];
    const reusedPositions = [];
    for (let i = 0; i < newLen; i++) {
      if (oldIndices[i] !== -1) {
        reusedIndices.push(oldIndices[i]);
        reusedPositions.push(i);
      }
    }
    const lisOfReused = longestIncreasingSubsequence(reusedIndices);
    const lisFlags = new Uint8Array(newLen);
    for (const li of lisOfReused) {
      lisFlags[reusedPositions[li]] = 1;
    }
    const newNodes = new Array(newLen);
    let nextSibling2 = beforeNode ?? null;
    for (let i = newLen - 1; i >= 0; i--) {
      let node;
      let isNew = false;
      if (oldIndices[i] === -1) {
        node = createFn(newItems[i]);
        isNew = true;
      } else {
        node = oldNodes[oldIndices[i]];
        updateFn(node, newItems[i]);
        if (lisFlags[i]) {
          newNodes[i] = node;
          nextSibling2 = node;
          continue;
        }
      }
      if (nextSibling2) {
        parent2.insertBefore(node, nextSibling2);
      } else {
        parent2.appendChild(node);
      }
      if (isNew) hooks?.onInsert?.(node);
      newNodes[i] = node;
      nextSibling2 = node;
    }
    return { nodes: newNodes, items: newItems };
  }
  function reconcileList(parent2, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks) {
    const oldLen = oldItems.length;
    const newLen = newItems.length;
    if (newLen === 0) {
      for (let i = 0; i < oldLen; i++) {
        if (hooks?.onBeforeRemove) {
          const node = oldNodes[i];
          hooks.onBeforeRemove(node, () => {
            if (node.parentNode) node.parentNode.removeChild(node);
          });
        } else {
          parent2.removeChild(oldNodes[i]);
        }
      }
      return { nodes: [], items: [] };
    }
    if (oldLen === 0) {
      const nodes = new Array(newLen);
      for (let i = 0; i < newLen; i++) {
        const node = createFn(newItems[i]);
        if (beforeNode) {
          parent2.insertBefore(node, beforeNode);
        } else {
          parent2.appendChild(node);
        }
        hooks?.onInsert?.(node);
        nodes[i] = node;
      }
      return { nodes, items: newItems };
    }
    if (oldLen < SMALL_LIST_THRESHOLD) {
      return reconcileSmall(parent2, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks);
    }
    const oldKeyMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < oldLen; i++) {
      oldKeyMap.set(keyFn(oldItems[i]), i);
    }
    const oldIndices = new Array(newLen);
    const oldUsed = new Uint8Array(oldLen);
    for (let i = 0; i < newLen; i++) {
      const key = keyFn(newItems[i]);
      const oldIdx = oldKeyMap.get(key);
      if (oldIdx !== void 0) {
        oldIndices[i] = oldIdx;
        oldUsed[oldIdx] = 1;
      } else {
        oldIndices[i] = -1;
      }
    }
    for (let i = 0; i < oldLen; i++) {
      if (!oldUsed[i]) {
        if (hooks?.onBeforeRemove) {
          const node = oldNodes[i];
          hooks.onBeforeRemove(node, () => {
            if (node.parentNode) node.parentNode.removeChild(node);
          });
        } else {
          parent2.removeChild(oldNodes[i]);
        }
      }
    }
    if (oldLen === newLen) {
      let allSameOrder = true;
      for (let i = 0; i < newLen; i++) {
        if (oldIndices[i] !== i) {
          allSameOrder = false;
          break;
        }
      }
      if (allSameOrder) {
        const nodes = new Array(newLen);
        for (let i = 0; i < newLen; i++) {
          const node = oldNodes[i];
          updateFn(node, newItems[i]);
          nodes[i] = node;
        }
        return { nodes, items: newItems };
      }
    }
    const reusedIndices = [];
    const reusedPositions = [];
    for (let i = 0; i < newLen; i++) {
      if (oldIndices[i] !== -1) {
        reusedIndices.push(oldIndices[i]);
        reusedPositions.push(i);
      }
    }
    const lisOfReused = longestIncreasingSubsequence(reusedIndices);
    const lisFlags = new Uint8Array(newLen);
    for (const li of lisOfReused) {
      lisFlags[reusedPositions[li]] = 1;
    }
    const newNodes = new Array(newLen);
    let nextSibling2 = beforeNode ?? null;
    for (let i = newLen - 1; i >= 0; i--) {
      let node;
      let isNew = false;
      if (oldIndices[i] === -1) {
        node = createFn(newItems[i]);
        isNew = true;
      } else {
        node = oldNodes[oldIndices[i]];
        updateFn(node, newItems[i]);
        if (lisFlags[i]) {
          newNodes[i] = node;
          nextSibling2 = node;
          continue;
        }
      }
      if (nextSibling2) {
        parent2.insertBefore(node, nextSibling2);
      } else {
        parent2.appendChild(node);
      }
      if (isNew) hooks?.onInsert?.(node);
      newNodes[i] = node;
      nextSibling2 = node;
    }
    return { nodes: newNodes, items: newItems };
  }
  function createList(items, keyFn, renderFn, options) {
    if (hydrating) {
      return { type: "list", items, keyFn, renderFn, options };
    }
    const startMarker = document.createComment("forma-list-start");
    const endMarker = document.createComment("forma-list-end");
    const fragment2 = document.createDocumentFragment();
    fragment2.appendChild(startMarker);
    fragment2.appendChild(endMarker);
    let cache2 = /* @__PURE__ */ new Map();
    let currentNodes = [];
    let currentItems = [];
    const updateOnItemChange = options?.updateOnItemChange ?? "none";
    internalEffect(() => {
      const newItems = items();
      const parent2 = startMarker.parentNode;
      if (!parent2) {
        return;
      }
      if (!Array.isArray(newItems)) {
        if (__DEV__) {
          console.warn("[forma] createList: value is not an array, treating as empty");
        }
        for (const node of currentNodes) {
          if (node.parentNode === parent2) parent2.removeChild(node);
        }
        cache2 = /* @__PURE__ */ new Map();
        currentNodes = [];
        currentItems = [];
        return;
      }
      let cleanItems = newItems;
      for (let i = 0; i < newItems.length; i++) {
        if (newItems[i] == null) {
          cleanItems = newItems.filter((item) => item != null);
          break;
        }
      }
      if (__DEV__) {
        const seen = /* @__PURE__ */ new Set();
        for (const item of cleanItems) {
          const key = keyFn(item);
          if (seen.has(key)) {
            console.warn("[forma] createList: duplicate key detected:", key);
          }
          seen.add(key);
        }
      }
      const updateRow = updateOnItemChange === "rerender" ? (node, item) => {
        const key = keyFn(item);
        const cached = cache2.get(key);
        if (!cached) return;
        if (cached.item === item) return;
        cached.item = item;
        if (!(node instanceof HTMLElement)) return;
        if (node[ABORT_SYM] || node[CACHE_SYM] || node[DYNAMIC_CHILD_SYM]) {
          return;
        }
        const next = untrack(() => renderFn(item, cached.getIndex));
        if (canPatchStaticElement(node, next)) {
          patchStaticElement(node, next);
          cached.element = node;
        }
      } : (_node, item) => {
        const key = keyFn(item);
        const cached = cache2.get(key);
        if (cached) cached.item = item;
      };
      const result = reconcileList(
        parent2,
        currentItems,
        cleanItems,
        currentNodes,
        keyFn,
        // createFn: create element + cache entry
        (item) => {
          const key = keyFn(item);
          const [getIndex, setIndex] = createSignal(0);
          const element = untrack(() => renderFn(item, getIndex));
          cache2.set(key, { element, item, getIndex, setIndex });
          return element;
        },
        updateRow,
        // beforeNode: insert items before the end marker
        endMarker
      );
      const newCache = /* @__PURE__ */ new Map();
      for (let i = 0; i < cleanItems.length; i++) {
        const key = keyFn(cleanItems[i]);
        const cached = cache2.get(key);
        if (cached) {
          cached.setIndex(i);
          newCache.set(key, cached);
        }
      }
      cache2 = newCache;
      currentNodes = result.nodes;
      currentItems = result.items;
    });
    return fragment2;
  }

  // src/dom/show.ts
  function createShow(when, thenFn, elseFn) {
    if (hydrating) {
      const branch = when() ? thenFn() : elseFn?.() ?? null;
      return {
        type: "show",
        condition: when,
        whenTrue: thenFn,
        whenFalse: elseFn,
        initialBranch: branch
      };
    }
    const startMarker = document.createComment("forma-show");
    const endMarker = document.createComment("/forma-show");
    const fragment2 = document.createDocumentFragment();
    fragment2.appendChild(startMarker);
    fragment2.appendChild(endMarker);
    let currentNode = null;
    let lastTruthy = null;
    let currentDispose = null;
    const showDispose = internalEffect(() => {
      const truthy = !!when();
      const DEBUG = typeof globalThis.__FORMA_DEBUG__ !== "undefined";
      const DEBUG_LABEL = DEBUG ? thenFn.toString().slice(0, 60) : "";
      if (truthy === lastTruthy) {
        if (DEBUG) console.log("[forma:show] skip (same)", truthy, DEBUG_LABEL);
        return;
      }
      if (DEBUG) console.log("[forma:show]", lastTruthy, "\u2192", truthy, DEBUG_LABEL);
      lastTruthy = truthy;
      const parent2 = startMarker.parentNode;
      if (!parent2) {
        if (DEBUG) console.warn("[forma:show] parentNode is null! skipping.", DEBUG_LABEL);
        return;
      }
      if (DEBUG) console.log("[forma:show] parent:", parent2.nodeName, "inDoc:", document.contains(parent2));
      if (currentDispose) {
        currentDispose();
        currentDispose = null;
      }
      if (currentNode) {
        if (currentNode.parentNode === parent2) {
          parent2.removeChild(currentNode);
        } else {
          while (startMarker.nextSibling && startMarker.nextSibling !== endMarker) {
            parent2.removeChild(startMarker.nextSibling);
          }
        }
      }
      const branchFn = truthy ? thenFn : elseFn;
      if (branchFn) {
        let branchDispose;
        currentNode = createRoot((dispose) => {
          branchDispose = dispose;
          return untrack(() => branchFn());
        });
        currentDispose = branchDispose;
      } else {
        currentNode = null;
      }
      if (currentNode) {
        parent2.insertBefore(currentNode, endMarker);
      }
    });
    fragment2.__showDispose = () => {
      showDispose();
      if (currentDispose) {
        currentDispose();
        currentDispose = null;
      }
    };
    return fragment2;
  }

  // src/dom/hydrate.ts
  var ABORT_SYM2 = /* @__PURE__ */ Symbol.for("forma-abort");
  var hydrating = false;
  function setHydrating(value2) {
    hydrating = value2;
  }
  function isDescriptor(v) {
    return v != null && typeof v === "object" && "type" in v && v.type === "element";
  }
  function isShowDescriptor(v) {
    return v != null && typeof v === "object" && "type" in v && v.type === "show";
  }
  function isListDescriptor(v) {
    return v != null && typeof v === "object" && "type" in v && v.type === "list";
  }
  function applyDynamicProps(el, props) {
    if (!props) return;
    for (const key in props) {
      const value2 = props[key];
      if (typeof value2 !== "function") continue;
      if (key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && key.length > 2) {
        let ac = el[ABORT_SYM2];
        if (!ac) {
          ac = new AbortController();
          el[ABORT_SYM2] = ac;
        }
        el.addEventListener(key.slice(2).toLowerCase(), value2, { signal: ac.signal });
        continue;
      }
      const fn = value2;
      const attrKey = key;
      internalEffect(() => {
        const v = fn();
        if (v === false || v == null) {
          el.removeAttribute(attrKey);
        } else if (v === true) {
          el.setAttribute(attrKey, "");
        } else {
          el.setAttribute(attrKey, String(v));
        }
      });
    }
  }
  function ensureNode(value2) {
    if (value2 instanceof Node) return value2;
    if (value2 == null || value2 === false || value2 === true) return null;
    if (typeof value2 === "string") return new Text(value2);
    if (typeof value2 === "number") return new Text(String(value2));
    if (isDescriptor(value2)) return descriptorToElement(value2);
    if (isShowDescriptor(value2)) {
      const prevH = hydrating;
      hydrating = false;
      try {
        return createShow(
          value2.condition,
          () => ensureNode(value2.whenTrue()) ?? document.createComment("empty"),
          value2.whenFalse ? () => ensureNode(value2.whenFalse()) ?? document.createComment("empty") : void 0
        );
      } finally {
        hydrating = prevH;
      }
    }
    if (isListDescriptor(value2)) {
      const prevH = hydrating;
      hydrating = false;
      try {
        return createList(value2.items, value2.keyFn, value2.renderFn, value2.options);
      } finally {
        hydrating = prevH;
      }
    }
    return null;
  }
  function descriptorToElement(desc) {
    const prevHydrating = hydrating;
    hydrating = false;
    try {
      const children2 = desc.children.map((child) => {
        if (isDescriptor(child)) return descriptorToElement(child);
        if (isShowDescriptor(child)) return ensureNode(child);
        if (isListDescriptor(child)) return ensureNode(child);
        return child;
      });
      return h(desc.tag, desc.props, ...children2);
    } finally {
      hydrating = prevHydrating;
    }
  }
  function isIslandStart(data) {
    return data.length >= 4 && data.charCodeAt(0) === 102 && data.charCodeAt(1) === 58 && data.charCodeAt(2) === 105;
  }
  function isShowStart(data) {
    return data.length >= 4 && data.charCodeAt(0) === 102 && data.charCodeAt(1) === 58 && data.charCodeAt(2) === 115;
  }
  function isTextStart(data) {
    return data.length >= 4 && data.charCodeAt(0) === 102 && data.charCodeAt(1) === 58 && data.charCodeAt(2) === 116;
  }
  function isListStart(data) {
    return data.length >= 4 && data.charCodeAt(0) === 102 && data.charCodeAt(1) === 58 && data.charCodeAt(2) === 108;
  }
  function findClosingMarker(start) {
    const closing = "/" + start.data;
    let node = start.nextSibling;
    while (node) {
      if (node.nodeType === 8 && node.data === closing) {
        return node;
      }
      node = node.nextSibling;
    }
    return null;
  }
  function findTextBetween(start, end) {
    let node = start.nextSibling;
    while (node && node !== end) {
      if (node.nodeType === 3) return node;
      node = node.nextSibling;
    }
    return null;
  }
  function nextElementBetweenMarkers(start, end) {
    let node = start.nextSibling;
    while (node && node !== end) {
      if (node.nodeType === 1) return node;
      node = node.nextSibling;
    }
    return void 0;
  }
  function extractContentBetweenMarkers(start, end) {
    const frag = document.createDocumentFragment();
    let node = start.nextSibling;
    while (node && node !== end) {
      const next = node.nextSibling;
      frag.appendChild(node);
      node = next;
    }
    return frag;
  }
  function setupShowEffect(desc, marker) {
    let currentCondition = !!desc.condition();
    let thenFragment = null;
    let elseFragment = null;
    const hasSSRContent = marker.start.nextSibling !== marker.end;
    if (!hasSSRContent && currentCondition) {
      if (__DEV__) console.warn("[forma] Hydration: show condition mismatch \u2014 SSR empty but client condition is true");
      const trueBranch = desc.whenTrue();
      if (trueBranch instanceof Node) {
        marker.start.parentNode.insertBefore(trueBranch, marker.end);
      }
    }
    internalEffect(() => {
      const next = !!desc.condition();
      if (next === currentCondition) return;
      currentCondition = next;
      const parent2 = marker.start.parentNode;
      if (!parent2) return;
      const current = extractContentBetweenMarkers(marker.start, marker.end);
      if (!next) {
        thenFragment = current;
      } else {
        elseFragment = current;
      }
      let branch = next ? thenFragment ?? desc.whenTrue() : desc.whenFalse ? elseFragment ?? desc.whenFalse() : null;
      if (next && thenFragment) thenFragment = null;
      if (!next && elseFragment) elseFragment = null;
      if (branch != null && !(branch instanceof Node)) {
        branch = ensureNode(branch);
      }
      if (branch instanceof Node) {
        parent2.insertBefore(branch, marker.end);
      }
    });
  }
  function adoptBranchContent(desc, regionStart, regionEnd) {
    if (isDescriptor(desc)) {
      const el = nextElementBetweenMarkers(regionStart, regionEnd);
      if (el) adoptNode(desc, el);
    } else if (isShowDescriptor(desc)) {
      let node = regionStart.nextSibling;
      while (node && node !== regionEnd) {
        if (node.nodeType === 8 && isShowStart(node.data)) {
          const innerStart = node;
          const innerEnd = findClosingMarker(innerStart);
          if (innerEnd) {
            if (desc.initialBranch) {
              adoptBranchContent(desc.initialBranch, innerStart, innerEnd);
            }
            setupShowEffect(desc, { start: innerStart, end: innerEnd, cachedContent: null });
          }
          break;
        }
        node = node.nextSibling;
      }
    }
  }
  function adoptNode(desc, ssrEl) {
    if (!ssrEl || ssrEl.tagName !== desc.tag.toUpperCase()) {
      if (__DEV__) console.warn(`Hydration mismatch: expected <${desc.tag}>, got <${ssrEl?.tagName?.toLowerCase() ?? "nothing"}>`);
      const fresh = descriptorToElement(desc);
      if (ssrEl) ssrEl.replaceWith(fresh);
      return;
    }
    applyDynamicProps(ssrEl, desc.props);
    let cursor = ssrEl.firstChild;
    for (const child of desc.children) {
      if (child === false || child == null) continue;
      if (isDescriptor(child)) {
        while (cursor && cursor.nodeType === 3 && !cursor.data.trim()) {
          cursor = cursor.nextSibling;
        }
        while (cursor && cursor.nodeType === 1 && cursor.hasAttribute("data-forma-island")) {
          cursor = cursor.nextSibling;
        }
        if (!cursor) {
          ssrEl.appendChild(descriptorToElement(child));
          continue;
        }
        if (cursor.nodeType === 1) {
          const el = cursor;
          cursor = cursor.nextSibling;
          adoptNode(child, el);
        } else if (cursor.nodeType === 8 && isIslandStart(cursor.data)) {
          const end = findClosingMarker(cursor);
          const fresh = descriptorToElement(child);
          if (end) {
            end.parentNode.insertBefore(fresh, end);
            cursor = end.nextSibling;
          } else {
            ssrEl.appendChild(fresh);
            cursor = null;
          }
        } else {
          ssrEl.appendChild(descriptorToElement(child));
        }
      } else if (isShowDescriptor(child)) {
        while (cursor && !(cursor.nodeType === 8 && isShowStart(cursor.data))) {
          cursor = cursor.nextSibling;
        }
        if (cursor) {
          const start = cursor;
          const end = findClosingMarker(start);
          if (end) {
            if (child.initialBranch) {
              adoptBranchContent(child.initialBranch, start, end);
            }
            setupShowEffect(child, { start, end, cachedContent: null });
            cursor = end.nextSibling;
          }
        }
      } else if (isListDescriptor(child)) {
        while (cursor && !(cursor.nodeType === 8 && isListStart(cursor.data))) {
          cursor = cursor.nextSibling;
        }
        if (cursor) {
          const start = cursor;
          const end = findClosingMarker(start);
          if (end) {
            const ssrKeyMap = /* @__PURE__ */ new Map();
            const ssrElements = [];
            let node = start.nextSibling;
            while (node && node !== end) {
              if (node.nodeType === 1) {
                const el = node;
                ssrElements.push(el);
                const key = el.getAttribute("data-forma-key");
                if (key != null) {
                  ssrKeyMap.set(key, el);
                }
              }
              node = node.nextSibling;
            }
            const currentItems = untrack(() => child.items());
            const listKeyFn = child.keyFn;
            const listRenderFn = child.renderFn;
            const useIndexFallback = ssrKeyMap.size === 0 && ssrElements.length > 0;
            const adoptedNodes = [];
            const adoptedItems = [];
            const usedIndices = /* @__PURE__ */ new Set();
            for (let i = 0; i < currentItems.length; i++) {
              const item = currentItems[i];
              const key = listKeyFn(item);
              let ssrNode;
              if (useIndexFallback) {
                if (i < ssrElements.length) {
                  ssrNode = ssrElements[i];
                  usedIndices.add(i);
                }
              } else {
                ssrNode = ssrKeyMap.get(String(key));
                if (ssrNode) ssrKeyMap.delete(String(key));
              }
              if (ssrNode) {
                adoptedNodes.push(ssrNode);
                adoptedItems.push(item);
              } else {
                if (__DEV__) console.warn(`[FormaJS] Hydration: list item key "${key}" not found in SSR \u2014 rendering fresh`);
                const prevHydrating = hydrating;
                hydrating = false;
                try {
                  const [getIndex] = createSignal(i);
                  const fresh = listRenderFn(item, getIndex);
                  end.parentNode.insertBefore(fresh, end);
                  adoptedNodes.push(fresh);
                  adoptedItems.push(item);
                } finally {
                  hydrating = prevHydrating;
                }
              }
            }
            if (useIndexFallback) {
              for (let i = 0; i < ssrElements.length; i++) {
                if (!usedIndices.has(i) && ssrElements[i].parentNode) {
                  ssrElements[i].parentNode.removeChild(ssrElements[i]);
                }
              }
            } else {
              for (const [unusedKey, unusedNode] of ssrKeyMap) {
                if (__DEV__) console.warn(`[FormaJS] Hydration: removing extra SSR list item with key "${unusedKey}"`);
                if (unusedNode.parentNode) {
                  unusedNode.parentNode.removeChild(unusedNode);
                }
              }
            }
            const parent2 = start.parentNode;
            for (const adoptedNode of adoptedNodes) {
              parent2.insertBefore(adoptedNode, end);
            }
            let cache2 = /* @__PURE__ */ new Map();
            for (let i = 0; i < adoptedItems.length; i++) {
              const item = adoptedItems[i];
              const key = listKeyFn(item);
              const [getIndex, setIndex] = createSignal(i);
              cache2.set(key, {
                element: adoptedNodes[i],
                item,
                getIndex,
                setIndex
              });
            }
            let reconcileNodes = adoptedNodes.slice();
            let reconcileItems = adoptedItems.slice();
            internalEffect(() => {
              const newItems = child.items();
              const parent3 = start.parentNode;
              if (!parent3) return;
              const result = reconcileList(
                parent3,
                reconcileItems,
                newItems,
                reconcileNodes,
                listKeyFn,
                (item) => {
                  const prevHydrating = hydrating;
                  hydrating = false;
                  try {
                    const key = listKeyFn(item);
                    const [getIndex, setIndex] = createSignal(0);
                    const element = untrack(() => listRenderFn(item, getIndex));
                    cache2.set(key, { element, item, getIndex, setIndex });
                    return element;
                  } finally {
                    hydrating = prevHydrating;
                  }
                },
                (_node, item) => {
                  const key = listKeyFn(item);
                  const cached = cache2.get(key);
                  if (cached) cached.item = item;
                },
                end
              );
              const newCache = /* @__PURE__ */ new Map();
              for (let i = 0; i < newItems.length; i++) {
                const key = listKeyFn(newItems[i]);
                const cached = cache2.get(key);
                if (cached) {
                  cached.setIndex(i);
                  newCache.set(key, cached);
                }
              }
              cache2 = newCache;
              reconcileNodes = result.nodes;
              reconcileItems = result.items;
            });
            cursor = end.nextSibling;
          }
        }
      } else if (typeof child === "function") {
        while (cursor && cursor.nodeType === 3 && !cursor.data.trim()) {
          cursor = cursor.nextSibling;
        }
        if (cursor && cursor.nodeType === 1) {
          const initial = child();
          if (isDescriptor(initial)) {
            const el = cursor;
            cursor = cursor.nextSibling;
            adoptNode(initial, el);
            continue;
          }
        }
        if (cursor && cursor.nodeType === 8) {
          const data = cursor.data;
          if (isTextStart(data)) {
            const endMarker = findClosingMarker(cursor);
            let textNode = cursor.nextSibling;
            if (!textNode || textNode.nodeType !== 3) {
              if (__DEV__) console.warn(`[FormaJS] Hydration: created text node for marker ${data} \u2014 SSR walker should emit content between markers`);
              const created = document.createTextNode("");
              cursor.parentNode.insertBefore(created, endMarker || cursor.nextSibling);
              textNode = created;
            }
            internalEffect(() => {
              textNode.data = String(child());
            });
            cursor = endMarker ? endMarker.nextSibling : textNode.nextSibling;
          } else if (isShowStart(data)) {
            const start = cursor;
            const end = findClosingMarker(start);
            if (end) {
              let textNode = findTextBetween(start, end);
              if (!textNode) {
                if (__DEV__) console.warn(`[FormaJS] Hydration: created text node for show marker ${start.data} \u2014 SSR walker should emit content between markers`);
                textNode = document.createTextNode("");
                start.parentNode.insertBefore(textNode, end);
              }
              internalEffect(() => {
                textNode.data = String(child());
              });
              cursor = end.nextSibling;
            } else {
              cursor = cursor.nextSibling;
            }
          } else {
            cursor = cursor.nextSibling;
          }
        } else if (cursor && cursor.nodeType === 3) {
          const textNode = cursor;
          cursor = cursor.nextSibling;
          internalEffect(() => {
            textNode.data = String(child());
          });
        } else {
          if (__DEV__) console.warn(`[FormaJS] Hydration: created text node in empty <${ssrEl.tagName.toLowerCase()}> \u2014 IR may not cover this component`);
          const textNode = document.createTextNode("");
          ssrEl.appendChild(textNode);
          internalEffect(() => {
            textNode.data = String(child());
          });
        }
      } else if (typeof child === "string" || typeof child === "number") {
        if (cursor && cursor.nodeType === 3) {
          cursor = cursor.nextSibling;
        }
      }
    }
  }
  function hydrateIsland(component, target) {
    const hasSSRContent = target.childElementCount > 0 || target.childNodes.length > 0 && Array.from(target.childNodes).some((n) => n.nodeType === 1 || n.nodeType === 3 && n.data.trim());
    if (!hasSSRContent) {
      if (__DEV__) {
        const name = target.getAttribute("data-forma-component") || "unknown";
        console.warn(
          `[forma] Island "${name}" has no SSR content \u2014 falling back to CSR. This means the IR walker did not render content between ISLAND_START and ISLAND_END.`
        );
      }
      const result = component();
      if (result instanceof Element) {
        for (const attr of Array.from(target.attributes)) {
          if (attr.name.startsWith("data-forma-")) {
            result.setAttribute(attr.name, attr.value);
          }
        }
        target.replaceWith(result);
        return result;
      } else if (result instanceof Node) {
        target.appendChild(result);
      }
      return target;
    }
    setHydrating(true);
    let descriptor;
    try {
      descriptor = component();
    } finally {
      setHydrating(false);
    }
    if (!descriptor || !isDescriptor(descriptor)) {
      target.removeAttribute("data-forma-ssr");
      return target;
    }
    if (target.hasAttribute("data-forma-island")) {
      adoptNode(descriptor, target);
    } else {
      adoptNode(descriptor, target.children[0]);
    }
    target.removeAttribute("data-forma-ssr");
    return target;
  }

  // src/dom/element.ts
  var Fragment = /* @__PURE__ */ Symbol.for("forma.fragment");
  var SVG_NS = "http://www.w3.org/2000/svg";
  var XLINK_NS = "http://www.w3.org/1999/xlink";
  var SVG_TAGS = /* @__PURE__ */ new Set([
    "svg",
    "path",
    "circle",
    "rect",
    "line",
    "polyline",
    "polygon",
    "ellipse",
    "g",
    "text",
    "tspan",
    "textPath",
    "defs",
    "use",
    "symbol",
    "clipPath",
    "mask",
    "pattern",
    "marker",
    "linearGradient",
    "radialGradient",
    "stop",
    "filter",
    "feGaussianBlur",
    "feColorMatrix",
    "feOffset",
    "feBlend",
    "feMerge",
    "feMergeNode",
    "feComposite",
    "feFlood",
    "feMorphology",
    "feTurbulence",
    "feDisplacementMap",
    "feImage",
    "foreignObject",
    "animate",
    "animateTransform",
    "animateMotion",
    "set",
    "image",
    "switch",
    "desc",
    "title",
    "metadata"
  ]);
  var BOOLEAN_ATTRS = /* @__PURE__ */ new Set([
    "disabled",
    "checked",
    "readonly",
    "required",
    "autofocus",
    "autoplay",
    "controls",
    "default",
    "defer",
    "formnovalidate",
    "hidden",
    "ismap",
    "loop",
    "multiple",
    "muted",
    "nomodule",
    "novalidate",
    "open",
    "playsinline",
    "reversed",
    "selected",
    "async"
  ]);
  var ELEMENT_PROTOS = null;
  function getProto(tag) {
    if (!ELEMENT_PROTOS) {
      ELEMENT_PROTOS = /* @__PURE__ */ Object.create(null);
      for (const t of [
        "div",
        "span",
        "p",
        "a",
        "li",
        "ul",
        "ol",
        "button",
        "input",
        "label",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "section",
        "header",
        "footer",
        "main",
        "nav",
        "table",
        "tr",
        "td",
        "th",
        "tbody",
        "img",
        "form",
        "select",
        "option",
        "textarea",
        "i",
        "b",
        "strong",
        "em",
        "small",
        "article",
        "aside",
        "details",
        "summary"
      ]) {
        ELEMENT_PROTOS[t] = document.createElement(t);
      }
    }
    return ELEMENT_PROTOS[tag] ?? (ELEMENT_PROTOS[tag] = document.createElement(tag));
  }
  var EVENT_NAMES = /* @__PURE__ */ Object.create(null);
  function eventName(key) {
    return EVENT_NAMES[key] ?? (EVENT_NAMES[key] = key.slice(2).toLowerCase());
  }
  var ABORT_SYM3 = /* @__PURE__ */ Symbol.for("forma-abort");
  function getAbortController(el) {
    let controller = el[ABORT_SYM3];
    if (!controller) {
      controller = new AbortController();
      el[ABORT_SYM3] = controller;
    }
    return controller;
  }
  function cleanup(el) {
    const controller = el[ABORT_SYM3];
    if (controller) {
      controller.abort();
      delete el[ABORT_SYM3];
    }
  }
  var CACHE_SYM2 = /* @__PURE__ */ Symbol.for("forma-attr-cache");
  var DYNAMIC_CHILD_SYM2 = /* @__PURE__ */ Symbol.for("forma-dynamic-child");
  function getCache(el) {
    return el[CACHE_SYM2] ?? (el[CACHE_SYM2] = /* @__PURE__ */ Object.create(null));
  }
  function handleClass(el, _key, value2) {
    if (typeof value2 === "function") {
      internalEffect(() => {
        const v = value2();
        const cache2 = getCache(el);
        if (cache2["class"] === v) return;
        cache2["class"] = v;
        if (el instanceof HTMLElement) {
          el.className = v;
        } else {
          el.setAttribute("class", v);
        }
      });
    } else {
      const cache2 = getCache(el);
      if (cache2["class"] === value2) return;
      cache2["class"] = value2;
      if (el instanceof HTMLElement) {
        el.className = value2;
      } else {
        el.setAttribute("class", value2);
      }
    }
  }
  function handleStyle(el, _key, value2) {
    if (typeof value2 === "function") {
      let prevKeys = [];
      internalEffect(() => {
        const v = value2();
        if (typeof v === "string") {
          const cache2 = getCache(el);
          if (cache2["style"] === v) return;
          cache2["style"] = v;
          prevKeys = [];
          el.style.cssText = v;
        } else if (v && typeof v === "object") {
          const style = el.style;
          const nextKeys = Object.keys(v);
          for (const k of prevKeys) {
            if (!(k in v)) {
              style.removeProperty(k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
            }
          }
          Object.assign(style, v);
          prevKeys = nextKeys;
        }
      });
    } else if (typeof value2 === "string") {
      const cache2 = getCache(el);
      if (cache2["style"] === value2) return;
      cache2["style"] = value2;
      el.style.cssText = value2;
    } else if (value2 && typeof value2 === "object") {
      Object.assign(el.style, value2);
    }
  }
  function handleEvent(el, key, value2) {
    const controller = getAbortController(el);
    el.addEventListener(
      eventName(key),
      value2,
      { signal: controller.signal }
    );
  }
  function handleInnerHTML(el, _key, value2) {
    if (typeof value2 === "function") {
      internalEffect(() => {
        const resolved = value2();
        if (resolved == null) {
          el.innerHTML = "";
          return;
        }
        if (typeof resolved !== "object" || !("__html" in resolved)) {
          throw new TypeError(
            "dangerouslySetInnerHTML: expected { __html: string }, got " + typeof resolved
          );
        }
        const html = resolved.__html;
        if (typeof html !== "string") {
          throw new TypeError(
            "dangerouslySetInnerHTML: __html must be a string, got " + typeof html
          );
        }
        const cache2 = getCache(el);
        if (cache2["innerHTML"] === html) return;
        cache2["innerHTML"] = html;
        el.innerHTML = html;
      });
    } else {
      if (value2 == null) {
        el.innerHTML = "";
        return;
      }
      if (typeof value2 !== "object" || !("__html" in value2)) {
        throw new TypeError(
          "dangerouslySetInnerHTML: expected { __html: string }, got " + typeof value2
        );
      }
      const html = value2.__html;
      if (typeof html !== "string") {
        throw new TypeError(
          "dangerouslySetInnerHTML: __html must be a string, got " + typeof html
        );
      }
      el.innerHTML = html;
    }
  }
  function handleXLink(el, key, value2) {
    const localName = key.slice(6);
    if (typeof value2 === "function") {
      internalEffect(() => {
        const v = value2();
        if (v == null || v === false) {
          el.removeAttributeNS(XLINK_NS, localName);
        } else {
          el.setAttributeNS(XLINK_NS, key, String(v));
        }
      });
    } else {
      if (value2 == null || value2 === false) {
        el.removeAttributeNS(XLINK_NS, localName);
      } else {
        el.setAttributeNS(XLINK_NS, key, String(value2));
      }
    }
  }
  function handleBooleanAttr(el, key, value2) {
    if (typeof value2 === "function") {
      internalEffect(() => {
        const v = value2();
        const cache2 = getCache(el);
        if (cache2[key] === v) return;
        cache2[key] = v;
        if (v) {
          el.setAttribute(key, "");
        } else {
          el.removeAttribute(key);
        }
      });
    } else {
      const cache2 = getCache(el);
      if (cache2[key] === value2) return;
      cache2[key] = value2;
      if (value2) {
        el.setAttribute(key, "");
      } else {
        el.removeAttribute(key);
      }
    }
  }
  function handleGenericAttr(el, key, value2) {
    if (typeof value2 === "function") {
      internalEffect(() => {
        const v = value2();
        if (v == null || v === false) {
          const cache2 = getCache(el);
          if (cache2[key] === null) return;
          cache2[key] = null;
          el.removeAttribute(key);
        } else {
          const strVal = String(v);
          const cache2 = getCache(el);
          if (cache2[key] === strVal) return;
          cache2[key] = strVal;
          el.setAttribute(key, strVal);
        }
      });
    } else {
      if (value2 == null || value2 === false) {
        const cache2 = getCache(el);
        if (cache2[key] === null) return;
        cache2[key] = null;
        el.removeAttribute(key);
      } else {
        const strVal = String(value2);
        const cache2 = getCache(el);
        if (cache2[key] === strVal) return;
        cache2[key] = strVal;
        el.setAttribute(key, strVal);
      }
    }
  }
  var PROP_HANDLERS = /* @__PURE__ */ new Map();
  PROP_HANDLERS.set("class", handleClass);
  PROP_HANDLERS.set("className", handleClass);
  PROP_HANDLERS.set("style", handleStyle);
  PROP_HANDLERS.set("ref", () => {
  });
  PROP_HANDLERS.set("dangerouslySetInnerHTML", handleInnerHTML);
  for (const attr of BOOLEAN_ATTRS) {
    PROP_HANDLERS.set(attr, handleBooleanAttr);
  }
  function applyProp(el, key, value2) {
    if (key === "class") {
      handleClass(el, key, value2);
      return;
    }
    if (key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && key.length > 2) {
      handleEvent(el, key, value2);
      return;
    }
    const handler = PROP_HANDLERS.get(key);
    if (handler) {
      handler(el, key, value2);
      return;
    }
    if (key.charCodeAt(0) === 120 && key.startsWith("xlink:")) {
      handleXLink(el, key, value2);
      return;
    }
    handleGenericAttr(el, key, value2);
  }
  function applyStaticProp(el, key, value2) {
    if (value2 == null || value2 === false) return;
    if (key === "class" || key === "className") {
      el.className = value2;
      return;
    }
    if (key === "style") {
      if (typeof value2 === "string") {
        el.style.cssText = value2;
      } else if (value2 && typeof value2 === "object") {
        Object.assign(el.style, value2);
      }
      return;
    }
    if (key === "dangerouslySetInnerHTML") {
      if (typeof value2 !== "object" || !("__html" in value2)) {
        throw new TypeError(
          "dangerouslySetInnerHTML: expected { __html: string }, got " + typeof value2
        );
      }
      const html = value2.__html;
      if (typeof html !== "string") {
        throw new TypeError(
          "dangerouslySetInnerHTML: __html must be a string, got " + typeof html
        );
      }
      el.innerHTML = html;
      return;
    }
    if (key.charCodeAt(0) === 120 && key.startsWith("xlink:")) {
      el.setAttributeNS(XLINK_NS, key, String(value2));
      return;
    }
    if (BOOLEAN_ATTRS.has(key)) {
      if (value2) el.setAttribute(key, "");
      return;
    }
    if (value2 === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value2));
    }
  }
  function appendChild(parent2, child) {
    if (child instanceof Node) {
      parent2.appendChild(child);
      return;
    }
    if (typeof child === "string") {
      parent2.appendChild(new Text(child));
      return;
    }
    if (child == null || child === false || child === true) {
      return;
    }
    if (typeof child === "number") {
      parent2.appendChild(new Text(String(child)));
      return;
    }
    if (typeof child === "function") {
      if (parent2 instanceof Element) {
        parent2[DYNAMIC_CHILD_SYM2] = true;
      }
      let currentNode = null;
      internalEffect(() => {
        const v = child();
        if (v instanceof Node) {
          if (currentNode) {
            parent2.replaceChild(v, currentNode);
          } else {
            parent2.appendChild(v);
          }
          currentNode = v;
        } else {
          const text = typeof v === "symbol" ? String(v) : String(v ?? "");
          if (!currentNode) {
            currentNode = new Text(text);
            parent2.appendChild(currentNode);
          } else if (currentNode.nodeType === 3) {
            currentNode.data = text;
          } else {
            const tn = new Text(text);
            parent2.replaceChild(tn, currentNode);
            currentNode = tn;
          }
        }
      });
      return;
    }
    if (Array.isArray(child)) {
      for (const item of child) {
        appendChild(parent2, item);
      }
      return;
    }
  }
  function h(tag, props, ...children2) {
    if (typeof tag === "function" && tag !== Fragment) {
      const mergedProps = { ...props ?? {}, children: children2 };
      return tag(mergedProps);
    }
    if (tag === Fragment) {
      const frag = document.createDocumentFragment();
      for (const child of children2) {
        appendChild(frag, child);
      }
      return frag;
    }
    const tagName = tag;
    if (hydrating) {
      return { type: "element", tag: tagName, props: props ?? null, children: children2 };
    }
    let el;
    if (ELEMENT_PROTOS && ELEMENT_PROTOS[tagName]) {
      el = ELEMENT_PROTOS[tagName].cloneNode(false);
    } else if (SVG_TAGS.has(tagName)) {
      el = document.createElementNS(SVG_NS, tagName);
    } else {
      el = getProto(tagName).cloneNode(false);
    }
    if (props) {
      let hasDynamic = false;
      for (const key in props) {
        if (key === "ref") continue;
        const value2 = props[key];
        if (key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && key.length > 2) {
          handleEvent(el, key, value2);
          continue;
        }
        if (typeof value2 === "function") {
          if (!hasDynamic) {
            el[CACHE_SYM2] = /* @__PURE__ */ Object.create(null);
            hasDynamic = true;
          }
          applyProp(el, key, value2);
          continue;
        }
        applyStaticProp(el, key, value2);
      }
    }
    const childLen = children2.length;
    if (childLen === 1) {
      const only = children2[0];
      if (typeof only === "string") {
        el.textContent = only;
      } else if (typeof only === "number") {
        el.textContent = String(only);
      } else {
        appendChild(el, only);
      }
    } else if (childLen > 1) {
      for (const child of children2) {
        appendChild(el, child);
      }
    }
    if (props && typeof props["ref"] === "function") {
      props["ref"](el);
    }
    return el;
  }
  function fragment(...children2) {
    const frag = document.createDocumentFragment();
    for (const child of children2) {
      appendChild(frag, child);
    }
    return frag;
  }

  // src/dom/text.ts
  function createText(value2) {
    if (typeof value2 === "function") {
      const node = new Text("");
      internalEffect(() => {
        node.data = value2();
      });
      return node;
    }
    return new Text(value2);
  }

  // src/dom/mount.ts
  function mount(component, container) {
    const target = typeof container === "string" ? document.querySelector(container) : container;
    if (!target) {
      throw new Error(`mount: container not found \u2014 "${container}"`);
    }
    let disposeRoot;
    if (target.hasAttribute("data-forma-ssr")) {
      createRoot((dispose) => {
        disposeRoot = dispose;
        hydrateIsland(component, target);
      });
    } else {
      const dom = createRoot((dispose) => {
        disposeRoot = dispose;
        return component();
      });
      target.innerHTML = "";
      target.appendChild(dom);
    }
    let unmounted = false;
    return () => {
      if (unmounted) return;
      unmounted = true;
      disposeRoot();
      target.innerHTML = "";
    };
  }

  // src/dom/switch.ts
  function createSwitch(value2, cases, fallback) {
    const startMarker = document.createComment("forma-switch");
    const endMarker = document.createComment("/forma-switch");
    const fragment2 = document.createDocumentFragment();
    fragment2.appendChild(startMarker);
    fragment2.appendChild(endMarker);
    const cache2 = /* @__PURE__ */ new Map();
    let currentNode = null;
    let currentMatch = UNSET;
    const switchDispose = internalEffect(() => {
      const val = value2();
      if (val === currentMatch) return;
      const DEBUG = typeof globalThis.__FORMA_DEBUG__ !== "undefined";
      if (DEBUG) console.log("[forma:switch] transition", String(currentMatch), "\u2192", String(val));
      currentMatch = val;
      const parent2 = startMarker.parentNode;
      if (!parent2) {
        if (DEBUG) console.warn("[forma:switch] markers not in DOM yet, skipping");
        return;
      }
      if (currentNode) {
        if (currentNode.parentNode === parent2) {
          if (DEBUG) console.log("[forma:switch] removing single node");
          parent2.removeChild(currentNode);
        } else if (currentNode.nodeType === 11) {
          if (DEBUG) console.log("[forma:switch] scooping nodes back into fragment");
          let scooped = 0;
          while (startMarker.nextSibling && startMarker.nextSibling !== endMarker) {
            currentNode.appendChild(startMarker.nextSibling);
            scooped++;
          }
          if (DEBUG) console.log("[forma:switch] scooped", scooped, "nodes back into fragment");
        } else {
          if (DEBUG) console.log("[forma:switch] clearing detached node between markers");
          while (startMarker.nextSibling && startMarker.nextSibling !== endMarker) {
            parent2.removeChild(startMarker.nextSibling);
          }
        }
      }
      const matchedCase = cases.find((c) => c.match === val);
      if (matchedCase) {
        let entry = cache2.get(val);
        if (!entry) {
          let branchDispose;
          const node = createRoot((dispose) => {
            branchDispose = dispose;
            return untrack(() => matchedCase.render());
          });
          entry = { node, dispose: branchDispose };
          cache2.set(val, entry);
          if (DEBUG) console.log("[forma:switch] rendered new branch for", String(val), "\u2192", node.nodeName, "type", node.nodeType);
        } else {
          if (DEBUG) console.log("[forma:switch] reusing cached branch for", String(val), "\u2192", entry.node.nodeName, "type", entry.node.nodeType, "childNodes", entry.node.childNodes?.length);
        }
        currentNode = entry.node;
      } else {
        currentNode = fallback?.() ?? null;
        if (DEBUG) console.log("[forma:switch] no match, using fallback");
      }
      if (currentNode) {
        parent2.insertBefore(currentNode, endMarker);
        if (DEBUG) console.log("[forma:switch] inserted", currentNode.nodeName, "before end marker");
      }
    });
    fragment2.__switchDispose = () => {
      switchDispose();
      for (const entry of cache2.values()) {
        entry.dispose();
      }
      cache2.clear();
    };
    return fragment2;
  }
  var UNSET = /* @__PURE__ */ Symbol("unset");

  // src/dom/portal.ts
  function createPortal(children2, target) {
    const placeholder = document.createComment("forma-portal");
    const resolvedTarget = typeof target === "string" ? document.querySelector(target) : target ?? document.body;
    if (!resolvedTarget) {
      throw new Error(`createPortal: target not found: ${target}`);
    }
    let mountedNode = null;
    const removeMountedNode = () => {
      if (mountedNode && mountedNode.parentNode === resolvedTarget) {
        resolvedTarget.removeChild(mountedNode);
      }
      mountedNode = null;
    };
    createEffect(() => {
      const node = children2();
      removeMountedNode();
      mountedNode = node;
      resolvedTarget.appendChild(node);
      return () => {
        removeMountedNode();
      };
    });
    return placeholder;
  }

  // src/dom/error-boundary.ts
  function createErrorBoundary(tryFn, catchFn) {
    const startMarker = document.createComment("forma-error-boundary");
    const endMarker = document.createComment("/forma-error-boundary");
    const fragment2 = document.createDocumentFragment();
    fragment2.appendChild(startMarker);
    fragment2.appendChild(endMarker);
    const [retryCount, setRetryCount] = createSignal(0);
    let currentNode = null;
    internalEffect(() => {
      retryCount();
      const parent2 = startMarker.parentNode;
      if (!parent2) return;
      if (currentNode && currentNode.parentNode === parent2) {
        parent2.removeChild(currentNode);
      }
      try {
        currentNode = tryFn();
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        const retry = () => setRetryCount((c) => c + 1);
        currentNode = catchFn(error, retry);
      }
      if (currentNode) {
        parent2.insertBefore(currentNode, endMarker);
      }
    });
    return fragment2;
  }

  // src/dom/suspense.ts
  function createSuspense(fallback, children2) {
    const startMarker = document.createComment("forma-suspense");
    const endMarker = document.createComment("/forma-suspense");
    const fragment2 = document.createDocumentFragment();
    fragment2.appendChild(startMarker);
    fragment2.appendChild(endMarker);
    const [pending, setPending] = createSignal(0);
    let currentNode = null;
    let resolvedNode = null;
    let fallbackNode = null;
    const ctx = {
      increment() {
        setPending((p) => p + 1);
      },
      decrement() {
        setPending((p) => Math.max(0, p - 1));
      }
    };
    pushSuspenseContext(ctx);
    try {
      resolvedNode = children2();
    } finally {
      popSuspenseContext();
    }
    internalEffect(() => {
      const parent2 = startMarker.parentNode;
      if (!parent2) return;
      const isPending = pending() > 0;
      const newNode = isPending ? fallbackNode ??= fallback() : resolvedNode;
      if (newNode === currentNode) return;
      if (currentNode && currentNode.parentNode === parent2) {
        parent2.removeChild(currentNode);
      }
      if (newNode) {
        parent2.insertBefore(newNode, endMarker);
      }
      currentNode = newNode;
    });
    return fragment2;
  }

  // src/dom/template.ts
  var cache = /* @__PURE__ */ new Map();
  function template(html) {
    let node = cache.get(html);
    if (!node) {
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      node = tpl.content.firstChild;
      cache.set(html, node);
    }
    return node;
  }
  function templateMany(html) {
    let node = cache.get(html);
    if (!node) {
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      node = tpl.content;
      cache.set(html, node);
    }
    return node.cloneNode(true);
  }

  // src/dom/activate.ts
  var FORBIDDEN_PROP_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  function sanitizeProps(obj) {
    for (const key of FORBIDDEN_PROP_KEYS) {
      if (key in obj) delete obj[key];
    }
    return obj;
  }
  function loadIslandProps(root, id, sharedProps) {
    const inline = root.getAttribute("data-forma-props");
    if (inline) {
      return sanitizeProps(JSON.parse(inline));
    }
    if (sharedProps && String(id) in sharedProps) {
      return sanitizeProps(sharedProps[String(id)]);
    }
    return null;
  }
  function activateIslands(registry) {
    const scriptBlock = document.getElementById("__forma_islands");
    const sharedProps = scriptBlock ? JSON.parse(scriptBlock.textContent) : null;
    const islands = document.querySelectorAll("[data-forma-island]");
    for (const root of islands) {
      const id = parseInt(root.getAttribute("data-forma-island"), 10);
      const componentName = root.getAttribute("data-forma-component");
      const hydrateFn = registry[componentName];
      if (!hydrateFn) {
        if (__DEV__) console.warn(`[forma] No hydrate function for island "${componentName}" (id=${id})`);
        root.setAttribute("data-forma-status", "error");
        continue;
      }
      const trigger2 = root.getAttribute("data-forma-hydrate") || "load";
      if (trigger2 === "visible") {
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              observer.disconnect();
              hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps);
            }
          },
          { rootMargin: "200px" }
        );
        observer.observe(root);
      } else if (trigger2 === "idle") {
        const hydrate = () => hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps);
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(hydrate);
        } else {
          setTimeout(hydrate, 200);
        }
      } else if (trigger2 === "interaction") {
        const hydrate = () => {
          root.removeEventListener("pointerdown", hydrate, true);
          root.removeEventListener("focusin", hydrate, true);
          hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps);
        };
        root.addEventListener("pointerdown", hydrate, { capture: true, once: true });
        root.addEventListener("focusin", hydrate, { capture: true, once: true });
      } else {
        hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps);
      }
    }
  }
  function deactivateIsland(el) {
    const dispose = el.__formaDispose;
    if (typeof dispose === "function") {
      dispose();
      delete el.__formaDispose;
      el.setAttribute("data-forma-status", "disposed");
    }
  }
  function deactivateAllIslands(root = document) {
    const islands = root.querySelectorAll('[data-forma-status="active"]');
    for (const island of islands) {
      deactivateIsland(island);
    }
  }
  function hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps) {
    try {
      const props = loadIslandProps(root, id, sharedProps);
      root.setAttribute("data-forma-status", "hydrating");
      let activeRoot = root;
      createRoot((dispose) => {
        activeRoot = hydrateIsland(() => hydrateFn(root, props), root);
        activeRoot.__formaDispose = dispose;
      });
      activeRoot.setAttribute("data-forma-status", "active");
    } catch (err) {
      if (__DEV__) console.error(`[forma] Island "${componentName}" (id=${id}) failed:`, err);
      root.setAttribute("data-forma-status", "error");
    }
  }

  // src/component/define.ts
  var currentLifecycleContext = null;
  var lifecycleStack = [];
  function pushLifecycleContext(ctx) {
    lifecycleStack.push(currentLifecycleContext);
    currentLifecycleContext = ctx;
  }
  function popLifecycleContext() {
    currentLifecycleContext = lifecycleStack.pop() ?? null;
  }
  function onMount(fn) {
    if (currentLifecycleContext === null) {
      throw new Error("onMount() must be called inside a component setup function");
    }
    currentLifecycleContext.mountCallbacks.push(fn);
  }
  function onUnmount(fn) {
    if (currentLifecycleContext === null) {
      throw new Error("onUnmount() must be called inside a component setup function");
    }
    currentLifecycleContext.unmountCallbacks.push(fn);
  }
  var DISPOSE_KEY = /* @__PURE__ */ Symbol("forma:component:dispose");
  function defineComponent(setupOrDef) {
    const setup = typeof setupOrDef === "function" ? setupOrDef : setupOrDef.setup;
    const name = typeof setupOrDef === "function" ? void 0 : setupOrDef.name;
    return function componentFactory() {
      const ctx = {
        disposers: [],
        mountCallbacks: [],
        unmountCallbacks: []
      };
      pushLifecycleContext(ctx);
      let dom;
      try {
        dom = setup();
      } finally {
        popLifecycleContext();
      }
      const dispose = () => {
        for (const cb of ctx.unmountCallbacks) {
          try {
            cb();
          } catch (e) {
            reportError(e, "onUnmount");
          }
        }
        for (const d of ctx.disposers) {
          try {
            d();
          } catch (e) {
            reportError(e, "component disposer");
          }
        }
        ctx.disposers.length = 0;
        ctx.mountCallbacks.length = 0;
        ctx.unmountCallbacks.length = 0;
      };
      dom[DISPOSE_KEY] = dispose;
      for (const cb of ctx.mountCallbacks) {
        try {
          const cleanup2 = cb();
          if (typeof cleanup2 === "function") {
            ctx.unmountCallbacks.push(cleanup2);
          }
        } catch (e) {
          reportError(e, "onMount");
        }
      }
      return dom;
    };
  }
  function disposeComponent(dom) {
    const disposable = dom;
    if (typeof disposable[DISPOSE_KEY] === "function") {
      disposable[DISPOSE_KEY]();
      delete disposable[DISPOSE_KEY];
    }
  }
  function trackDisposer(dispose) {
    if (currentLifecycleContext !== null) {
      currentLifecycleContext.disposers.push(dispose);
    }
  }

  // src/component/context.ts
  var contextStacks = /* @__PURE__ */ new Map();
  function createContext(defaultValue) {
    return {
      id: /* @__PURE__ */ Symbol("forma:context"),
      defaultValue
    };
  }
  function provide(ctx, value2) {
    let stack = contextStacks.get(ctx.id);
    if (stack === void 0) {
      stack = [];
      contextStacks.set(ctx.id, stack);
    }
    stack.push(value2);
  }
  function inject(ctx) {
    const stack = contextStacks.get(ctx.id);
    if (stack === void 0 || stack.length === 0) {
      return ctx.defaultValue;
    }
    return stack[stack.length - 1];
  }
  function unprovide(ctx) {
    const stack = contextStacks.get(ctx.id);
    if (stack !== void 0 && stack.length > 0) {
      stack.pop();
      if (stack.length === 0) {
        contextStacks.delete(ctx.id);
      }
    }
  }

  // src/state/store.ts
  var RAW = /* @__PURE__ */ Symbol("forma-raw");
  var PROXY = /* @__PURE__ */ Symbol("forma-proxy");
  var ARRAY_MUTATORS = /* @__PURE__ */ new Set([
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin"
  ]);
  function shouldWrap(v) {
    if (v == null || typeof v !== "object") return false;
    if (v instanceof Date || v instanceof RegExp || v instanceof Map || v instanceof Set || v instanceof WeakMap || v instanceof WeakSet || v instanceof Error || v instanceof Promise) {
      return false;
    }
    if (v[PROXY]) return false;
    return true;
  }
  function deepClone(obj, seen) {
    if (obj === null || typeof obj !== "object") return obj;
    if (!seen) seen = /* @__PURE__ */ new WeakSet();
    if (seen.has(obj)) return obj;
    seen.add(obj);
    if (Array.isArray(obj)) return obj.map((item) => deepClone(item, seen));
    const out = {};
    for (const key of Object.keys(obj)) {
      out[key] = deepClone(obj[key], seen);
    }
    return out;
  }
  function createStore(initial) {
    const signals = /* @__PURE__ */ new Map();
    const children2 = /* @__PURE__ */ new Map();
    function registerChild(path) {
      const lastDot = path.lastIndexOf(".");
      if (lastDot === -1) return;
      const parentPath = path.substring(0, lastDot);
      let set = children2.get(parentPath);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        children2.set(parentPath, set);
      }
      set.add(path);
    }
    function getSignal(path, initialValue) {
      let pair = signals.get(path);
      if (!pair) {
        pair = createSignal(initialValue);
        signals.set(path, pair);
        registerChild(path);
      }
      return pair;
    }
    const proxyCache = /* @__PURE__ */ new WeakMap();
    function invalidateChildren(parentPath) {
      const childSet = children2.get(parentPath);
      if (!childSet) return;
      for (const childPath of childSet) {
        invalidateChildren(childPath);
        signals.delete(childPath);
        children2.delete(childPath);
      }
      childSet.clear();
    }
    function wrap(raw, basePath) {
      if (!shouldWrap(raw)) return raw;
      const cached = proxyCache.get(raw);
      if (cached) return cached;
      const isArr = Array.isArray(raw);
      const basePrefix = basePath ? basePath + "." : "";
      let lastKey = "";
      let lastSignal;
      const proxy = new Proxy(raw, {
        // -------------------------------------------------------------------
        // GET
        // -------------------------------------------------------------------
        get(target, prop, receiver) {
          if (prop === RAW) return target;
          if (prop === PROXY) return true;
          if (typeof prop === "symbol") {
            return Reflect.get(target, prop, receiver);
          }
          const key = String(prop);
          const childPath = basePrefix + key;
          if (isArr && ARRAY_MUTATORS.has(key)) {
            return (...args) => {
              let result;
              batch(() => {
                const rawArgs = args.map(
                  (a) => a != null && typeof a === "object" && a[RAW] ? a[RAW] : a
                );
                result = target[key].apply(target, rawArgs);
                invalidateChildren(basePath);
                const [, setLen] = getSignal(
                  basePrefix + "length",
                  target.length
                );
                setLen(target.length);
              });
              return result;
            };
          }
          if (isArr && key === "length") {
            const [getter] = getSignal(childPath, target.length);
            getter();
            return target.length;
          }
          const value2 = Reflect.get(target, prop);
          let pair;
          if (key === lastKey && lastSignal) {
            pair = lastSignal;
          } else {
            pair = getSignal(childPath, value2);
            lastKey = key;
            lastSignal = pair;
          }
          pair[0]();
          if (shouldWrap(value2)) {
            return wrap(value2, childPath);
          }
          return value2;
        },
        // -------------------------------------------------------------------
        // SET
        // -------------------------------------------------------------------
        set(target, prop, value2) {
          if (typeof prop === "symbol") {
            return Reflect.set(target, prop, value2);
          }
          const key = String(prop);
          const childPath = basePrefix + key;
          const rawValue = value2 != null && typeof value2 === "object" && value2[RAW] ? value2[RAW] : value2;
          Reflect.set(target, prop, rawValue);
          if (rawValue != null && typeof rawValue === "object") {
            invalidateChildren(childPath);
          }
          if (isArr && key !== "length") {
            const lengthPath = basePrefix + "length";
            const lenPair = signals.get(lengthPath);
            if (lenPair) {
              lenPair[1](target.length);
            }
          }
          const [, setter2] = getSignal(childPath, rawValue);
          setter2(rawValue);
          return true;
        },
        // -------------------------------------------------------------------
        // HAS — track membership checks
        // -------------------------------------------------------------------
        has(target, prop) {
          if (typeof prop === "symbol") {
            return Reflect.has(target, prop);
          }
          const key = String(prop);
          const childPath = basePrefix + key;
          const [getter] = getSignal(childPath, Reflect.get(target, prop));
          getter();
          return Reflect.has(target, prop);
        },
        // -------------------------------------------------------------------
        // OWNKEYS — return keys from the raw target
        // -------------------------------------------------------------------
        ownKeys(target) {
          return Reflect.ownKeys(target);
        },
        // -------------------------------------------------------------------
        // GETOWNPROPERTYDESCRIPTOR — needed for Object.keys / spread / ...
        // -------------------------------------------------------------------
        getOwnPropertyDescriptor(target, prop) {
          return Object.getOwnPropertyDescriptor(target, prop);
        },
        // -------------------------------------------------------------------
        // DELETEPROPERTY — clean up signals when a key is removed
        // -------------------------------------------------------------------
        deleteProperty(target, prop) {
          if (typeof prop === "symbol") {
            return Reflect.deleteProperty(target, prop);
          }
          const key = String(prop);
          const childPath = basePrefix + key;
          const result = Reflect.deleteProperty(target, prop);
          invalidateChildren(childPath);
          signals.delete(childPath);
          const parentPath = basePath;
          if (parentPath !== void 0) {
            const parentSet = children2.get(parentPath);
            if (parentSet) {
              parentSet.delete(childPath);
              if (parentSet.size === 0) children2.delete(parentPath);
            }
          }
          children2.delete(childPath);
          return result;
        }
      });
      proxyCache.set(raw, proxy);
      return proxy;
    }
    const rootProxy = wrap(initial, "");
    function getCurrentSnapshot() {
      return untrack(() => deepClone(initial));
    }
    const setter = (partial) => {
      const updates = typeof partial === "function" ? partial(getCurrentSnapshot()) : partial;
      batch(() => {
        for (const key of Object.keys(updates)) {
          rootProxy[key] = updates[key];
        }
      });
    };
    return [rootProxy, setter];
  }

  // src/state/history.ts
  function createHistory(source, options) {
    const [sourceGet, sourceSet] = source;
    const maxLength = options?.maxLength ?? 100;
    let _stack = [sourceGet()];
    let _cursor = 0;
    const [stackSignal, setStackSignal] = createSignal([..._stack]);
    const [cursorSignal, setCursorSignal] = createSignal(_cursor);
    const [stackLenSignal, setStackLenSignal] = createSignal(_stack.length);
    function syncSignals() {
      batch(() => {
        setStackSignal([..._stack]);
        setCursorSignal(_cursor);
        setStackLenSignal(_stack.length);
      });
    }
    let ignoreNext = false;
    let isFirstRun = true;
    internalEffect(() => {
      const value2 = sourceGet();
      if (isFirstRun) {
        isFirstRun = false;
        return;
      }
      if (ignoreNext) {
        ignoreNext = false;
        return;
      }
      _stack = _stack.slice(0, _cursor + 1);
      _stack.push(value2);
      if (_stack.length > maxLength) {
        _stack.splice(0, _stack.length - maxLength);
      }
      _cursor = _stack.length - 1;
      syncSignals();
    });
    const canUndo = () => cursorSignal() > 0;
    const canRedo = () => cursorSignal() < stackLenSignal() - 1;
    const undo = () => {
      if (_cursor <= 0) return;
      _cursor--;
      ignoreNext = true;
      sourceSet(_stack[_cursor]);
      syncSignals();
    };
    const redo = () => {
      if (_cursor >= _stack.length - 1) return;
      _cursor++;
      ignoreNext = true;
      sourceSet(_stack[_cursor]);
      syncSignals();
    };
    const clear = () => {
      const currentValue = sourceGet();
      _stack = [currentValue];
      _cursor = 0;
      syncSignals();
    };
    return {
      undo,
      redo,
      canUndo,
      canRedo,
      history: () => stackSignal(),
      cursor: () => cursorSignal(),
      clear
    };
  }

  // src/state/persist.ts
  function persist(source, key, options) {
    const [sourceGet, sourceSet] = source;
    const storage = options?.storage ?? globalThis.localStorage;
    const serialize = options?.serialize ?? JSON.stringify;
    const deserialize = options?.deserialize ?? JSON.parse;
    const validate = options?.validate;
    try {
      const stored = storage.getItem(key);
      if (stored !== null) {
        const value2 = deserialize(stored);
        if (!validate || validate(value2)) {
          sourceSet(value2);
        }
      }
    } catch {
    }
    internalEffect(() => {
      const value2 = sourceGet();
      try {
        const serialized = serialize(value2);
        storage.setItem(key, serialized);
      } catch {
      }
    });
  }

  // src/events/bus.ts
  function createBus() {
    const listeners = /* @__PURE__ */ new Map();
    function getHandlers(event) {
      let set = listeners.get(event);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        listeners.set(event, set);
      }
      return set;
    }
    function on2(event, handler) {
      const set = getHandlers(event);
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    }
    function once(event, handler) {
      const wrapper = (payload) => {
        off(event, wrapper);
        handler(payload);
      };
      return on2(event, wrapper);
    }
    function emit(event, payload) {
      const set = listeners.get(event);
      if (set) {
        for (const handler of [...set]) {
          try {
            handler(payload);
          } catch (e) {
            console.error(`[forma] Bus handler error on "${String(event)}":`, e);
          }
        }
      }
    }
    function off(event, handler) {
      const set = listeners.get(event);
      if (set) {
        set.delete(handler);
      }
    }
    function clear() {
      listeners.clear();
    }
    return { on: on2, once, emit, off, clear };
  }

  // src/events/delegate.ts
  function delegate(container, selector, event, handler, options) {
    const listener = (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const root = container instanceof Document ? container.documentElement : container;
      const matched = target.closest(selector);
      if (matched instanceof HTMLElement && root.contains(matched)) {
        handler(e, matched);
      }
    };
    container.addEventListener(event, listener, options);
    return () => {
      container.removeEventListener(event, listener, options);
    };
  }

  // src/events/keyboard.ts
  function parseCombo(combo) {
    const parts = combo.toLowerCase().split("+").map((p) => p.trim());
    const modifiers = {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
      key: ""
    };
    for (const part of parts) {
      switch (part) {
        case "ctrl":
        case "control":
          modifiers.ctrl = true;
          break;
        case "shift":
          modifiers.shift = true;
          break;
        case "alt":
          modifiers.alt = true;
          break;
        case "meta":
        case "cmd":
        case "command":
          modifiers.meta = true;
          break;
        default:
          modifiers.key = part;
      }
    }
    return modifiers;
  }
  function matchesCombo(e, parsed) {
    if (e.ctrlKey !== parsed.ctrl) return false;
    if (e.shiftKey !== parsed.shift) return false;
    if (e.altKey !== parsed.alt) return false;
    if (e.metaKey !== parsed.meta) return false;
    return e.key.toLowerCase() === parsed.key;
  }
  function onKey(combo, handler, options) {
    const target = options?.target ?? document;
    const shouldPreventDefault = options?.preventDefault ?? true;
    const parsed = parseCombo(combo);
    const listener = (e) => {
      if (!(e instanceof KeyboardEvent)) return;
      if (matchesCombo(e, parsed)) {
        if (shouldPreventDefault) {
          e.preventDefault();
        }
        handler(e);
      }
    };
    target.addEventListener("keydown", listener);
    return () => {
      target.removeEventListener("keydown", listener);
    };
  }

  // src/dom-utils/query.ts
  function $(selector, parent2) {
    return (parent2 ?? document).querySelector(selector);
  }
  function $$(selector, parent2) {
    return Array.from((parent2 ?? document).querySelectorAll(selector));
  }

  // src/dom-utils/mutate.ts
  function addClass(el, ...classes) {
    el.classList.add(...classes);
  }
  function removeClass(el, ...classes) {
    el.classList.remove(...classes);
  }
  function toggleClass(el, className, force) {
    return el.classList.toggle(className, force);
  }
  function setStyle(el, styles) {
    for (const [key, value2] of Object.entries(styles)) {
      if (value2 !== void 0) {
        el.style[key] = value2;
      }
    }
  }
  function setAttr(el, attrs) {
    for (const [name, value2] of Object.entries(attrs)) {
      if (value2 === false || value2 === null) {
        el.removeAttribute(name);
      } else if (value2 === true) {
        el.setAttribute(name, "");
      } else {
        el.setAttribute(name, value2);
      }
    }
  }
  function setText(el, text) {
    el.textContent = text;
  }
  function setHTMLUnsafe(el, html) {
    el.innerHTML = html;
  }

  // src/dom-utils/traverse.ts
  function closest(el, selector) {
    return el.closest(selector);
  }
  function children(el, selector) {
    const all = Array.from(el.children);
    if (!selector) return all;
    return all.filter((child) => child.matches(selector));
  }
  function siblings(el, selector) {
    const parentEl = el.parentElement;
    if (!parentEl) return [];
    const all = Array.from(parentEl.children);
    const sibs = all.filter((child) => child !== el);
    if (!selector) return sibs;
    return sibs.filter((child) => child.matches(selector));
  }
  function parent(el) {
    return el.parentElement;
  }
  function nextSibling(el, selector) {
    let sib = el.nextElementSibling;
    while (sib) {
      if (sib instanceof HTMLElement) {
        if (!selector || sib.matches(selector)) {
          return sib;
        }
      }
      sib = sib.nextElementSibling;
    }
    return null;
  }
  function prevSibling(el, selector) {
    let sib = el.previousElementSibling;
    while (sib) {
      if (sib instanceof HTMLElement) {
        if (!selector || sib.matches(selector)) {
          return sib;
        }
      }
      sib = sib.previousElementSibling;
    }
    return null;
  }

  // src/dom-utils/observe.ts
  function onResize(el, handler) {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        handler(entry);
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }
  function onIntersect(el, handler, options) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        handler(entry);
      }
    }, options);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }
  function onMutation(el, handler, options) {
    const observer = new MutationObserver((mutations) => {
      handler(mutations);
    });
    observer.observe(el, options ?? { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }
  return __toCommonJS(src_exports);
})();
//# sourceMappingURL=formajs.global.js.map
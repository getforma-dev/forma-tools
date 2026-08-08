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

  // ../formajs/dist/forma.esm.js
  var forma_esm_exports = {};
  __export(forma_esm_exports, {
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
    createUnownedRoot: () => createUnownedRoot,
    deactivateAllIslands: () => deactivateAllIslands,
    deactivateIsland: () => deactivateIsland,
    defineComponent: () => defineComponent,
    delegate: () => delegate,
    disposeComponent: () => disposeComponent,
    fragment: () => fragment,
    getBatchDepth: () => getBatchDepth,
    getOwner: () => getOwner,
    getSignalName: () => getSignalName,
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
    runWithOwner: () => runWithOwner,
    sanitizePropsDeep: () => sanitizePropsDeep,
    setAttr: () => setAttr,
    setHTMLUnsafe: () => setHTMLUnsafe,
    setStyle: () => setStyle,
    setText: () => setText,
    siblings: () => siblings,
    svg: () => svg,
    template: () => template,
    templateMany: () => templateMany,
    toggleClass: () => toggleClass,
    trackDisposer: () => trackDisposer,
    trigger: () => trigger,
    unprovide: () => unprovide,
    untrack: () => untrack,
    value: () => value
  });
  function createReactiveSystem({ update, notify, unwatched }) {
    return {
      link: link2,
      unlink: unlink2,
      propagate: propagate2,
      checkDirty: checkDirty2,
      shallowPropagate: shallowPropagate2
    };
    function link2(dep, sub, version) {
      let prevDep = sub.depsTail;
      if (prevDep !== void 0 && prevDep.dep === dep)
        return;
      let nextDep = prevDep !== void 0 ? prevDep.nextDep : sub.deps;
      if (nextDep !== void 0 && nextDep.dep === dep) {
        nextDep.version = version, sub.depsTail = nextDep;
        return;
      }
      let prevSub = dep.subsTail;
      if (prevSub !== void 0 && prevSub.version === version && prevSub.sub === sub)
        return;
      let newLink = sub.depsTail = dep.subsTail = {
        version,
        dep,
        sub,
        prevDep,
        nextDep,
        prevSub,
        nextSub: void 0
      };
      nextDep !== void 0 && (nextDep.prevDep = newLink), prevDep !== void 0 ? prevDep.nextDep = newLink : sub.deps = newLink, prevSub !== void 0 ? prevSub.nextSub = newLink : dep.subs = newLink;
    }
    function unlink2(link3, sub = link3.sub) {
      let dep = link3.dep, prevDep = link3.prevDep, nextDep = link3.nextDep, nextSub = link3.nextSub, prevSub = link3.prevSub;
      return nextDep !== void 0 ? nextDep.prevDep = prevDep : sub.depsTail = prevDep, prevDep !== void 0 ? prevDep.nextDep = nextDep : sub.deps = nextDep, nextSub !== void 0 ? nextSub.prevSub = prevSub : dep.subsTail = prevSub, prevSub !== void 0 ? prevSub.nextSub = nextSub : (dep.subs = nextSub) === void 0 && unwatched(dep), nextDep;
    }
    function propagate2(link3) {
      let next = link3.nextSub, stack;
      top: do {
        let sub = link3.sub, flags = sub.flags;
        if (flags & 60 ? flags & 12 ? flags & 4 ? !(flags & 48) && isValidLink(link3, sub) ? (sub.flags = flags | 40, flags &= 1) : flags = 0 : sub.flags = flags & -9 | 32 : flags = 0 : sub.flags = flags | 32, flags & 2 && notify(sub), flags & 1) {
          let subSubs = sub.subs;
          if (subSubs !== void 0) {
            let nextSub = (link3 = subSubs).nextSub;
            nextSub !== void 0 && (stack = { value: next, prev: stack }, next = nextSub);
            continue;
          }
        }
        if ((link3 = next) !== void 0) {
          next = link3.nextSub;
          continue;
        }
        for (; stack !== void 0; )
          if (link3 = stack.value, stack = stack.prev, link3 !== void 0) {
            next = link3.nextSub;
            continue top;
          }
        break;
      } while (true);
    }
    function checkDirty2(link3, sub) {
      let stack, checkDepth = 0, dirty = false;
      top: do {
        let dep = link3.dep, flags = dep.flags;
        if (sub.flags & 16)
          dirty = true;
        else if ((flags & 17) === 17) {
          if (update(dep)) {
            let subs = dep.subs;
            subs.nextSub !== void 0 && shallowPropagate2(subs), dirty = true;
          }
        } else if ((flags & 33) === 33) {
          (link3.nextSub !== void 0 || link3.prevSub !== void 0) && (stack = { value: link3, prev: stack }), link3 = dep.deps, sub = dep, ++checkDepth;
          continue;
        }
        if (!dirty) {
          let nextDep = link3.nextDep;
          if (nextDep !== void 0) {
            link3 = nextDep;
            continue;
          }
        }
        for (; checkDepth--; ) {
          let firstSub = sub.subs, hasMultipleSubs = firstSub.nextSub !== void 0;
          if (hasMultipleSubs ? (link3 = stack.value, stack = stack.prev) : link3 = firstSub, dirty) {
            if (update(sub)) {
              hasMultipleSubs && shallowPropagate2(firstSub), sub = link3.sub;
              continue;
            }
            dirty = false;
          } else
            sub.flags &= -33;
          sub = link3.sub;
          let nextDep = link3.nextDep;
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
        let sub = link3.sub, flags = sub.flags;
        (flags & 48) === 32 && (sub.flags = flags | 16, (flags & 6) === 2 && notify(sub));
      } while ((link3 = link3.nextSub) !== void 0);
    }
    function isValidLink(checkLink, sub) {
      let link3 = sub.depsTail;
      for (; link3 !== void 0; ) {
        if (link3 === checkLink)
          return true;
        link3 = link3.prevDep;
      }
      return false;
    }
  }
  var cycle = 0;
  var batchDepth = 0;
  var notifyIndex = 0;
  var queuedLength = 0;
  var activeSub;
  var queued = [];
  var { link, unlink, propagate, checkDirty, shallowPropagate } = createReactiveSystem({
    update(node) {
      return node.depsTail !== void 0 ? updateComputed(node) : updateSignal(node);
    },
    notify(effect2) {
      let insertIndex = queuedLength, firstInsertedIndex = insertIndex;
      do
        if (queued[insertIndex++] = effect2, effect2.flags &= -3, effect2 = effect2.subs?.sub, effect2 === void 0 || !(effect2.flags & 2))
          break;
      while (true);
      for (queuedLength = insertIndex; firstInsertedIndex < --insertIndex; ) {
        let left = queued[firstInsertedIndex];
        queued[firstInsertedIndex++] = queued[insertIndex], queued[insertIndex] = left;
      }
    },
    unwatched(node) {
      node.flags & 1 ? node.depsTail !== void 0 && (node.depsTail = void 0, node.flags = 17, purgeDeps(node)) : effectScopeOper.call(node);
    }
  });
  function getActiveSub() {
    return activeSub;
  }
  function setActiveSub(sub) {
    let prevSub = activeSub;
    return activeSub = sub, prevSub;
  }
  function getBatchDepth() {
    return batchDepth;
  }
  function startBatch() {
    ++batchDepth;
  }
  function endBatch() {
    --batchDepth || flush();
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
    let e = {
      fn,
      subs: void 0,
      subsTail: void 0,
      deps: void 0,
      depsTail: void 0,
      flags: 6
    }, prevSub = setActiveSub(e);
    prevSub !== void 0 && link(e, prevSub, 0);
    try {
      e.fn();
    } finally {
      activeSub = prevSub, e.flags &= -5;
    }
    return effectOper.bind(e);
  }
  function effectScope(fn) {
    let e = {
      deps: void 0,
      depsTail: void 0,
      subs: void 0,
      subsTail: void 0,
      flags: 0
    }, prevSub = setActiveSub(e);
    prevSub !== void 0 && link(e, prevSub, 0);
    try {
      fn();
    } finally {
      activeSub = prevSub;
    }
    return effectScopeOper.bind(e);
  }
  function trigger(fn) {
    let sub = {
      deps: void 0,
      depsTail: void 0,
      flags: 2
    }, prevSub = setActiveSub(sub);
    try {
      fn();
    } finally {
      activeSub = prevSub;
      let link2 = sub.deps;
      for (; link2 !== void 0; ) {
        let dep = link2.dep;
        link2 = unlink(link2, sub);
        let subs = dep.subs;
        subs !== void 0 && (sub.flags = 0, propagate(subs), shallowPropagate(subs));
      }
      batchDepth || flush();
    }
  }
  function updateComputed(c) {
    ++cycle, c.depsTail = void 0, c.flags = 5;
    let prevSub = setActiveSub(c);
    try {
      let oldValue = c.value;
      return oldValue !== (c.value = c.getter(oldValue));
    } finally {
      activeSub = prevSub, c.flags &= -5, purgeDeps(c);
    }
  }
  function updateSignal(s) {
    return s.flags = 1, s.currentValue !== (s.currentValue = s.pendingValue);
  }
  function run(e) {
    let flags = e.flags;
    if (flags & 16 || flags & 32 && checkDirty(e.deps, e)) {
      ++cycle, e.depsTail = void 0, e.flags = 6;
      let prevSub = setActiveSub(e);
      try {
        e.fn();
      } finally {
        activeSub = prevSub, e.flags &= -5, purgeDeps(e);
      }
    } else
      e.flags = 2;
  }
  function flush() {
    try {
      for (; notifyIndex < queuedLength; ) {
        let effect2 = queued[notifyIndex];
        queued[notifyIndex++] = void 0, run(effect2);
      }
    } finally {
      for (; notifyIndex < queuedLength; ) {
        let effect2 = queued[notifyIndex];
        queued[notifyIndex++] = void 0, effect2.flags |= 10;
      }
      notifyIndex = 0, queuedLength = 0;
    }
  }
  function computedOper() {
    let flags = this.flags;
    if (flags & 16 || flags & 32 && (checkDirty(this.deps, this) || (this.flags = flags & -33, false))) {
      if (updateComputed(this)) {
        let subs = this.subs;
        subs !== void 0 && shallowPropagate(subs);
      }
    } else if (!flags) {
      this.flags = 5;
      let prevSub = setActiveSub(this);
      try {
        this.value = this.getter();
      } finally {
        activeSub = prevSub, this.flags &= -5;
      }
    }
    let sub = activeSub;
    return sub !== void 0 && link(this, sub, cycle), this.value;
  }
  function signalOper(...value2) {
    if (value2.length) {
      if (this.pendingValue !== (this.pendingValue = value2[0])) {
        this.flags = 17;
        let subs = this.subs;
        subs !== void 0 && (propagate(subs), batchDepth || flush());
      }
    } else {
      if (this.flags & 16 && updateSignal(this)) {
        let subs = this.subs;
        subs !== void 0 && shallowPropagate(subs);
      }
      let sub = activeSub;
      for (; sub !== void 0; ) {
        if (sub.flags & 3) {
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
    this.depsTail = void 0, this.flags = 0, purgeDeps(this);
    let sub = this.subs;
    sub !== void 0 && unlink(sub);
  }
  function purgeDeps(sub) {
    let depsTail = sub.depsTail, dep = depsTail !== void 0 ? depsTail.nextDep : sub.deps;
    for (; dep !== void 0; )
      dep = unlink(dep, sub);
  }
  var __DEV__ = false;
  var INSTANCE_KEY = /* @__PURE__ */ Symbol.for("@getforma/core#instances");
  function registerInstance() {
    let host = globalThis, registry = host[INSTANCE_KEY] ?? (host[INSTANCE_KEY] = { count: 0, warned: false });
    registry.count += 1, registry.count > 1 && !registry.warned && (registry.warned = true, console.warn(
      `[forma] Duplicate @getforma/core instance detected (${registry.count} copies loaded). Signals, the owner tree, the component registry and the island registry are per-copy, so state created through one copy is invisible to the other. Usual causes: mixing \`import\` and \`require\` of @getforma/core in one process, or loading '@getforma/core' alongside '@getforma/core/runtime-hardened' or '@getforma/core/browser', which bundle their own private copy of the core.`
    ));
  }
  registerInstance();
  var _errorHandlers = /* @__PURE__ */ new Set();
  function onError(handler) {
    return _errorHandlers.add(handler), () => {
      _errorHandlers.delete(handler);
    };
  }
  function reportError(error, source) {
    for (let handler of _errorHandlers)
      try {
        handler(error, source ? { source } : {});
      } catch {
      }
  }
  var signalNames = /* @__PURE__ */ new WeakMap();
  function getSignalName(fn) {
    return typeof fn == "function" ? signalNames.get(fn) : void 0;
  }
  function value(v) {
    return () => v;
  }
  function applySignalSet(s, v, equals) {
    if (typeof v != "function") {
      if (!equals) {
        s(v);
        return;
      }
      let prevSub2 = setActiveSub(void 0), prev2 = s();
      if (setActiveSub(prevSub2), equals(prev2, v)) return;
      s(v), Object.is(prev2, v) && forceNotify(s);
      return;
    }
    let prevSub = setActiveSub(void 0), prev = s();
    setActiveSub(prevSub);
    let next = v(prev);
    equals && equals(prev, next) || (s(next), equals && Object.is(prev, next) && forceNotify(s));
  }
  function forceNotify(s) {
    trigger(() => {
      s();
    });
  }
  function createSignal(initialValue, options) {
    let s = signal(initialValue), getter = s;
    let eq = options?.equals;
    return [getter, (v) => applySignalSet(s, v, eq)];
  }
  var currentRoot = null;
  var rootStack = [];
  var currentOwner = null;
  function getOwner() {
    return currentOwner;
  }
  function runWithOwner(owner, fn) {
    let prev = currentOwner;
    currentOwner = owner;
    try {
      return fn();
    } finally {
      currentOwner = prev;
    }
  }
  function registerOwnerDisposer(owner, dispose) {
    owner.disposers.push(dispose);
  }
  function createChildOwner() {
    return { disposers: [] };
  }
  function disposeOwner(owner) {
    let ds = owner.disposers;
    for (let d of ds)
      try {
        d();
      } catch {
      }
    ds.length = 0;
  }
  function createRootImpl(fn, owned) {
    let scope = { disposers: [], scopeDispose: null }, parentRoot = owned ? currentRoot : null;
    rootStack.push(currentRoot), currentRoot = scope;
    let prevOwner = currentOwner;
    currentOwner = scope;
    let disposed = false, setupComplete = false, disposeRequestedDuringSetup = false, runDisposers = () => {
      for (let d of scope.disposers)
        try {
          d();
        } catch {
        }
      scope.disposers.length = 0;
    }, runTeardown = () => {
      if (scope.scopeDispose) {
        try {
          scope.scopeDispose();
        } catch {
        }
        scope.scopeDispose = null;
      }
      runDisposers();
    }, dispose = () => {
      if (!disposed) {
        if (disposed = true, !setupComplete) {
          disposeRequestedDuringSetup = true, runDisposers();
          return;
        }
        runTeardown();
      }
    };
    parentRoot && parentRoot.disposers.push(dispose);
    let result;
    try {
      if (owned)
        scope.scopeDispose = effectScope(() => {
          result = fn(dispose);
        });
      else {
        let prevSub = setActiveSub(void 0);
        try {
          scope.scopeDispose = effectScope(() => {
            result = fn(dispose);
          });
        } finally {
          setActiveSub(prevSub);
        }
      }
      setupComplete = true, disposeRequestedDuringSetup && runTeardown();
    } finally {
      currentRoot = rootStack.pop() ?? null, currentOwner = prevOwner;
    }
    return result;
  }
  function createRoot(fn) {
    return createRootImpl(fn, true);
  }
  function createUnownedRoot(fn) {
    return createRootImpl(fn, false);
  }
  function registerDisposer(dispose) {
    currentOwner && currentOwner.disposers.push(dispose);
  }
  function hasActiveRoot() {
    return currentOwner !== null;
  }
  var currentCleanupCollector = null;
  function onCleanup(fn) {
    currentCleanupCollector?.(fn);
  }
  function setCleanupCollector(collector) {
    let prev = currentCleanupCollector;
    return currentCleanupCollector = collector, prev;
  }
  var POOL_SIZE = 32;
  var MAX_REENTRANT_RUNS = 100;
  var pool = [];
  for (let i = 0; i < POOL_SIZE; i++) pool.push([]);
  var poolIdx = POOL_SIZE;
  var PENDING = 32;
  function acquireArray() {
    if (poolIdx > 0) {
      let arr = pool[--poolIdx];
      return arr.length = 0, arr;
    }
    return [];
  }
  function releaseArray(arr) {
    arr.length = 0, poolIdx < POOL_SIZE && (pool[poolIdx++] = arr);
  }
  function runCleanup(fn) {
    if (fn !== void 0)
      try {
        fn();
      } catch (e) {
        reportError(e, "effect cleanup");
      }
  }
  function runCleanups(bag) {
    if (bag !== void 0)
      for (let i = 0; i < bag.length; i++)
        try {
          bag[i]();
        } catch (e) {
          reportError(e, "effect cleanup");
        }
  }
  function internalEffect(fn) {
    let firstRun = true, dispose = effect(() => {
      if (firstRun) {
        firstRun = false, fn();
        return;
      }
      try {
        fn();
      } catch (e) {
        reportError(e, "binding");
      }
    });
    return hasActiveRoot() && registerDisposer(dispose), dispose;
  }
  function createEffect(fn) {
    let ownerAtCreate = getOwner(), childOwner = createChildOwner(), cleanup2, cleanupBag, nextCleanup, nextCleanupBag, addCleanup = (cb) => {
      if (nextCleanupBag !== void 0) {
        nextCleanupBag.push(cb);
        return;
      }
      if (nextCleanup !== void 0) {
        let bag = acquireArray();
        bag.push(nextCleanup, cb), nextCleanup = void 0, nextCleanupBag = bag;
        return;
      }
      nextCleanup = cb;
    }, runOnce = () => {
      disposeOwner(childOwner), cleanup2 !== void 0 && (runCleanup(cleanup2), cleanup2 = void 0), cleanupBag !== void 0 && (runCleanups(cleanupBag), releaseArray(cleanupBag), cleanupBag = void 0), nextCleanup = void 0, nextCleanupBag = void 0;
      let prevCollector = setCleanupCollector(addCleanup);
      try {
        let result = runWithOwner(childOwner, fn);
        typeof result == "function" && addCleanup(result), nextCleanupBag !== void 0 ? cleanupBag = nextCleanupBag : nextCleanup !== void 0 && (cleanup2 = nextCleanup);
      } catch (e) {
        reportError(e, "effect"), nextCleanupBag !== void 0 ? cleanupBag = nextCleanupBag : nextCleanup !== void 0 && (cleanup2 = nextCleanup);
      } finally {
        setCleanupCollector(prevCollector);
      }
    }, dispose = effect(() => {
      let node = getActiveSub(), reentrantRuns = 0;
      do {
        if (node && (node.flags &= ~PENDING), runOnce(), node === void 0 || (node.flags & PENDING) === 0) break;
        if (++reentrantRuns >= MAX_REENTRANT_RUNS) {
          node.flags &= ~PENDING, reportError(
            new Error(`createEffect exceeded ${MAX_REENTRANT_RUNS} self-triggered re-runs (cycle?)`),
            "effect"
          );
          break;
        }
      } while (true);
    }), disposed = false, wrappedDispose = () => {
      disposed || (disposed = true, dispose(), disposeOwner(childOwner), cleanup2 !== void 0 && (runCleanup(cleanup2), cleanup2 = void 0), cleanupBag !== void 0 && (runCleanups(cleanupBag), releaseArray(cleanupBag), cleanupBag = void 0));
    };
    return ownerAtCreate && registerOwnerDisposer(ownerAtCreate, wrappedDispose), wrappedDispose;
  }
  var ERR = /* @__PURE__ */ Symbol("formaComputedError");
  function isErrBox(v) {
    return typeof v == "object" && v !== null && ERR in v;
  }
  function createComputed(fn) {
    let errored = false, error, lastGood, raw = computed(() => {
      try {
        let v = fn(lastGood);
        return errored = false, error = void 0, lastGood = v, v;
      } catch (e) {
        return errored = true, error = e, reportError(e, "computed"), { [ERR]: e };
      }
    }), reader = () => {
      let v = raw();
      if (errored || isErrBox(v)) throw error;
      return v;
    };
    return Object.defineProperty(reader, "name", { value: raw.name, configurable: true }), reader;
  }
  var createMemo = createComputed;
  function batch(fn) {
    startBatch();
    try {
      fn();
    } finally {
      endBatch();
    }
  }
  function untrack(fn) {
    let prev = setActiveSub(void 0);
    try {
      return fn();
    } finally {
      setActiveSub(prev);
    }
  }
  function on(deps, fn, options) {
    let prev, isFirst = true;
    return () => {
      let value2 = deps();
      if (options?.defer && isFirst) {
        isFirst = false, prev = value2;
        return;
      }
      let result = untrack(() => fn(value2, prev));
      return prev = value2, result;
    };
  }
  function createRef(initialValue) {
    return { current: initialValue };
  }
  function createReducer(reducer, initialState) {
    let [state, setState] = createSignal(initialState);
    return [state, (action) => {
      setState((prev) => reducer(prev, action));
    }];
  }
  var currentSuspenseContext = null;
  var suspenseStack = [];
  function pushSuspenseContext(ctx) {
    suspenseStack.push(currentSuspenseContext), currentSuspenseContext = ctx;
  }
  function popSuspenseContext() {
    currentSuspenseContext = suspenseStack.pop() ?? null;
  }
  function getSuspenseContext() {
    return currentSuspenseContext;
  }
  function createResource(source, fetcher, options) {
    let [data, setData] = createSignal(options?.initialValue), [loading, setLoading] = createSignal(false), [error, setError] = createSignal(void 0), suspenseCtx = getSuspenseContext(), abortController = null, fetchVersion = 0, doFetch = () => {
      let sourceValue = untrack(source);
      abortController && abortController.abort();
      let controller = new AbortController();
      abortController = controller;
      let version = ++fetchVersion, isLatest = () => version === fetchVersion, suspensePending = false;
      suspenseCtx && (suspenseCtx.increment(), suspensePending = true), batch(() => {
        setLoading(true), setError(void 0);
      });
      let promise;
      try {
        promise = Promise.resolve(fetcher(sourceValue, { signal: controller.signal }));
      } catch (err) {
        promise = Promise.reject(err);
      }
      promise.then((result) => {
        isLatest() && !controller.signal.aborted && batch(() => {
          setData(() => result), setLoading(false);
        });
      }).catch((err) => {
        isLatest() && !controller.signal.aborted && err?.name !== "AbortError" && batch(() => {
          setError(err), setLoading(false);
        });
      }).finally(() => {
        suspensePending && suspenseCtx?.decrement(), isLatest() && abortController === controller && (abortController = null);
      });
    };
    internalEffect(() => {
      source(), doFetch();
    }), hasActiveRoot() && registerDisposer(() => {
      fetchVersion++, abortController && (abortController.abort(), abortController = null);
    });
    let resource = (() => data());
    return resource.loading = loading, resource.error = error, resource.refetch = doFetch, resource.mutate = (value2) => setData(() => value2), resource;
  }
  var FORBIDDEN_PROP_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  var scheduledOrActiveIslands = 0;
  function trackIsland(el) {
    el.__formaTracked || (el.__formaTracked = true, scheduledOrActiveIslands++);
  }
  function untrackIsland(el) {
    el.__formaTracked && (delete el.__formaTracked, scheduledOrActiveIslands--);
  }
  function hasScheduledOrActiveIslands() {
    return scheduledOrActiveIslands > 0;
  }
  function sanitizeProps(obj) {
    for (let key of FORBIDDEN_PROP_KEYS)
      key in obj && delete obj[key];
    return obj;
  }
  function sanitizePropsDeep(props) {
    let stack = [props], seen = /* @__PURE__ */ new WeakSet();
    for (; stack.length > 0; ) {
      let current = stack.pop();
      if (!(current === null || typeof current != "object") && !seen.has(current)) {
        seen.add(current);
        for (let key of FORBIDDEN_PROP_KEYS)
          Object.prototype.hasOwnProperty.call(current, key) && Object.getOwnPropertyDescriptor(current, key)?.configurable && delete current[key];
        for (let k of Object.keys(current))
          stack.push(current[k]);
      }
    }
    return props;
  }
  function loadIslandProps(root, id, sharedProps) {
    let inline = root.getAttribute("data-forma-props");
    return inline ? sanitizeProps(JSON.parse(inline)) : sharedProps && String(id) in sharedProps ? sanitizeProps(sharedProps[String(id)]) : null;
  }
  function loadSharedProps(root) {
    let scriptBlock = root.querySelector("script#__forma_islands") ?? (root === document ? null : document.querySelector("script#__forma_islands"));
    if (!scriptBlock) return null;
    try {
      let parsed = JSON.parse(scriptBlock.textContent ?? "");
      return parsed !== null && typeof parsed == "object" ? parsed : null;
    } catch (err) {
      return null;
    }
  }
  function activateIslands(registry, root = document) {
    let sharedProps = loadSharedProps(root), islands = root.querySelectorAll("[data-forma-island]");
    for (let island of islands) {
      let status = island.getAttribute("data-forma-status");
      if (status === "active" || status === "hydrating" || status === "disposed" || status === "error" || island.__formaScheduled) continue;
      delete island.__formaDisposed;
      let id = parseInt(island.getAttribute("data-forma-island"), 10), componentName = island.getAttribute("data-forma-component"), hydrateFn = registry[componentName];
      if (!hydrateFn) {
        island.setAttribute("data-forma-status", "error");
        continue;
      }
      trackIsland(island);
      let trigger2 = island.getAttribute("data-forma-hydrate") || "load";
      if (trigger2 === "visible") {
        island.__formaScheduled = true;
        let observer = new IntersectionObserver(
          (entries) => {
            for (let entry of entries)
              entry.isIntersecting && (observer.disconnect(), delete island.__formaObserver, hydrateIslandRoot(island, id, componentName, hydrateFn, sharedProps));
          },
          { rootMargin: "200px" }
        );
        island.__formaObserver = observer, observer.observe(island);
      } else if (trigger2 === "idle") {
        island.__formaScheduled = true;
        let hydrate = () => hydrateIslandRoot(island, id, componentName, hydrateFn, sharedProps);
        if (typeof requestIdleCallback == "function") {
          let handle = requestIdleCallback(hydrate);
          island.__formaIdleCancel = () => cancelIdleCallback(handle);
        } else {
          let handle = setTimeout(hydrate, 200);
          island.__formaIdleCancel = () => clearTimeout(handle);
        }
      } else if (trigger2 === "interaction") {
        island.__formaScheduled = true;
        let hydrate = () => {
          island.removeEventListener("pointerdown", hydrate, true), island.removeEventListener("focusin", hydrate, true), delete island.__formaInteractionHandler, hydrateIslandRoot(island, id, componentName, hydrateFn, sharedProps);
        };
        island.__formaInteractionHandler = hydrate, island.addEventListener("pointerdown", hydrate, { capture: true, once: true }), island.addEventListener("focusin", hydrate, { capture: true, once: true });
      } else
        hydrateIslandRoot(island, id, componentName, hydrateFn, sharedProps);
    }
  }
  function deactivateIsland(el) {
    let observer = el.__formaObserver;
    observer && (observer.disconnect(), delete el.__formaObserver);
    let interactionHandler = el.__formaInteractionHandler;
    interactionHandler && (el.removeEventListener("pointerdown", interactionHandler, true), el.removeEventListener("focusin", interactionHandler, true), delete el.__formaInteractionHandler);
    let idleCancel = el.__formaIdleCancel;
    idleCancel && (idleCancel(), delete el.__formaIdleCancel), delete el.__formaScheduled, untrackIsland(el), el.__formaDisposed = true;
    let dispose = el.__formaDispose;
    typeof dispose == "function" && (dispose(), delete el.__formaDispose, el.setAttribute("data-forma-status", "disposed"));
  }
  function deactivateAllIslands(root = document) {
    let islands = root.querySelectorAll("[data-forma-island]");
    for (let island of islands)
      deactivateIsland(island);
  }
  function hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps) {
    if (root.__formaDisposed) return;
    let disposeRoot;
    try {
      delete root.__formaScheduled;
      let props = loadIslandProps(root, id, sharedProps);
      root.setAttribute("data-forma-status", "hydrating");
      let activeRoot = root;
      createUnownedRoot((dispose) => {
        disposeRoot = dispose, root.__formaDispose = dispose, activeRoot = hydrateIsland(() => hydrateFn(root, props), root), activeRoot !== root && (delete root.__formaDispose, activeRoot.__formaDispose = dispose, untrackIsland(root), trackIsland(activeRoot));
      }), activeRoot.setAttribute("data-forma-status", "active");
    } catch (err) {
      if (disposeRoot) {
        try {
          disposeRoot();
        } catch {
        }
        delete root.__formaDispose;
      }
      untrackIsland(root), root.setAttribute("data-forma-status", "error");
    }
  }
  function longestIncreasingSubsequence(arr) {
    let n = arr.length;
    if (n === 0) return [];
    let tails = new Int32Array(n), tailIndices = new Int32Array(n), predecessor = new Int32Array(n).fill(-1), tailsLen = 0;
    for (let i = 0; i < n; i++) {
      let val = arr[i], lo = 0, hi = tailsLen;
      for (; lo < hi; ) {
        let mid = lo + hi >> 1;
        tails[mid] < val ? lo = mid + 1 : hi = mid;
      }
      tails[lo] = val, tailIndices[lo] = i, lo > 0 && (predecessor[i] = tailIndices[lo - 1]), lo >= tailsLen && tailsLen++;
    }
    let result = new Array(tailsLen), idx = tailIndices[tailsLen - 1];
    for (let i = tailsLen - 1; i >= 0; i--)
      result[i] = idx, idx = predecessor[idx];
    return result;
  }
  var SMALL_LIST_THRESHOLD = 32;
  var ABORT_SYM = /* @__PURE__ */ Symbol.for("forma-abort");
  var CACHE_SYM = /* @__PURE__ */ Symbol.for("forma-attr-cache");
  var DYNAMIC_CHILD_SYM = /* @__PURE__ */ Symbol.for("forma-dynamic-child");
  function deactivateIslandsIn(node) {
    if (hasScheduledOrActiveIslands() && node instanceof Element) {
      node.hasAttribute("data-forma-island") && deactivateIsland(node);
      for (let nested of node.querySelectorAll("[data-forma-island]"))
        deactivateIsland(nested);
    }
  }
  function removeRow(parent2, node, hooks) {
    if (hooks?.onBeforeRemove) {
      hooks.onBeforeRemove(node, () => {
        deactivateIslandsIn(node), node.parentNode && node.parentNode.removeChild(node);
      });
      return;
    }
    deactivateIslandsIn(node), parent2.removeChild(node);
  }
  function canPatchStaticElement(target, source) {
    return target instanceof HTMLElement && source instanceof HTMLElement && target.tagName === source.tagName && !target[ABORT_SYM] && !target[CACHE_SYM] && !target[DYNAMIC_CHILD_SYM] && !source[ABORT_SYM] && !source[CACHE_SYM] && !source[DYNAMIC_CHILD_SYM];
  }
  function patchStaticElement(target, source) {
    let sourceAttrNames = /* @__PURE__ */ new Set();
    for (let attr of Array.from(source.attributes))
      sourceAttrNames.add(attr.name), target.getAttribute(attr.name) !== attr.value && target.setAttribute(attr.name, attr.value);
    for (let attr of Array.from(target.attributes))
      sourceAttrNames.has(attr.name) || target.removeAttribute(attr.name);
    target.replaceChildren(...Array.from(source.childNodes));
  }
  function reconcileSmall(parent2, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks) {
    let oldLen = oldItems.length, newLen = newItems.length, oldKeys = new Array(oldLen);
    for (let i = 0; i < oldLen; i++)
      oldKeys[i] = keyFn(oldItems[i]);
    let oldIndices = new Array(newLen), oldUsed = new Uint8Array(oldLen);
    for (let i = 0; i < newLen; i++) {
      let key = keyFn(newItems[i]), found = -1;
      for (let j = 0; j < oldLen; j++)
        if (!oldUsed[j] && oldKeys[j] === key) {
          found = j, oldUsed[j] = 1;
          break;
        }
      oldIndices[i] = found;
    }
    for (let i = 0; i < oldLen; i++)
      oldUsed[i] || removeRow(parent2, oldNodes[i], hooks);
    if (oldLen === newLen) {
      let allSameOrder = true;
      for (let i = 0; i < newLen; i++)
        if (oldIndices[i] !== i) {
          allSameOrder = false;
          break;
        }
      if (allSameOrder) {
        let nodes = new Array(newLen);
        for (let i = 0; i < newLen; i++) {
          let node = oldNodes[i];
          updateFn(node, newItems[i]), nodes[i] = node;
        }
        return { nodes, items: newItems };
      }
    }
    let reusedIndices = [], reusedPositions = [];
    for (let i = 0; i < newLen; i++)
      oldIndices[i] !== -1 && (reusedIndices.push(oldIndices[i]), reusedPositions.push(i));
    let lisOfReused = longestIncreasingSubsequence(reusedIndices), lisFlags = new Uint8Array(newLen);
    for (let li of lisOfReused)
      lisFlags[reusedPositions[li]] = 1;
    let newNodes = new Array(newLen), nextSibling2 = beforeNode ?? null;
    for (let i = newLen - 1; i >= 0; i--) {
      let node, isNew = false;
      if (oldIndices[i] === -1)
        node = createFn(newItems[i]), isNew = true;
      else if (node = oldNodes[oldIndices[i]], updateFn(node, newItems[i]), lisFlags[i]) {
        newNodes[i] = node, nextSibling2 = node;
        continue;
      }
      nextSibling2 ? parent2.insertBefore(node, nextSibling2) : parent2.appendChild(node), isNew && hooks?.onInsert?.(node), newNodes[i] = node, nextSibling2 = node;
    }
    return { nodes: newNodes, items: newItems };
  }
  function reconcileList(parent2, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks) {
    let oldLen = oldItems.length, newLen = newItems.length;
    if (newLen === 0) {
      for (let i = 0; i < oldLen; i++)
        removeRow(parent2, oldNodes[i], hooks);
      return { nodes: [], items: [] };
    }
    if (oldLen === 0) {
      let nodes = new Array(newLen);
      for (let i = 0; i < newLen; i++) {
        let node = createFn(newItems[i]);
        beforeNode ? parent2.insertBefore(node, beforeNode) : parent2.appendChild(node), hooks?.onInsert?.(node), nodes[i] = node;
      }
      return { nodes, items: newItems };
    }
    if (oldLen < SMALL_LIST_THRESHOLD)
      return reconcileSmall(parent2, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks);
    let oldKeyMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < oldLen; i++) {
      let k = keyFn(oldItems[i]), bucket = oldKeyMap.get(k);
      bucket ? bucket.push(i) : oldKeyMap.set(k, [i]);
    }
    let oldIndices = new Array(newLen), oldUsed = new Uint8Array(oldLen);
    for (let i = 0; i < newLen; i++) {
      let key = keyFn(newItems[i]), bucket = oldKeyMap.get(key);
      if (bucket && bucket.length > 0) {
        let oldIdx = bucket.shift();
        oldIndices[i] = oldIdx, oldUsed[oldIdx] = 1;
      } else
        oldIndices[i] = -1;
    }
    for (let i = 0; i < oldLen; i++)
      oldUsed[i] || removeRow(parent2, oldNodes[i], hooks);
    if (oldLen === newLen) {
      let allSameOrder = true;
      for (let i = 0; i < newLen; i++)
        if (oldIndices[i] !== i) {
          allSameOrder = false;
          break;
        }
      if (allSameOrder) {
        let nodes = new Array(newLen);
        for (let i = 0; i < newLen; i++) {
          let node = oldNodes[i];
          updateFn(node, newItems[i]), nodes[i] = node;
        }
        return { nodes, items: newItems };
      }
    }
    let reusedIndices = [], reusedPositions = [];
    for (let i = 0; i < newLen; i++)
      oldIndices[i] !== -1 && (reusedIndices.push(oldIndices[i]), reusedPositions.push(i));
    let lisOfReused = longestIncreasingSubsequence(reusedIndices), lisFlags = new Uint8Array(newLen);
    for (let li of lisOfReused)
      lisFlags[reusedPositions[li]] = 1;
    let newNodes = new Array(newLen), nextSibling2 = beforeNode ?? null;
    for (let i = newLen - 1; i >= 0; i--) {
      let node, isNew = false;
      if (oldIndices[i] === -1)
        node = createFn(newItems[i]), isNew = true;
      else if (node = oldNodes[oldIndices[i]], updateFn(node, newItems[i]), lisFlags[i]) {
        newNodes[i] = node, nextSibling2 = node;
        continue;
      }
      nextSibling2 ? parent2.insertBefore(node, nextSibling2) : parent2.appendChild(node), isNew && hooks?.onInsert?.(node), newNodes[i] = node, nextSibling2 = node;
    }
    return { nodes: newNodes, items: newItems };
  }
  function createList(items, keyFn, renderFn, options) {
    if (hydrating)
      return { type: "list", items, keyFn, renderFn, options };
    let startMarker = document.createComment("forma-list-start"), endMarker = document.createComment("forma-list-end"), fragment2 = document.createDocumentFragment();
    fragment2.appendChild(startMarker), fragment2.appendChild(endMarker);
    let cache2 = /* @__PURE__ */ new Map(), currentNodes = [], currentItems = [], updateOnItemChange = options?.updateOnItemChange ?? "none";
    return internalEffect(() => {
      let newItems = items(), parent2 = startMarker.parentNode;
      if (!parent2)
        return;
      if (!Array.isArray(newItems)) {
        __DEV__ && console.warn("[forma] createList: value is not an array, treating as empty");
        for (let node of currentNodes)
          node.parentNode === parent2 && (deactivateIslandsIn(node), parent2.removeChild(node));
        cache2 = /* @__PURE__ */ new Map(), currentNodes = [], currentItems = [];
        return;
      }
      let cleanItems = newItems;
      for (let i = 0; i < newItems.length; i++)
        if (newItems[i] == null) {
          cleanItems = newItems.filter((item) => item != null);
          break;
        }
      if (__DEV__) ;
      let updateRow = updateOnItemChange === "rerender" ? (node, item) => {
        let key = keyFn(item), cached = cache2.get(key);
        if (!cached || cached.item === item || (cached.item = item, !(node instanceof HTMLElement)) || node[ABORT_SYM] || node[CACHE_SYM] || node[DYNAMIC_CHILD_SYM])
          return;
        let next = untrack(() => renderFn(item, cached.getIndex));
        canPatchStaticElement(node, next) && (patchStaticElement(node, next), cached.element = node);
      } : (_node, item) => {
        let key = keyFn(item), cached = cache2.get(key);
        cached && (cached.item = item);
      }, oldCache = cache2, result = reconcileList(
        parent2,
        currentItems,
        cleanItems,
        currentNodes,
        keyFn,
        // createFn: create element + cache entry.
        // Each item is rendered inside createRoot + untrack so that inner
        // effects are owned by the item's root (not the parent), and are
        // disposed when the item is removed from the list.
        (item) => {
          let key = keyFn(item), [getIndex, setIndex] = createSignal(0), itemDispose, element = createRoot((dispose) => (itemDispose = dispose, untrack(() => renderFn(item, getIndex))));
          return cache2.set(key, { element, item, getIndex, setIndex, dispose: itemDispose }), element;
        },
        updateRow,
        // beforeNode: insert items before the end marker
        endMarker
      ), newCache = /* @__PURE__ */ new Map();
      for (let i = 0; i < cleanItems.length; i++) {
        let key = keyFn(cleanItems[i]), cached = oldCache.get(key);
        cached && (cached.setIndex(i), newCache.set(key, cached));
      }
      for (let [key, cached] of oldCache)
        newCache.has(key) || cached.dispose();
      cache2 = newCache, currentNodes = result.nodes, currentItems = result.items;
    }), registerDisposer(() => {
      for (let cached of cache2.values())
        cached.dispose();
      cache2 = /* @__PURE__ */ new Map(), currentNodes = [], currentItems = [];
    }), fragment2;
  }
  function createShow(when, thenFn, elseFn = () => null) {
    if (hydrating) {
      let branch = when() ? thenFn() : elseFn();
      return {
        type: "show",
        condition: when,
        whenTrue: thenFn,
        whenFalse: elseFn,
        initialBranch: branch
      };
    }
    let startMarker = document.createComment("forma-show"), endMarker = document.createComment("/forma-show"), fragment2 = document.createDocumentFragment();
    fragment2.appendChild(startMarker), fragment2.appendChild(endMarker);
    let currentNode = null, lastTruthy = null, currentDispose = null, showDispose = internalEffect(() => {
      let truthy = !!when(), DEBUG = typeof globalThis.__FORMA_DEBUG__ < "u", DEBUG_LABEL = DEBUG ? thenFn.toString().slice(0, 60) : "";
      if (truthy === lastTruthy) {
        DEBUG && console.log("[forma:show] skip (same)", truthy, DEBUG_LABEL);
        return;
      }
      DEBUG && console.log("[forma:show]", lastTruthy, "\u2192", truthy, DEBUG_LABEL), lastTruthy = truthy;
      let parent2 = startMarker.parentNode;
      if (!parent2) {
        DEBUG && console.warn("[forma:show] parentNode is null! skipping.", DEBUG_LABEL);
        return;
      }
      if (DEBUG && console.log("[forma:show] parent:", parent2.nodeName, "inDoc:", document.contains(parent2)), currentDispose && (currentDispose(), currentDispose = null), currentNode)
        if (currentNode.parentNode === parent2)
          parent2.removeChild(currentNode);
        else
          for (; startMarker.nextSibling && startMarker.nextSibling !== endMarker; )
            parent2.removeChild(startMarker.nextSibling);
      let branchFn = truthy ? thenFn : elseFn;
      if (branchFn) {
        let branchDispose;
        currentNode = createRoot((dispose) => (branchDispose = dispose, untrack(() => branchFn()))), currentDispose = branchDispose;
      } else
        currentNode = null;
      currentNode && parent2.insertBefore(currentNode, endMarker);
    });
    return registerDisposer(() => {
      currentDispose && (currentDispose(), currentDispose = null), currentNode = null;
    }), fragment2.__showDispose = () => {
      showDispose(), currentDispose && (currentDispose(), currentDispose = null);
    }, fragment2;
  }
  var URL_IGNORED_CHARS_RE = /[\u0000-\u0020\u007F-\u009F]/g;
  var DANGEROUS_SCHEME_RE = /^(?:javascript|vbscript|data:text\/html)/i;
  var SVG_DATA_URL_RE = /^data:image\/svg\+xml/i;
  var IMAGE_CONTEXT_TAGS = /* @__PURE__ */ new Set([
    "img",
    "image",
    "video",
    "audio",
    "source",
    "body",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th"
  ]);
  var URL_ATTRS = /* @__PURE__ */ new Set([
    "href",
    "src",
    "action",
    "formaction",
    "xlink:href",
    "poster",
    "background",
    "data"
  ]);
  function isUrlAttr(name) {
    return URL_ATTRS.has(name.toLowerCase());
  }
  function isDangerousUrl(value2, tag) {
    let normalized = value2.replace(URL_IGNORED_CHARS_RE, "");
    return DANGEROUS_SCHEME_RE.test(normalized) ? true : SVG_DATA_URL_RE.test(normalized) ? tag === void 0 || !IMAGE_CONTEXT_TAGS.has(tag.toLowerCase()) : false;
  }
  function isEventHandlerAttr(name) {
    return /^on/i.test(name);
  }
  function isUnsafeAttrWrite(tag, name, value2) {
    return isEventHandlerAttr(name) ? true : isUrlAttr(name) && isDangerousUrl(value2, tag);
  }
  var ABORT_SYM2 = /* @__PURE__ */ Symbol.for("forma-abort");
  var hydrating = false;
  function setHydrating(value2) {
    hydrating = value2;
  }
  function isDescriptor(v) {
    return v != null && typeof v == "object" && "type" in v && v.type === "element";
  }
  function isShowDescriptor(v) {
    return v != null && typeof v == "object" && "type" in v && v.type === "show";
  }
  function isListDescriptor(v) {
    return v != null && typeof v == "object" && "type" in v && v.type === "list";
  }
  var KIND_TEXT = 116;
  var KIND_SHOW = 115;
  var KIND_LIST = 108;
  var KIND_ISLAND = 105;
  function markerIndex(data, kind, offset) {
    if (data.charCodeAt(offset) !== 102 || data.charCodeAt(offset + 1) !== 58 || data.charCodeAt(offset + 2) !== kind)
      return -1;
    let first = offset + 3;
    if (data.length <= first) return -1;
    let idx = 0;
    for (let i = first; i < data.length; i++) {
      let c = data.charCodeAt(i);
      if (c < 48 || c > 57) return -1;
      idx = idx * 10 + (c - 48);
    }
    return idx;
  }
  var PROP_TO_ATTR = {
    className: "class",
    htmlFor: "for",
    tabIndex: "tabindex"
  };
  function applyDynamicProps(el, props) {
    if (!props) return;
    let ref = null;
    for (let key in props) {
      let value2 = props[key];
      if (key === "ref") {
        typeof value2 == "function" && (ref = value2);
        continue;
      }
      if (typeof value2 != "function") continue;
      if (key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && key.length > 2) {
        let ac = el[ABORT_SYM2];
        ac || (ac = new AbortController(), el[ABORT_SYM2] = ac), el.addEventListener(key.slice(2).toLowerCase(), value2, { signal: ac.signal });
        continue;
      }
      let attrKey = PROP_TO_ATTR[key] ?? key;
      if (isEventHandlerAttr(attrKey)) {
        el.removeAttribute(attrKey);
        continue;
      }
      let fn = value2, tag = el.localName;
      internalEffect(() => {
        let v = fn();
        if (v === false || v == null)
          el.removeAttribute(attrKey);
        else if (v === true)
          el.setAttribute(attrKey, "");
        else {
          let str = String(v);
          if (isUnsafeAttrWrite(tag, attrKey, str)) {
            __DEV__ && console.warn(`[forma] Hydration: dropped "${attrKey}" on <${tag}> (unsafe-URL)`), el.removeAttribute(attrKey);
            return;
          }
          el.setAttribute(attrKey, str);
        }
      });
    }
    ref && ref(el);
  }
  function ensureNode(value2) {
    if (value2 instanceof Node) return value2;
    if (value2 == null || value2 === false || value2 === true) return null;
    if (typeof value2 == "string") return new Text(value2);
    if (typeof value2 == "number") return new Text(String(value2));
    if (isDescriptor(value2)) return descriptorToElement(value2);
    if (isShowDescriptor(value2)) {
      let prevH = hydrating;
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
      let prevH = hydrating;
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
    let prevHydrating = hydrating;
    hydrating = false;
    try {
      let children2 = desc.children.map((child) => isDescriptor(child) ? descriptorToElement(child) : isShowDescriptor(child) || isListDescriptor(child) ? ensureNode(child) : child);
      return h(desc.tag, desc.props, ...children2);
    } finally {
      hydrating = prevHydrating;
    }
  }
  function isIslandStart(data) {
    return markerIndex(data, KIND_ISLAND, 0) >= 0;
  }
  function isShowStart(data) {
    return markerIndex(data, KIND_SHOW, 0) >= 0;
  }
  function isTextStart(data) {
    return markerIndex(data, KIND_TEXT, 0) >= 0;
  }
  function isListStart(data) {
    return markerIndex(data, KIND_LIST, 0) >= 0;
  }
  function findClosingMarker(start) {
    let closing = "/" + start.data, node = start.nextSibling;
    for (; node; ) {
      if (node.nodeType === 8 && node.data === closing)
        return node;
      node = node.nextSibling;
    }
    return null;
  }
  function findTextBetween(start, end) {
    let node = start.nextSibling;
    for (; node && node !== end; ) {
      if (node.nodeType === 3) return node;
      node = node.nextSibling;
    }
    return null;
  }
  function nextElementBetweenMarkers(start, end) {
    let node = start.nextSibling;
    for (; node && node !== end; ) {
      if (node.nodeType === 1) return node;
      node = node.nextSibling;
    }
  }
  function extractContentBetweenMarkers(start, end) {
    let frag = document.createDocumentFragment(), node = start.nextSibling;
    for (; node && node !== end; ) {
      let next = node.nextSibling;
      frag.appendChild(node), node = next;
    }
    return frag;
  }
  function adoptShowRegion(desc, start, end) {
    let adoptedDispose = null;
    desc.initialBranch != null && (adoptedDispose = createRoot((dispose) => (adoptBranchContent(desc.initialBranch, start, end), dispose))), setupShowEffect(desc, start, end, adoptedDispose);
  }
  function setupShowEffect(desc, start, end, adoptedDispose) {
    let currentCondition = !!untrack(() => desc.condition()), thenFragment = null, thenDispose = null, elseFragment = null, elseDispose = null, currentDispose = adoptedDispose, holdingSSR = start.nextSibling !== end, renderBranch = (cond) => {
      let factory = cond ? desc.whenTrue : desc.whenFalse;
      if (!factory) return null;
      let branchDispose, node = createRoot((dispose) => (branchDispose = dispose, untrack(() => {
        let raw = factory();
        return raw instanceof Node ? raw : ensureNode(raw);
      })));
      return node ? (currentDispose = branchDispose, node) : (branchDispose(), null);
    };
    if (holdingSSR && desc.initialBranch == null)
      extractContentBetweenMarkers(start, end), currentDispose && (currentDispose(), currentDispose = null), holdingSSR = false;
    else if (!holdingSSR && desc.initialBranch != null) {
      let branch = renderBranch(currentCondition);
      branch && start.parentNode.insertBefore(branch, end);
    }
    internalEffect(() => {
      let next = !!desc.condition();
      if (next === currentCondition) return;
      currentCondition = next;
      let parent2 = start.parentNode;
      if (!parent2) return;
      let leaving = extractContentBetweenMarkers(start, end);
      holdingSSR ? (holdingSSR = false, currentDispose && currentDispose()) : next ? (elseFragment = leaving, elseDispose = currentDispose) : (thenFragment = leaving, thenDispose = currentDispose), currentDispose = null;
      let branch;
      next ? thenFragment ? (branch = thenFragment, currentDispose = thenDispose, thenFragment = null, thenDispose = null) : branch = renderBranch(true) : elseFragment ? (branch = elseFragment, currentDispose = elseDispose, elseFragment = null, elseDispose = null) : branch = renderBranch(false), branch && parent2.insertBefore(branch, end);
    }), registerDisposer(() => {
      currentDispose && currentDispose(), thenDispose && thenDispose(), elseDispose && elseDispose(), currentDispose = thenDispose = elseDispose = null, thenFragment = elseFragment = null;
    });
  }
  function adoptRow(renderFn, item, getIndex, rowEl) {
    let prevHydrating = hydrating;
    hydrating = true;
    let rendered;
    try {
      rendered = untrack(() => renderFn(item, getIndex));
    } finally {
      hydrating = prevHydrating;
    }
    if (!isDescriptor(rendered)) return rowEl;
    if (rowEl.tagName !== rendered.tag.toUpperCase()) {
      let fresh = descriptorToElement(rendered);
      return rowEl.replaceWith(fresh), fresh;
    }
    return adoptNode(rendered, rowEl), rowEl;
  }
  function adoptListRegion(desc, start, end) {
    let listKeyFn = desc.keyFn, listRenderFn = desc.renderFn, ssrKeyMap = /* @__PURE__ */ new Map(), ssrElements = [], duplicateRows = [], node = start.nextSibling;
    for (; node && node !== end; ) {
      if (node.nodeType === 1) {
        let el = node, key = el.getAttribute("data-forma-key");
        key != null && ssrKeyMap.has(key) ? duplicateRows.push(el) : (ssrElements.push(el), key != null && ssrKeyMap.set(key, el));
      }
      node = node.nextSibling;
    }
    for (let dup of duplicateRows)
      dup.parentNode && dup.parentNode.removeChild(dup);
    let currentItems = untrack(() => desc.items()), useIndexFallback = ssrKeyMap.size === 0 && ssrElements.length > 0, cache2 = /* @__PURE__ */ new Map(), adoptedNodes = [], adoptedItems = [], usedIndices = /* @__PURE__ */ new Set();
    for (let i = 0; i < currentItems.length; i++) {
      let item = currentItems[i], key = listKeyFn(item), ssrNode;
      useIndexFallback ? i < ssrElements.length && (ssrNode = ssrElements[i], usedIndices.add(i)) : (ssrNode = ssrKeyMap.get(String(key)), ssrNode && ssrKeyMap.delete(String(key)));
      let [getIndex, setIndex] = createSignal(i), rowDispose, element;
      if (ssrNode) {
        let row = ssrNode;
        element = createRoot((dispose) => (rowDispose = dispose, adoptRow(listRenderFn, item, getIndex, row)));
      } else {
        let prevHydrating = hydrating;
        hydrating = false;
        try {
          element = createRoot((dispose) => (rowDispose = dispose, untrack(() => listRenderFn(item, getIndex)))), end.parentNode.insertBefore(element, end);
        } finally {
          hydrating = prevHydrating;
        }
      }
      cache2.set(key, { getIndex, setIndex, dispose: rowDispose }), adoptedNodes.push(element), adoptedItems.push(item);
    }
    if (useIndexFallback)
      for (let i = 0; i < ssrElements.length; i++)
        !usedIndices.has(i) && ssrElements[i].parentNode && ssrElements[i].parentNode.removeChild(ssrElements[i]);
    else
      for (let [unusedKey, unusedNode] of ssrKeyMap)
        unusedNode.parentNode && unusedNode.parentNode.removeChild(unusedNode);
    let parent2 = start.parentNode;
    for (let adoptedNode of adoptedNodes)
      parent2.insertBefore(adoptedNode, end);
    let reconcileNodes = adoptedNodes.slice(), reconcileItems = adoptedItems.slice();
    internalEffect(() => {
      let newItems = desc.items(), listParent = start.parentNode;
      if (!listParent) return;
      let result = reconcileList(
        listParent,
        reconcileItems,
        newItems,
        reconcileNodes,
        listKeyFn,
        (item) => {
          let prevHydrating = hydrating;
          hydrating = false;
          try {
            let key = listKeyFn(item), [getIndex, setIndex] = createSignal(0), rowDispose, element = createRoot((dispose) => (rowDispose = dispose, untrack(() => listRenderFn(item, getIndex))));
            return cache2.set(key, { getIndex, setIndex, dispose: rowDispose }), element;
          } finally {
            hydrating = prevHydrating;
          }
        },
        // updateFn: reused rows keep their DOM. The index signal is refreshed in
        // the pass below, so there is nothing to do per reused row here.
        () => {
        },
        end
      ), newCache = /* @__PURE__ */ new Map();
      for (let i = 0; i < newItems.length; i++) {
        let key = listKeyFn(newItems[i]), cached = cache2.get(key);
        cached && (cached.setIndex(i), newCache.set(key, cached));
      }
      for (let [key, cached] of cache2)
        newCache.has(key) || cached.dispose();
      cache2 = newCache, reconcileNodes = result.nodes, reconcileItems = result.items;
    }), registerDisposer(() => {
      for (let cached of cache2.values()) cached.dispose();
      cache2 = /* @__PURE__ */ new Map(), reconcileNodes = [], reconcileItems = [];
    });
  }
  function nextMarkerBetween(regionStart, regionEnd, isStart) {
    let node = regionStart.nextSibling;
    for (; node && node !== regionEnd; ) {
      if (node.nodeType === 8 && isStart(node.data)) return node;
      node = node.nextSibling;
    }
    return null;
  }
  function adoptBranchContent(desc, regionStart, regionEnd) {
    if (isDescriptor(desc)) {
      let el = nextElementBetweenMarkers(regionStart, regionEnd);
      el && adoptNode(desc, el);
    } else if (isShowDescriptor(desc)) {
      let innerStart = nextMarkerBetween(regionStart, regionEnd, isShowStart);
      if (innerStart) {
        let innerEnd = findClosingMarker(innerStart);
        innerEnd && adoptShowRegion(desc, innerStart, innerEnd);
      }
    } else if (isListDescriptor(desc)) {
      let innerStart = nextMarkerBetween(regionStart, regionEnd, isListStart);
      if (innerStart) {
        let innerEnd = findClosingMarker(innerStart);
        innerEnd && adoptListRegion(desc, innerStart, innerEnd);
      }
    }
  }
  function adoptNode(desc, ssrEl) {
    if (!ssrEl || ssrEl.tagName !== desc.tag.toUpperCase()) {
      let fresh = descriptorToElement(desc);
      ssrEl && ssrEl.replaceWith(fresh);
      return;
    }
    applyDynamicProps(ssrEl, desc.props);
    let cursor = ssrEl.firstChild;
    for (let child of desc.children)
      if (!(child === false || child == null))
        if (isDescriptor(child)) {
          for (; cursor && cursor.nodeType === 3 && !cursor.data.trim(); )
            cursor = cursor.nextSibling;
          for (; cursor && cursor.nodeType === 1 && cursor.hasAttribute("data-forma-island"); )
            cursor = cursor.nextSibling;
          if (!cursor) {
            ssrEl.appendChild(descriptorToElement(child));
            continue;
          }
          if (cursor.nodeType === 1) {
            let el = cursor;
            cursor = cursor.nextSibling, adoptNode(child, el);
          } else if (cursor.nodeType === 8 && isIslandStart(cursor.data)) {
            let islandStart = cursor, end = findClosingMarker(islandStart);
            if ((end ? nextElementBetweenMarkers(islandStart, end) : void 0) && end)
              cursor = end.nextSibling;
            else {
              let fresh = descriptorToElement(child);
              end ? (end.parentNode.insertBefore(fresh, end), cursor = end.nextSibling) : (ssrEl.appendChild(fresh), cursor = null);
            }
          } else
            ssrEl.appendChild(descriptorToElement(child));
        } else if (isShowDescriptor(child)) {
          for (; cursor && !(cursor.nodeType === 8 && isShowStart(cursor.data)); )
            cursor = cursor.nextSibling;
          if (cursor) {
            let start = cursor, end = findClosingMarker(start);
            end && (adoptShowRegion(child, start, end), cursor = end.nextSibling);
          }
        } else if (isListDescriptor(child)) {
          for (; cursor && !(cursor.nodeType === 8 && isListStart(cursor.data)); )
            cursor = cursor.nextSibling;
          if (cursor) {
            let start = cursor, end = findClosingMarker(start);
            end && (adoptListRegion(child, start, end), cursor = end.nextSibling);
          }
        } else if (typeof child == "function") {
          for (; cursor && cursor.nodeType === 3 && !cursor.data.trim(); )
            cursor = cursor.nextSibling;
          if (cursor && cursor.nodeType === 1) {
            let initial = child();
            if (isDescriptor(initial)) {
              let el = cursor;
              cursor = cursor.nextSibling, adoptNode(initial, el);
              continue;
            }
          }
          if (cursor && cursor.nodeType === 8) {
            let data = cursor.data;
            if (isTextStart(data)) {
              let endMarker = findClosingMarker(cursor), textNode = cursor.nextSibling;
              if (!textNode || textNode.nodeType !== 3) {
                let created = document.createTextNode("");
                cursor.parentNode.insertBefore(created, endMarker || cursor.nextSibling), textNode = created;
              }
              internalEffect(() => {
                textNode.data = String(child());
              }), cursor = endMarker ? endMarker.nextSibling : textNode.nextSibling;
            } else if (isShowStart(data)) {
              let start = cursor, end = findClosingMarker(start);
              if (end) {
                let textNode = findTextBetween(start, end);
                textNode || (textNode = document.createTextNode(""), start.parentNode.insertBefore(textNode, end)), internalEffect(() => {
                  textNode.data = String(child());
                }), cursor = end.nextSibling;
              } else
                cursor = cursor.nextSibling;
            } else
              cursor = cursor.nextSibling;
          } else if (cursor && cursor.nodeType === 3) {
            let textNode = cursor;
            cursor = cursor.nextSibling, internalEffect(() => {
              textNode.data = String(child());
            });
          } else {
            let textNode = document.createTextNode("");
            ssrEl.appendChild(textNode), internalEffect(() => {
              textNode.data = String(child());
            });
          }
        } else (typeof child == "string" || typeof child == "number") && cursor && cursor.nodeType === 3 && (cursor = cursor.nextSibling);
  }
  function hydrateIsland(component, target) {
    if (!(target.childElementCount > 0 || target.childNodes.length > 0 && Array.from(target.childNodes).some((n) => n.nodeType === 1 || n.nodeType === 3 && n.data.trim()))) {
      let result = component();
      if (result instanceof Element) {
        for (let attr of Array.from(target.attributes))
          attr.name.startsWith("data-forma-") && result.setAttribute(attr.name, attr.value);
        return target.replaceWith(result), result;
      } else result instanceof Node && target.appendChild(result);
      return target;
    }
    setHydrating(true);
    let descriptor;
    try {
      descriptor = component();
    } finally {
      setHydrating(false);
    }
    return !descriptor || !isDescriptor(descriptor) ? (target.removeAttribute("data-forma-ssr"), target) : (target.hasAttribute("data-forma-island") ? adoptNode(descriptor, target) : adoptNode(descriptor, target.children[0]), target.removeAttribute("data-forma-ssr"), target);
  }
  var Fragment = /* @__PURE__ */ Symbol.for("forma.fragment");
  var SVG_NS = "http://www.w3.org/2000/svg";
  var XLINK_NS = "http://www.w3.org/1999/xlink";
  var DUAL_USE_SVG_TAGS = /* @__PURE__ */ new Set(["a", "title", "script", "style", "font"]);
  var currentNamespace = null;
  function svg(build) {
    let prev = currentNamespace;
    currentNamespace = SVG_NS;
    try {
      return build();
    } finally {
      currentNamespace = prev;
    }
  }
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
      for (let t of [
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
      ])
        ELEMENT_PROTOS[t] = document.createElement(t);
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
    return controller || (controller = new AbortController(), el[ABORT_SYM3] = controller), controller;
  }
  function cleanup(el) {
    let controller = el[ABORT_SYM3];
    controller && (controller.abort(), delete el[ABORT_SYM3]);
  }
  var CACHE_SYM2 = /* @__PURE__ */ Symbol.for("forma-attr-cache");
  var DYNAMIC_CHILD_SYM2 = /* @__PURE__ */ Symbol.for("forma-dynamic-child");
  function getCache(el) {
    return el[CACHE_SYM2] ?? (el[CACHE_SYM2] = /* @__PURE__ */ Object.create(null));
  }
  function handleClass(el, _key, value2) {
    if (typeof value2 == "function")
      internalEffect(() => {
        let v = value2(), cache2 = getCache(el);
        cache2.class !== v && (cache2.class = v, el instanceof HTMLElement ? el.className = v : el.setAttribute("class", v));
      });
    else {
      let cache2 = getCache(el);
      if (cache2.class === value2) return;
      cache2.class = value2, el instanceof HTMLElement ? el.className = value2 : el.setAttribute("class", value2);
    }
  }
  function parseCssString(css) {
    let obj = {};
    for (let decl of css.split(";")) {
      let colon = decl.indexOf(":");
      if (colon < 0) continue;
      let prop = decl.slice(0, colon).trim(), val = decl.slice(colon + 1).trim();
      if (prop && val) {
        let camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        obj[camel] = val;
      }
    }
    return obj;
  }
  function applyStyleObj(el, obj, prevKeys) {
    let style = el.style, nextKeys = Object.keys(obj);
    for (let k of prevKeys)
      k in obj || style.removeProperty(k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
    return Object.assign(style, obj), nextKeys;
  }
  function handleStyle(el, _key, value2) {
    if (typeof value2 == "function") {
      let prevKeys = [];
      internalEffect(() => {
        let v = value2();
        if (typeof v == "string") {
          let cache2 = getCache(el);
          if (cache2.style === v) return;
          cache2.style = v, prevKeys = applyStyleObj(el, parseCssString(v), prevKeys);
        } else v && typeof v == "object" && (prevKeys = applyStyleObj(el, v, prevKeys));
      });
    } else if (typeof value2 == "string") {
      let cache2 = getCache(el);
      if (cache2.style === value2) return;
      cache2.style = value2, applyStyleObj(el, parseCssString(value2), []);
    } else value2 && typeof value2 == "object" && Object.assign(el.style, value2);
  }
  function handleEvent(el, key, value2) {
    if (!(typeof value2 == "function" || typeof value2 == "object" && value2 !== null && typeof value2.handleEvent == "function")) {
      if (value2 == null) return;
      return;
    }
    let controller = getAbortController(el);
    el.addEventListener(
      eventName(key),
      value2,
      { signal: controller.signal }
    );
  }
  function handleInnerHTML(el, _key, value2) {
    if (typeof value2 == "function")
      internalEffect(() => {
        let resolved = value2();
        if (resolved == null) {
          el.innerHTML = "";
          return;
        }
        if (typeof resolved != "object" || !("__html" in resolved))
          throw new TypeError(
            "dangerouslySetInnerHTML: expected { __html: string }, got " + typeof resolved
          );
        let html = resolved.__html;
        if (typeof html != "string")
          throw new TypeError(
            "dangerouslySetInnerHTML: __html must be a string, got " + typeof html
          );
        let cache2 = getCache(el);
        cache2.innerHTML !== html && (cache2.innerHTML = html, el.innerHTML = html);
      });
    else {
      if (value2 == null) {
        el.innerHTML = "";
        return;
      }
      if (typeof value2 != "object" || !("__html" in value2))
        throw new TypeError(
          "dangerouslySetInnerHTML: expected { __html: string }, got " + typeof value2
        );
      let html = value2.__html;
      if (typeof html != "string")
        throw new TypeError(
          "dangerouslySetInnerHTML: __html must be a string, got " + typeof html
        );
      el.innerHTML = html;
    }
  }
  function handleXLink(el, key, value2) {
    let localName = key.slice(6), write = (v) => {
      if (v == null || v === false) {
        el.removeAttributeNS(XLINK_NS, localName);
        return;
      }
      let strVal = String(v);
      if (isUnsafeAttrWrite(el.localName, key, strVal)) {
        el.removeAttributeNS(XLINK_NS, localName);
        return;
      }
      el.setAttributeNS(XLINK_NS, key, strVal);
    };
    typeof value2 == "function" ? internalEffect(() => {
      write(value2());
    }) : write(value2);
  }
  function handleBooleanAttr(el, key, value2) {
    if (typeof value2 == "function")
      internalEffect(() => {
        let v = value2(), cache2 = getCache(el);
        cache2[key] !== v && (cache2[key] = v, v ? el.setAttribute(key, "") : el.removeAttribute(key));
      });
    else {
      let cache2 = getCache(el);
      if (cache2[key] === value2) return;
      cache2[key] = value2, value2 ? el.setAttribute(key, "") : el.removeAttribute(key);
    }
  }
  function handleGenericAttr(el, key, value2) {
    if (isEventHandlerAttr(key)) {
      return;
    }
    let urlAttr = isUrlAttr(key), write = (v) => {
      let cache2 = getCache(el);
      if (v != null && v !== false) {
        let strVal = String(v);
        if (cache2[key] === strVal) return;
        if (!urlAttr || !isDangerousUrl(strVal, el.localName)) {
          cache2[key] = strVal, el.setAttribute(key, strVal);
          return;
        }
      }
      cache2[key] !== null && (cache2[key] = null, el.removeAttribute(key));
    };
    typeof value2 == "function" ? internalEffect(() => {
      write(value2());
    }) : write(value2);
  }
  var PROP_HANDLERS = /* @__PURE__ */ new Map();
  PROP_HANDLERS.set("class", handleClass);
  PROP_HANDLERS.set("className", handleClass);
  PROP_HANDLERS.set("style", handleStyle);
  PROP_HANDLERS.set("ref", () => {
  });
  PROP_HANDLERS.set("dangerouslySetInnerHTML", handleInnerHTML);
  for (let attr of BOOLEAN_ATTRS)
    PROP_HANDLERS.set(attr, handleBooleanAttr);
  function applyProp(el, key, value2) {
    if (key === "class") {
      handleClass(el, key, value2);
      return;
    }
    if (key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && key.length > 2) {
      handleEvent(el, key, value2);
      return;
    }
    let handler = PROP_HANDLERS.get(key);
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
      el instanceof HTMLElement ? el.className = value2 : el.setAttribute("class", value2);
      return;
    }
    if (key === "style") {
      typeof value2 == "string" ? applyStyleObj(el, parseCssString(value2), []) : value2 && typeof value2 == "object" && Object.assign(el.style, value2);
      return;
    }
    if (key === "dangerouslySetInnerHTML") {
      if (typeof value2 != "object" || !("__html" in value2))
        throw new TypeError(
          "dangerouslySetInnerHTML: expected { __html: string }, got " + typeof value2
        );
      let html = value2.__html;
      if (typeof html != "string")
        throw new TypeError(
          "dangerouslySetInnerHTML: __html must be a string, got " + typeof html
        );
      el.innerHTML = html;
      return;
    }
    if (key.charCodeAt(0) === 120 && key.startsWith("xlink:")) {
      let strVal2 = String(value2);
      if (isUnsafeAttrWrite(el.localName, key, strVal2)) {
        return;
      }
      el.setAttributeNS(XLINK_NS, key, strVal2);
      return;
    }
    if (BOOLEAN_ATTRS.has(key)) {
      value2 && el.setAttribute(key, "");
      return;
    }
    if (isEventHandlerAttr(key)) {
      return;
    }
    if (value2 === true) {
      el.setAttribute(key, "");
      return;
    }
    let strVal = String(value2);
    if (isUrlAttr(key) && isDangerousUrl(strVal, el.localName)) {
      return;
    }
    el.setAttribute(key, strVal);
  }
  function appendChild(parent2, child) {
    if (child instanceof Node) {
      parent2.appendChild(child);
      return;
    }
    if (typeof child == "string") {
      parent2.appendChild(new Text(child));
      return;
    }
    if (!(child == null || child === false || child === true)) {
      if (typeof child == "number") {
        parent2.appendChild(new Text(String(child)));
        return;
      }
      if (typeof child == "function") {
        parent2 instanceof Element && (parent2[DYNAMIC_CHILD_SYM2] = true);
        let currentNode = null, currentFragChildren = null, warnedArray = false, DEBUG = typeof globalThis.__FORMA_DEBUG__ < "u", clearCurrent = () => {
          if (currentFragChildren) {
            for (let c of currentFragChildren)
              c.parentNode === parent2 && parent2.removeChild(c);
            currentFragChildren = null;
          }
          currentNode && currentNode.parentNode === parent2 && parent2.removeChild(currentNode), currentNode = null;
        };
        internalEffect(() => {
          let v = child(), resolved = v;
          if (Array.isArray(v)) {
            let frag = document.createDocumentFragment();
            for (let item of v)
              item instanceof Node ? frag.appendChild(item) : Array.isArray(item) ? DEBUG && console.warn("[forma] Nested arrays in function children are not supported. Flatten the array or use createList().") : item != null && item !== false && item !== true && frag.appendChild(new Text(String(item)));
            resolved = frag.childNodes.length > 0 ? frag : null, DEBUG && !warnedArray && (warnedArray = true, console.warn("[forma] Function child returned an array \u2014 auto-wrapped in DocumentFragment. Consider using createList() or wrapping in a container element for better performance."));
          }
          if (resolved instanceof Node) {
            clearCurrent();
            let isNewFrag = resolved instanceof DocumentFragment;
            isNewFrag && (currentFragChildren = Array.from(resolved.childNodes)), parent2.appendChild(resolved), currentNode = isNewFrag ? null : resolved;
          } else if (resolved == null || resolved === false || resolved === true)
            clearCurrent();
          else {
            if (currentFragChildren) {
              for (let c of currentFragChildren)
                c.parentNode === parent2 && parent2.removeChild(c);
              currentFragChildren = null;
            }
            let text = String(typeof resolved == "symbol" ? resolved : resolved ?? "");
            if (!currentNode)
              currentNode = new Text(text), parent2.appendChild(currentNode);
            else if (currentNode.nodeType === 3)
              currentNode.data = text;
            else {
              let tn = new Text(text);
              parent2.replaceChild(tn, currentNode), currentNode = tn;
            }
          }
        });
        return;
      }
      if (Array.isArray(child)) {
        for (let item of child)
          appendChild(parent2, item);
        return;
      }
    }
  }
  function h(tag, props, ...children2) {
    if (typeof tag == "function" && tag !== Fragment) {
      let mergedProps = { ...props ?? {}, children: children2 };
      return tag(mergedProps);
    }
    if (tag === Fragment) {
      let frag = document.createDocumentFragment();
      for (let child of children2)
        appendChild(frag, child);
      return frag;
    }
    let tagName = tag;
    if (hydrating)
      return { type: "element", tag: tagName, props: props ?? null, children: children2 };
    let el, svgCtx = currentNamespace === SVG_NS;
    if (svgCtx && (SVG_TAGS.has(tagName) || DUAL_USE_SVG_TAGS.has(tagName)) ? el = document.createElementNS(SVG_NS, tagName) : !svgCtx && DUAL_USE_SVG_TAGS.has(tagName) ? el = getProto(tagName).cloneNode(false) : ELEMENT_PROTOS && ELEMENT_PROTOS[tagName] ? el = ELEMENT_PROTOS[tagName].cloneNode(false) : SVG_TAGS.has(tagName) ? el = document.createElementNS(SVG_NS, tagName) : el = getProto(tagName).cloneNode(false), props) {
      let hasDynamic = false;
      for (let key in props) {
        if (key === "ref") continue;
        let value2 = props[key];
        if (key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && key.length > 2) {
          handleEvent(el, key, value2);
          continue;
        }
        if (typeof value2 == "function") {
          hasDynamic || (el[CACHE_SYM2] = /* @__PURE__ */ Object.create(null), hasDynamic = true), applyProp(el, key, value2);
          continue;
        }
        applyStaticProp(el, key, value2);
      }
    }
    let childLen = children2.length;
    if (childLen === 1) {
      let only = children2[0];
      typeof only == "string" ? el.textContent = only : typeof only == "number" ? el.textContent = String(only) : appendChild(el, only);
    } else if (childLen > 1)
      for (let child of children2)
        appendChild(el, child);
    return props && typeof props.ref == "function" && props.ref(el), el;
  }
  function fragment(...children2) {
    let frag = document.createDocumentFragment();
    for (let child of children2)
      appendChild(frag, child);
    return frag;
  }
  function createText(value2) {
    if (typeof value2 == "function") {
      let node = new Text("");
      return internalEffect(() => {
        node.data = value2();
      }), node;
    }
    return new Text(value2);
  }
  function mount(component, container) {
    let target = typeof container == "string" ? document.querySelector(container) : container;
    if (!target)
      throw new Error(`mount: container not found \u2014 "${container}"`);
    let disposeRoot, active = target;
    if (target.hasAttribute("data-forma-ssr"))
      createUnownedRoot((dispose) => {
        disposeRoot = dispose, active = hydrateIsland(component, target);
      });
    else {
      let dom = createUnownedRoot((dispose) => (disposeRoot = dispose, component()));
      target.innerHTML = "", target.appendChild(dom);
    }
    let unmounted = false;
    return () => {
      unmounted || (unmounted = true, disposeRoot(), active === target ? target.innerHTML = "" : active.remove());
    };
  }
  function createSwitch(value2, cases, fallback) {
    let startMarker = document.createComment("forma-switch"), endMarker = document.createComment("/forma-switch"), fragment2 = document.createDocumentFragment();
    fragment2.appendChild(startMarker), fragment2.appendChild(endMarker);
    let cache2 = /* @__PURE__ */ new Map(), currentNode = null, currentMatch = UNSET, switchDispose = internalEffect(() => {
      let val = value2();
      if (val === currentMatch) return;
      let DEBUG = typeof globalThis.__FORMA_DEBUG__ < "u";
      DEBUG && console.log("[forma:switch] transition", String(currentMatch), "\u2192", String(val)), currentMatch = val;
      let parent2 = startMarker.parentNode;
      if (!parent2) {
        DEBUG && console.warn("[forma:switch] markers not in DOM yet, skipping");
        return;
      }
      if (currentNode)
        if (currentNode.parentNode === parent2)
          DEBUG && console.log("[forma:switch] removing single node"), parent2.removeChild(currentNode);
        else if (currentNode.nodeType === 11) {
          DEBUG && console.log("[forma:switch] scooping nodes back into fragment");
          let scooped = 0;
          for (; startMarker.nextSibling && startMarker.nextSibling !== endMarker; )
            currentNode.appendChild(startMarker.nextSibling), scooped++;
          DEBUG && console.log("[forma:switch] scooped", scooped, "nodes back into fragment");
        } else
          for (DEBUG && console.log("[forma:switch] clearing detached node between markers"); startMarker.nextSibling && startMarker.nextSibling !== endMarker; )
            parent2.removeChild(startMarker.nextSibling);
      let matchedCase = cases.find((c) => c.match === val);
      if (matchedCase) {
        let entry = cache2.get(val);
        if (entry)
          DEBUG && console.log("[forma:switch] reusing cached branch for", String(val), "\u2192", entry.node.nodeName, "type", entry.node.nodeType, "childNodes", entry.node.childNodes?.length);
        else {
          let branchDispose, node = createRoot((dispose) => (branchDispose = dispose, untrack(() => matchedCase.render())));
          entry = { node, dispose: branchDispose }, cache2.set(val, entry), DEBUG && console.log("[forma:switch] rendered new branch for", String(val), "\u2192", node.nodeName, "type", node.nodeType);
        }
        currentNode = entry.node;
      } else
        currentNode = fallback?.() ?? null, DEBUG && console.log("[forma:switch] no match, using fallback");
      currentNode && (parent2.insertBefore(currentNode, endMarker), DEBUG && console.log("[forma:switch] inserted", currentNode.nodeName, "before end marker"));
    });
    return registerDisposer(() => {
      for (let entry of cache2.values())
        entry.dispose();
      cache2.clear(), currentNode = null;
    }), fragment2.__switchDispose = () => {
      switchDispose();
      for (let entry of cache2.values())
        entry.dispose();
      cache2.clear();
    }, fragment2;
  }
  var UNSET = /* @__PURE__ */ Symbol("unset");
  function createPortal(children2, target) {
    let placeholder = document.createComment("forma-portal"), resolvedTarget = typeof target == "string" ? document.querySelector(target) : target ?? document.body;
    if (!resolvedTarget)
      throw new Error(`createPortal: target not found: ${target}`);
    let mountedNode = null, removeMountedNode = () => {
      mountedNode && mountedNode.parentNode === resolvedTarget && resolvedTarget.removeChild(mountedNode), mountedNode = null;
    };
    return createEffect(() => {
      let node = children2();
      return mountedNode = node, resolvedTarget.appendChild(node), () => {
        removeMountedNode();
      };
    }), placeholder;
  }
  function createErrorBoundary(tryFn, catchFn) {
    let startMarker = document.createComment("forma-error-boundary"), endMarker = document.createComment("/forma-error-boundary"), fragment2 = document.createDocumentFragment();
    fragment2.appendChild(startMarker), fragment2.appendChild(endMarker);
    let [retryCount, setRetryCount] = createSignal(0), currentNode = null;
    return internalEffect(() => {
      retryCount();
      let parent2 = startMarker.parentNode;
      if (parent2) {
        currentNode && currentNode.parentNode === parent2 && parent2.removeChild(currentNode);
        try {
          currentNode = tryFn();
        } catch (e) {
          let error = e instanceof Error ? e : new Error(String(e));
          currentNode = catchFn(error, () => setRetryCount((c) => c + 1));
        }
        currentNode && parent2.insertBefore(currentNode, endMarker);
      }
    }), fragment2;
  }
  function createSuspense(fallback, children2) {
    let startMarker = document.createComment("forma-suspense"), endMarker = document.createComment("/forma-suspense"), fragment2 = document.createDocumentFragment();
    fragment2.appendChild(startMarker), fragment2.appendChild(endMarker);
    let [pending, setPending] = createSignal(0), currentNode = null, resolvedNode = null, fallbackNode = null;
    pushSuspenseContext({
      increment() {
        setPending((p) => p + 1);
      },
      decrement() {
        setPending((p) => Math.max(0, p - 1));
      }
    });
    try {
      resolvedNode = children2();
    } finally {
      popSuspenseContext();
    }
    return internalEffect(() => {
      let parent2 = startMarker.parentNode;
      if (!parent2) return;
      let newNode = pending() > 0 ? fallbackNode ??= fallback() : resolvedNode;
      if (newNode !== currentNode) {
        if (currentNode) {
          if (currentNode.parentNode === parent2)
            parent2.removeChild(currentNode);
          else if (currentNode.nodeType === 11)
            for (; startMarker.nextSibling && startMarker.nextSibling !== endMarker; )
              currentNode.appendChild(startMarker.nextSibling);
        }
        newNode && parent2.insertBefore(newNode, endMarker), currentNode = newNode;
      }
    }), fragment2;
  }
  var cache = /* @__PURE__ */ new Map();
  function template(html) {
    let node = cache.get(html);
    if (!node) {
      let tpl = document.createElement("template");
      tpl.innerHTML = html, node = tpl.content.firstChild, cache.set(html, node);
    }
    return node;
  }
  function templateMany(html) {
    let node = cache.get(html);
    if (!node) {
      let tpl = document.createElement("template");
      tpl.innerHTML = html, node = tpl.content, cache.set(html, node);
    }
    return node.cloneNode(true);
  }
  var currentLifecycleContext = null;
  var lifecycleStack = [];
  function pushLifecycleContext(ctx) {
    lifecycleStack.push(currentLifecycleContext), currentLifecycleContext = ctx;
  }
  function popLifecycleContext() {
    currentLifecycleContext = lifecycleStack.pop() ?? null;
  }
  function onMount(fn) {
    if (currentLifecycleContext === null)
      throw new Error("onMount() must be called inside a component setup function");
    currentLifecycleContext.mountCallbacks.push(fn);
  }
  function onUnmount(fn) {
    if (currentLifecycleContext === null)
      throw new Error("onUnmount() must be called inside a component setup function");
    currentLifecycleContext.unmountCallbacks.push(fn);
  }
  function registerContextDisposer(dispose) {
    return currentLifecycleContext !== null ? (currentLifecycleContext.contextDisposers.push(dispose), true) : false;
  }
  var DISPOSE_KEY = /* @__PURE__ */ Symbol("forma:component:dispose");
  function defineComponent(setupOrDef) {
    let setup = typeof setupOrDef == "function" ? setupOrDef : setupOrDef.setup, name = typeof setupOrDef == "function" ? void 0 : setupOrDef.name, where = (phase) => name ? `${name}: ${phase}` : phase;
    return function() {
      let ctx = {
        disposers: [],
        mountCallbacks: [],
        unmountCallbacks: [],
        contextDisposers: []
      };
      pushLifecycleContext(ctx);
      let dom;
      try {
        dom = setup();
      } catch (e) {
        for (let i = ctx.contextDisposers.length - 1; i >= 0; i--)
          try {
            ctx.contextDisposers[i]();
          } catch {
          }
        throw ctx.contextDisposers.length = 0, e;
      } finally {
        popLifecycleContext();
      }
      let disposed = false, dispose = () => {
        if (!disposed) {
          disposed = true;
          for (let cb of ctx.unmountCallbacks)
            try {
              cb();
            } catch (e) {
              reportError(e, where("onUnmount"));
            }
          for (let d of ctx.disposers)
            try {
              d();
            } catch (e) {
              reportError(e, where("component disposer"));
            }
          for (let i = ctx.contextDisposers.length - 1; i >= 0; i--)
            try {
              ctx.contextDisposers[i]();
            } catch (e) {
              reportError(e, where("context disposer"));
            }
          ctx.disposers.length = 0, ctx.mountCallbacks.length = 0, ctx.unmountCallbacks.length = 0, ctx.contextDisposers.length = 0;
        }
      };
      if (dom[DISPOSE_KEY] = dispose, dom.nodeType === 11)
        for (let child of Array.from(dom.childNodes))
          child[DISPOSE_KEY] = dispose;
      pushLifecycleContext(ctx);
      try {
        for (let cb of ctx.mountCallbacks)
          try {
            let cleanup2 = cb();
            typeof cleanup2 == "function" && ctx.unmountCallbacks.push(cleanup2);
          } catch (e) {
            reportError(e, where("onMount"));
          }
      } finally {
        popLifecycleContext();
      }
      return dom;
    };
  }
  function disposeComponent(dom) {
    let disposable = dom;
    typeof disposable[DISPOSE_KEY] == "function" && (disposable[DISPOSE_KEY](), delete disposable[DISPOSE_KEY]);
  }
  function trackDisposer(dispose) {
    currentLifecycleContext !== null && currentLifecycleContext.disposers.push(dispose);
  }
  var contextStacks = /* @__PURE__ */ new Map();
  function removeFrame(id, token) {
    let stack = contextStacks.get(id);
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--)
        if (stack[i].token === token) {
          stack.splice(i, 1);
          break;
        }
      stack.length === 0 && contextStacks.delete(id);
    }
  }
  function createContext(defaultValue) {
    return {
      id: /* @__PURE__ */ Symbol("forma:context"),
      defaultValue
    };
  }
  function provide(ctx, value2) {
    let stack = contextStacks.get(ctx.id);
    stack === void 0 && (stack = [], contextStacks.set(ctx.id, stack));
    let token = /* @__PURE__ */ Symbol("forma:context-frame");
    stack.push({ token, value: value2 }), registerContextDisposer(() => removeFrame(ctx.id, token));
  }
  function inject(ctx) {
    let stack = contextStacks.get(ctx.id);
    return stack === void 0 || stack.length === 0 ? ctx.defaultValue : stack[stack.length - 1].value;
  }
  function unprovide(ctx) {
    let stack = contextStacks.get(ctx.id);
    stack !== void 0 && stack.length > 0 && (stack.pop(), stack.length === 0 && contextStacks.delete(ctx.id));
  }
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
  var FORBIDDEN_STORE_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  function warnForbiddenKey(key) {
    console.warn(
      `[forma] Refused to write "${key}" into a store \u2014 this key can replace the object's prototype. Strip it from untrusted payloads before calling setState.`
    );
  }
  function shouldWrap(v) {
    return !(v == null || typeof v != "object" || v instanceof Date || v instanceof RegExp || v instanceof Map || v instanceof Set || v instanceof WeakMap || v instanceof WeakSet || v instanceof Error || v instanceof Promise || v[PROXY]);
  }
  function deepClone(obj, seen) {
    if (obj === null || typeof obj != "object" || (seen || (seen = /* @__PURE__ */ new WeakSet()), seen.has(obj))) return obj;
    if (seen.add(obj), Array.isArray(obj)) return obj.map((item) => deepClone(item, seen));
    let out = {};
    for (let key of Object.keys(obj))
      key !== "__proto__" && (out[key] = deepClone(obj[key], seen));
    return out;
  }
  function createStore(initial) {
    let signals = /* @__PURE__ */ new Map(), children2 = /* @__PURE__ */ new Map(), arrayVersions = /* @__PURE__ */ new Map();
    function getArrayVersion(path) {
      let p = arrayVersions.get(path);
      return p || (p = createSignal(0), arrayVersions.set(path, p)), p;
    }
    function bumpArrayVersion(path) {
      let p = arrayVersions.get(path);
      p && p[1]((n) => n + 1);
    }
    function registerChild(path) {
      let lastDot = path.lastIndexOf(".");
      if (lastDot === -1) return;
      let parentPath = path.substring(0, lastDot), set = children2.get(parentPath);
      set || (set = /* @__PURE__ */ new Set(), children2.set(parentPath, set)), set.add(path);
    }
    function getSignal(path, initialValue) {
      let pair = signals.get(path);
      return pair || (pair = createSignal(initialValue), signals.set(path, pair), registerChild(path)), pair;
    }
    let proxyCache = /* @__PURE__ */ new WeakMap();
    function invalidateChildren(parentPath) {
      let childSet = children2.get(parentPath);
      if (childSet) {
        for (let childPath of childSet)
          invalidateChildren(childPath), signals.delete(childPath), children2.delete(childPath);
        childSet.clear();
      }
    }
    function lastSegment(path) {
      let d = path.lastIndexOf(".");
      return d === -1 ? path : path.substring(d + 1);
    }
    function setLiteral(pair, v) {
      pair[1](typeof v == "function" ? value(v) : v);
    }
    function reconcileChildren(parentPath, rawParent) {
      let set = children2.get(parentPath);
      if (set)
        for (let childPath of set) {
          let key = lastSegment(childPath), nv = rawParent[key], pair = signals.get(childPath);
          pair && setLiteral(pair, nv), nv != null && typeof nv == "object" ? reconcileChildren(childPath, nv) : invalidateChildren(childPath);
        }
    }
    function wrap(raw, basePath) {
      if (!shouldWrap(raw)) return raw;
      let byPath = proxyCache.get(raw);
      if (byPath) {
        let hit = byPath.get(basePath);
        if (hit) return hit;
      }
      let isArr = Array.isArray(raw), basePrefix = basePath ? basePath + "." : "", proxy = new Proxy(raw, {
        // -------------------------------------------------------------------
        // GET
        // -------------------------------------------------------------------
        get(target, prop, receiver) {
          if (prop === RAW) return target;
          if (prop === PROXY) return true;
          if (typeof prop == "symbol")
            return Reflect.get(target, prop, receiver);
          let key = String(prop), childPath = basePrefix + key;
          if (isArr && ARRAY_MUTATORS.has(key))
            return (...args) => {
              let result;
              return batch(() => {
                let rawArgs = args.map(
                  (a) => a != null && typeof a == "object" && a[RAW] ? a[RAW] : a
                );
                result = target[key].apply(target, rawArgs), reconcileChildren(basePath, target);
                let lenPair = signals.get(basePrefix + "length");
                lenPair && lenPair[1](target.length), basePath && bumpArrayVersion(basePath);
              }), result;
            };
          if (isArr && key === "length") {
            let [getter] = getSignal(childPath, target.length);
            return getter(), target.length;
          }
          let value2 = Reflect.get(target, prop);
          return getSignal(childPath, value2)[0](), Array.isArray(value2) && getArrayVersion(childPath)[0](), shouldWrap(value2) ? wrap(value2, childPath) : value2;
        },
        // -------------------------------------------------------------------
        // SET
        // -------------------------------------------------------------------
        set(target, prop, value2) {
          if (typeof prop == "symbol")
            return Reflect.set(target, prop, value2);
          let key = String(prop);
          if (FORBIDDEN_STORE_KEYS.has(key))
            return true;
          let childPath = basePrefix + key, rawValue = value2 != null && typeof value2 == "object" && value2[RAW] ? value2[RAW] : value2, oldRaw = Reflect.get(target, prop);
          if (Reflect.set(target, prop, rawValue), rawValue != null && typeof rawValue == "object" && oldRaw !== rawValue && (invalidateChildren(childPath), evictProxy(oldRaw, childPath)), isArr && key !== "length") {
            let lengthPath = basePrefix + "length", lenPair = signals.get(lengthPath);
            lenPair && lenPair[1](target.length);
          }
          isArr && key === "length" && batch(() => {
            reconcileChildren(basePath, target), basePath && bumpArrayVersion(basePath);
          });
          let [, setter2] = getSignal(childPath, rawValue);
          return setter2(rawValue), true;
        },
        // -------------------------------------------------------------------
        // HAS — track membership checks
        // -------------------------------------------------------------------
        has(target, prop) {
          if (typeof prop == "symbol")
            return Reflect.has(target, prop);
          let key = String(prop), childPath = basePrefix + key, [getter] = getSignal(childPath, Reflect.get(target, prop));
          return getter(), Reflect.has(target, prop);
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
          if (typeof prop == "symbol")
            return Reflect.deleteProperty(target, prop);
          let key = String(prop), childPath = basePrefix + key, oldRaw = Reflect.get(target, prop), result = Reflect.deleteProperty(target, prop), delPair = signals.get(childPath);
          return delPair && delPair[1](void 0), evictProxy(oldRaw, childPath), invalidateChildren(childPath), result;
        }
      });
      return byPath || (byPath = /* @__PURE__ */ new Map(), proxyCache.set(raw, byPath)), byPath.set(basePath, proxy), proxy;
    }
    function evictProxy(oldRaw, path) {
      if (oldRaw == null || typeof oldRaw != "object") return;
      let om = proxyCache.get(oldRaw);
      om && (om.delete(path), om.size === 0 && proxyCache.delete(oldRaw));
    }
    let rootProxy = wrap(initial, "");
    function getCurrentSnapshot() {
      return untrack(() => deepClone(initial));
    }
    return [rootProxy, (partial) => {
      let updates = typeof partial == "function" ? partial(getCurrentSnapshot()) : partial;
      batch(() => {
        for (let key of Object.keys(updates)) {
          if (FORBIDDEN_STORE_KEYS.has(key)) {
            __DEV__ && warnForbiddenKey(key);
            continue;
          }
          rootProxy[key] = updates[key];
        }
      });
    }];
  }
  function cloneEntry(v, seen) {
    if (v === null || typeof v != "object") return v;
    let proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null || (seen || (seen = /* @__PURE__ */ new WeakSet()), seen.has(v))) return v;
    if (seen.add(v), Array.isArray(v)) return v.map((i) => cloneEntry(i, seen));
    let out = {};
    for (let k of Object.keys(v))
      out[k] = cloneEntry(v[k], seen);
    return out;
  }
  function createHistory(source, options) {
    let [sourceGet, sourceSet] = source, maxLength = Math.max(1, options?.maxLength ?? 100), _stack = [cloneEntry(sourceGet())], _cursor = 0, [stackSignal, setStackSignal] = createSignal([..._stack]), [cursorSignal, setCursorSignal] = createSignal(_cursor), [stackLenSignal, setStackLenSignal] = createSignal(_stack.length);
    function syncSignals() {
      batch(() => {
        setStackSignal([..._stack]), setCursorSignal(_cursor), setStackLenSignal(_stack.length);
      });
    }
    let NONE = /* @__PURE__ */ Symbol("none"), _expected = NONE, isFirstRun = true, disposeEffect = internalEffect(() => {
      let value2 = sourceGet();
      if (isFirstRun) {
        isFirstRun = false;
        return;
      }
      if (_expected !== NONE && Object.is(value2, _expected)) {
        _expected = NONE;
        return;
      }
      _expected = NONE, _stack = _stack.slice(0, _cursor + 1), _stack.push(cloneEntry(value2)), _stack.length > maxLength && _stack.splice(0, _stack.length - maxLength), _cursor = _stack.length - 1, syncSignals();
    });
    return {
      undo: () => {
        if (_cursor <= 0) return;
        _cursor--;
        let restored = cloneEntry(_stack[_cursor]);
        _expected = restored, sourceSet(restored), syncSignals();
      },
      redo: () => {
        if (_cursor >= _stack.length - 1) return;
        _cursor++;
        let restored = cloneEntry(_stack[_cursor]);
        _expected = restored, sourceSet(restored), syncSignals();
      },
      canUndo: () => cursorSignal() > 0,
      canRedo: () => cursorSignal() < stackLenSignal() - 1,
      history: () => stackSignal(),
      cursor: () => cursorSignal(),
      clear: () => {
        let currentValue = sourceGet();
        _stack = [cloneEntry(currentValue)], _cursor = 0, syncSignals();
      },
      destroy: () => {
        disposeEffect();
      }
    };
  }
  var ENVELOPE_TAG = "$forma:v";
  function persist(source, key, options) {
    let [sourceGet, sourceSet] = source, storage = options?.storage ?? globalThis.localStorage, serialize = options?.serialize ?? JSON.stringify, deserialize = options?.deserialize ?? JSON.parse, validate = options?.validate, version = options?.version, migrate = options?.migrate, onError2 = options?.onError, writing = false;
    function unwrap(stored) {
      let parsed = deserialize(stored);
      if (parsed != null && typeof parsed == "object" && Object.prototype.hasOwnProperty.call(parsed, ENVELOPE_TAG)) {
        let env = parsed;
        return { value: env.value, version: Number(env[ENVELOPE_TAG]) };
      }
      return { value: parsed, version: 0 };
    }
    function hydrate() {
      let stored;
      try {
        stored = storage.getItem(key);
      } catch (err) {
        onError2?.(err, "hydrate");
        return;
      }
      if (stored !== null)
        try {
          let { value: raw, version: storedVersion } = unwrap(stored), value2 = raw;
          if (version !== void 0 && storedVersion < version) {
            if (!migrate) return;
            try {
              value2 = migrate(raw, storedVersion);
            } catch (err) {
              onError2?.(err, "migrate");
              return;
            }
          }
          if (!validate || validate(value2)) {
            writing = true;
            try {
              sourceSet(value2);
            } finally {
              writing = false;
            }
          }
        } catch (err) {
          onError2?.(err, "hydrate");
        }
    }
    hydrate();
    let stopEffect = internalEffect(() => {
      let value2 = sourceGet();
      if (!writing)
        try {
          let serialized = serialize(version !== void 0 ? { [ENVELOPE_TAG]: version, value: value2 } : value2);
          storage.setItem(key, serialized);
        } catch (err) {
          onError2?.(err, err?.name === "QuotaExceededError" ? "write" : "serialize");
        }
    }), enableSync = options?.syncTabs ?? (typeof window < "u" && storage === globalThis.localStorage), onStorage;
    return enableSync && typeof window < "u" && (onStorage = (e) => {
      e.storageArea === storage && (e.key !== null && e.key !== key || hydrate());
    }, window.addEventListener("storage", onStorage)), () => {
      stopEffect(), onStorage && typeof window < "u" && window.removeEventListener("storage", onStorage);
    };
  }
  function createBus() {
    let listeners = /* @__PURE__ */ new Map();
    function getHandlers(event) {
      let set = listeners.get(event);
      return set || (set = /* @__PURE__ */ new Set(), listeners.set(event, set)), set;
    }
    function on2(event, handler) {
      let set = getHandlers(event);
      return set.add(handler), () => {
        set.delete(handler);
      };
    }
    function once(event, handler) {
      let wrapper = (payload) => {
        off(event, wrapper), handler(payload);
      };
      return on2(event, wrapper);
    }
    function emit(event, payload) {
      let set = listeners.get(event);
      if (set)
        for (let handler of [...set])
          try {
            handler(payload);
          } catch (e) {
            console.error(`[forma] Bus handler error on "${String(event)}":`, e);
          }
    }
    function off(event, handler) {
      let set = listeners.get(event);
      set && set.delete(handler);
    }
    function clear() {
      listeners.clear();
    }
    return { on: on2, once, emit, off, clear };
  }
  function delegate(container, selector, event, handler, options) {
    let listener = (e) => {
      let target = e.target;
      if (!(target instanceof HTMLElement)) return;
      let root = container instanceof Document ? container.documentElement : container, matched = target.closest(selector);
      matched instanceof HTMLElement && root.contains(matched) && handler(e, matched);
    };
    return container.addEventListener(event, listener, options), () => {
      container.removeEventListener(event, listener, options);
    };
  }
  function parseCombo(combo) {
    let parts = combo.toLowerCase().split("+").map((p) => p.trim()), modifiers = {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
      key: ""
    };
    for (let part of parts)
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
    return modifiers;
  }
  function matchesCombo(e, parsed) {
    return e.ctrlKey !== parsed.ctrl || e.shiftKey !== parsed.shift || e.altKey !== parsed.alt || e.metaKey !== parsed.meta ? false : e.key.toLowerCase() === parsed.key;
  }
  function onKey(combo, handler, options) {
    let target = options?.target ?? document, shouldPreventDefault = options?.preventDefault ?? true, parsed = parseCombo(combo), listener = (e) => {
      e instanceof KeyboardEvent && matchesCombo(e, parsed) && (shouldPreventDefault && e.preventDefault(), handler(e));
    };
    return target.addEventListener("keydown", listener), () => {
      target.removeEventListener("keydown", listener);
    };
  }
  function $(selector, parent2) {
    return (parent2 ?? document).querySelector(selector);
  }
  function $$(selector, parent2) {
    return Array.from((parent2 ?? document).querySelectorAll(selector));
  }
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
    for (let [key, value2] of Object.entries(styles))
      value2 !== void 0 && (el.style[key] = value2);
  }
  function setAttr(el, attrs) {
    for (let [name, value2] of Object.entries(attrs))
      value2 === false || value2 === null ? el.removeAttribute(name) : value2 === true ? el.setAttribute(name, "") : el.setAttribute(name, value2);
  }
  function setText(el, text) {
    el.textContent = text;
  }
  function setHTMLUnsafe(el, html) {
    el.innerHTML = html;
  }
  function closest(el, selector) {
    return el.closest(selector);
  }
  function children(el, selector) {
    let all = Array.from(el.children);
    return selector ? all.filter((child) => child.matches(selector)) : all;
  }
  function siblings(el, selector) {
    let parentEl = el.parentElement;
    if (!parentEl) return [];
    let sibs = Array.from(parentEl.children).filter((child) => child !== el);
    return selector ? sibs.filter((child) => child.matches(selector)) : sibs;
  }
  function parent(el) {
    return el.parentElement;
  }
  function nextSibling(el, selector) {
    let sib = el.nextElementSibling;
    for (; sib; ) {
      if (sib instanceof HTMLElement && (!selector || sib.matches(selector)))
        return sib;
      sib = sib.nextElementSibling;
    }
    return null;
  }
  function prevSibling(el, selector) {
    let sib = el.previousElementSibling;
    for (; sib; ) {
      if (sib instanceof HTMLElement && (!selector || sib.matches(selector)))
        return sib;
      sib = sib.previousElementSibling;
    }
    return null;
  }
  function onResize(el, handler) {
    let observer = new ResizeObserver((entries) => {
      for (let entry of entries)
        handler(entry);
    });
    return observer.observe(el), () => {
      observer.disconnect();
    };
  }
  function onIntersect(el, handler, options) {
    let observer = new IntersectionObserver((entries) => {
      for (let entry of entries)
        handler(entry);
    }, options);
    return observer.observe(el), () => {
      observer.disconnect();
    };
  }
  function onMutation(el, handler, options) {
    let observer = new MutationObserver((mutations) => {
      handler(mutations);
    });
    return observer.observe(el, options ?? { childList: true, subtree: true }), () => {
      observer.disconnect();
    };
  }
  return __toCommonJS(forma_esm_exports);
})();

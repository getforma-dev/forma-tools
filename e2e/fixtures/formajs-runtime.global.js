"use strict";
var FormaRuntime = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: !0 });
  }, __copyProps = (to, from, except, desc) => {
    if (from && typeof from == "object" || typeof from == "function")
      for (let key of __getOwnPropNames(from))
        !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: !0 }), mod);

  // src/runtime.ts
  var runtime_exports = {};
  __export(runtime_exports, {
    applyContainmentHints: () => applyContainmentHints,
    clearDiagnostics: () => clearDiagnostics,
    destroyRuntime: () => destroyRuntime,
    getDiagnostics: () => getDiagnostics,
    getScopes: () => getScopes,
    initRuntime: () => initRuntime,
    mount: () => mount,
    reconcile: () => reconcile,
    resetScope: () => resetScope,
    setDebug: () => setDebug,
    setDiagnostics: () => setDiagnostics,
    setDirectiveMap: () => setDirectiveMap,
    setScopeValue: () => setScopeValue,
    unmount: () => unmount,
    yieldToMain: () => yieldToMain
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
      } while (!0);
    }
    function checkDirty2(link3, sub) {
      let stack, checkDepth = 0, dirty = !1;
      top: do {
        let dep = link3.dep, flags = dep.flags;
        if (sub.flags & 16)
          dirty = !0;
        else if ((flags & 17) === 17) {
          if (update(dep)) {
            let subs = dep.subs;
            subs.nextSub !== void 0 && shallowPropagate2(subs), dirty = !0;
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
            dirty = !1;
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
      } while (!0);
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
          return !0;
        link3 = link3.prevDep;
      }
      return !1;
    }
  }

  // node_modules/alien-signals/esm/index.mjs
  var cycle = 0, batchDepth = 0, notifyIndex = 0, queuedLength = 0, activeSub, queued = [], { link, unlink, propagate, checkDirty, shallowPropagate } = createReactiveSystem({
    update(node) {
      return node.depsTail !== void 0 ? updateComputed(node) : updateSignal(node);
    },
    notify(effect2) {
      let insertIndex = queuedLength, firstInsertedIndex = insertIndex;
      do
        if (queued[insertIndex++] = effect2, effect2.flags &= -3, effect2 = effect2.subs?.sub, effect2 === void 0 || !(effect2.flags & 2))
          break;
      while (!0);
      for (queuedLength = insertIndex; firstInsertedIndex < --insertIndex; ) {
        let left = queued[firstInsertedIndex];
        queued[firstInsertedIndex++] = queued[insertIndex], queued[insertIndex] = left;
      }
    },
    unwatched(node) {
      node.flags & 1 ? node.depsTail !== void 0 && (node.depsTail = void 0, node.flags = 17, purgeDeps(node)) : effectScopeOper.call(node);
    }
  });
  function setActiveSub(sub) {
    let prevSub = activeSub;
    return activeSub = sub, prevSub;
  }
  function startBatch() {
    ++batchDepth;
  }
  function endBatch() {
    --batchDepth || flush();
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
    if (flags & 16 || flags & 32 && (checkDirty(this.deps, this) || (this.flags = flags & -33, !1))) {
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

  // src/reactive/dev.ts
  var __DEV__ = !1, INSTANCE_KEY = /* @__PURE__ */ Symbol.for("@getforma/core#instances");
  function registerInstance() {
    let host = globalThis, registry = host[INSTANCE_KEY] ?? (host[INSTANCE_KEY] = { count: 0, warned: !1 });
    registry.count += 1, registry.count > 1 && !registry.warned && (registry.warned = !0, console.warn(
      `[forma] Duplicate @getforma/core instance detected (${registry.count} copies loaded). Signals, the owner tree, the component registry and the island registry are per-copy, so state created through one copy is invisible to the other. Usual causes: mixing \`import\` and \`require\` of @getforma/core in one process, or loading '@getforma/core' alongside '@getforma/core/runtime-hardened' or '@getforma/core/browser', which bundle their own private copy of the core.`
    ));
  }
  registerInstance();
  var _errorHandlers = /* @__PURE__ */ new Set();
  function reportError(error, source) {
    for (let handler of _errorHandlers)
      try {
        handler(error, source ? { source } : {});
      } catch {
      }
    __DEV__ && console.error(`[forma] ${source ?? "Unknown"} error:`, error);
  }

  // src/reactive/signal.ts
  var signalNames = /* @__PURE__ */ new WeakMap();
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
    __DEV__ && options?.name && signalNames.set(getter, options.name);
    let eq = options?.equals;
    return [getter, (v) => applySignalSet(s, v, eq)];
  }

  // src/reactive/root.ts
  var currentOwner = null;
  function registerDisposer(dispose) {
    currentOwner && currentOwner.disposers.push(dispose);
  }
  function hasActiveRoot() {
    return currentOwner !== null;
  }

  // src/reactive/effect.ts
  var POOL_SIZE = 32;
  var pool = [];
  for (let i = 0; i < POOL_SIZE; i++) pool.push([]);
  function internalEffect(fn) {
    let firstRun = !0, dispose = effect(() => {
      if (firstRun) {
        firstRun = !1, fn();
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

  // src/reactive/computed.ts
  var ERR = /* @__PURE__ */ Symbol("formaComputedError");
  function isErrBox(v) {
    return typeof v == "object" && v !== null && ERR in v;
  }
  function createComputed(fn) {
    let errored = !1, error, lastGood, raw = computed(() => {
      try {
        let v = fn(lastGood);
        return errored = !1, error = void 0, lastGood = v, v;
      } catch (e) {
        return errored = !0, error = e, reportError(e, "computed"), { [ERR]: e };
      }
    }), reader = () => {
      let v = raw();
      if (errored || isErrBox(v)) throw error;
      return v;
    };
    return Object.defineProperty(reader, "name", { value: raw.name, configurable: !0 }), reader;
  }

  // src/reactive/batch.ts
  function batch(fn) {
    startBatch();
    try {
      fn();
    } finally {
      endBatch();
    }
  }

  // src/security/url-safety.ts
  var URL_IGNORED_CHARS_RE = /[\u0000-\u0020\u007F-\u009F]/g, DANGEROUS_SCHEME_RE = /^(?:javascript|vbscript|data:text\/html)/i, SVG_DATA_URL_RE = /^data:image\/svg\+xml/i, IMAGE_CONTEXT_TAGS = /* @__PURE__ */ new Set([
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
  ]), URL_ATTRS = /* @__PURE__ */ new Set([
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
    return DANGEROUS_SCHEME_RE.test(normalized) ? !0 : SVG_DATA_URL_RE.test(normalized) ? tag === void 0 || !IMAGE_CONTEXT_TAGS.has(tag.toLowerCase()) : !1;
  }
  function isEventHandlerAttr(name) {
    return /^on/i.test(name);
  }
  function isUnsafeAttrWrite(tag, name, value2) {
    return isEventHandlerAttr(name) ? !0 : isUrlAttr(name) && isDangerousUrl(value2, tag);
  }
  var SAFE_ATTR_NAME_RE = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;
  function isSafeAttrName(name) {
    return SAFE_ATTR_NAME_RE.test(name);
  }

  // src/dom/activate.ts
  var scheduledOrActiveIslands = 0;
  function untrackIsland(el) {
    el.__formaTracked && (delete el.__formaTracked, scheduledOrActiveIslands--);
  }
  function hasScheduledOrActiveIslands() {
    return scheduledOrActiveIslands > 0;
  }
  function deactivateIsland(el) {
    let observer = el.__formaObserver;
    observer && (observer.disconnect(), delete el.__formaObserver);
    let interactionHandler = el.__formaInteractionHandler;
    interactionHandler && (el.removeEventListener("pointerdown", interactionHandler, !0), el.removeEventListener("focusin", interactionHandler, !0), delete el.__formaInteractionHandler);
    let idleCancel = el.__formaIdleCancel;
    idleCancel && (idleCancel(), delete el.__formaIdleCancel), delete el.__formaScheduled, untrackIsland(el), el.__formaDisposed = !0;
    let dispose = el.__formaDispose;
    typeof dispose == "function" && (dispose(), delete el.__formaDispose, el.setAttribute("data-forma-status", "disposed"));
  }

  // src/dom/list.ts
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
  function deactivateIslandsIn(node) {
    if (hasScheduledOrActiveIslands() && node instanceof Element) {
      node.hasAttribute("data-forma-island") && deactivateIsland(node);
      for (let nested of node.querySelectorAll("[data-forma-island]"))
        deactivateIsland(nested);
    }
  }
  function removeRow(parent, node, hooks) {
    if (hooks?.onBeforeRemove) {
      hooks.onBeforeRemove(node, () => {
        deactivateIslandsIn(node), node.parentNode && node.parentNode.removeChild(node);
      });
      return;
    }
    deactivateIslandsIn(node), parent.removeChild(node);
  }
  function reconcileSmall(parent, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks) {
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
      oldUsed[i] || removeRow(parent, oldNodes[i], hooks);
    if (oldLen === newLen) {
      let allSameOrder = !0;
      for (let i = 0; i < newLen; i++)
        if (oldIndices[i] !== i) {
          allSameOrder = !1;
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
    let newNodes = new Array(newLen), nextSibling = beforeNode ?? null;
    for (let i = newLen - 1; i >= 0; i--) {
      let node, isNew = !1;
      if (oldIndices[i] === -1)
        node = createFn(newItems[i]), isNew = !0;
      else if (node = oldNodes[oldIndices[i]], updateFn(node, newItems[i]), lisFlags[i]) {
        newNodes[i] = node, nextSibling = node;
        continue;
      }
      nextSibling ? parent.insertBefore(node, nextSibling) : parent.appendChild(node), isNew && hooks?.onInsert?.(node), newNodes[i] = node, nextSibling = node;
    }
    return { nodes: newNodes, items: newItems };
  }
  function reconcileList(parent, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks) {
    let oldLen = oldItems.length, newLen = newItems.length;
    if (newLen === 0) {
      for (let i = 0; i < oldLen; i++)
        removeRow(parent, oldNodes[i], hooks);
      return { nodes: [], items: [] };
    }
    if (oldLen === 0) {
      let nodes = new Array(newLen);
      for (let i = 0; i < newLen; i++) {
        let node = createFn(newItems[i]);
        beforeNode ? parent.insertBefore(node, beforeNode) : parent.appendChild(node), hooks?.onInsert?.(node), nodes[i] = node;
      }
      return { nodes, items: newItems };
    }
    if (oldLen < SMALL_LIST_THRESHOLD)
      return reconcileSmall(parent, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks);
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
      oldUsed[i] || removeRow(parent, oldNodes[i], hooks);
    if (oldLen === newLen) {
      let allSameOrder = !0;
      for (let i = 0; i < newLen; i++)
        if (oldIndices[i] !== i) {
          allSameOrder = !1;
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
    let newNodes = new Array(newLen), nextSibling = beforeNode ?? null;
    for (let i = newLen - 1; i >= 0; i--) {
      let node, isNew = !1;
      if (oldIndices[i] === -1)
        node = createFn(newItems[i]), isNew = !0;
      else if (node = oldNodes[oldIndices[i]], updateFn(node, newItems[i]), lisFlags[i]) {
        newNodes[i] = node, nextSibling = node;
        continue;
      }
      nextSibling ? parent.insertBefore(node, nextSibling) : parent.appendChild(node), isNew && hooks?.onInsert?.(node), newNodes[i] = node, nextSibling = node;
    }
    return { nodes: newNodes, items: newItems };
  }

  // src/dom/reconcile.ts
  function getBindTargets(el) {
    let targets = /* @__PURE__ */ new Set(), attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      let name = attrs[i].name;
      name.startsWith("data-bind:") && targets.add(name.slice(10));
    }
    return targets;
  }
  function ownsSubtree(el) {
    return el.hasAttribute("data-list") || el.hasAttribute("data-if");
  }
  function getStateKeys(json) {
    try {
      let obj = JSON.parse(json);
      return Object.keys(obj).sort();
    } catch {
      return [];
    }
  }
  function sameShape(keysA, keysB) {
    if (keysA.length !== keysB.length) return !1;
    for (let i = 0; i < keysA.length; i++)
      if (keysA[i] !== keysB[i]) return !1;
    return !0;
  }
  function determineScopeMode(liveEl, newEl) {
    let liveModule = liveEl.getAttribute("data-module"), newModule = newEl.getAttribute("data-module");
    if (liveModule !== newModule) return "REPLACE";
    let liveStateJSON = liveEl.__formaInitialState ?? liveEl.getAttribute("data-forma-state") ?? "{}", newStateJSON = newEl.getAttribute("data-forma-state") ?? "{}", liveKeys = getStateKeys(liveStateJSON), newKeys = getStateKeys(newStateJSON);
    return sameShape(liveKeys, newKeys) ? "PRESERVE" : "RESET";
  }
  var _parseTemplate = null;
  function parseHTML(html) {
    return _parseTemplate || (_parseTemplate = document.createElement("template")), _parseTemplate.innerHTML = html, _parseTemplate.content;
  }
  function patchAttributes(liveEl, newEl) {
    let bindTargets = getBindTargets(liveEl), hasDataShow = liveEl.hasAttribute("data-show"), hasDataModel = liveEl.hasAttribute("data-model"), liveHasClassDirectives = !1, liveAttrs = liveEl.attributes;
    for (let i = 0; i < liveAttrs.length; i++)
      if (liveAttrs[i].name.startsWith("data-class:")) {
        liveHasClassDirectives = !0;
        break;
      }
    let newAttrs = newEl.attributes;
    for (let i = 0; i < newAttrs.length; i++) {
      let attr = newAttrs[i];
      if (attr.name === "style" && hasDataShow || attr.name === "class" && liveHasClassDirectives || (attr.name === "value" || attr.name === "checked") && hasDataModel || bindTargets.has(attr.name)) continue;
      liveEl.getAttribute(attr.name) !== attr.value && liveEl.setAttribute(attr.name, attr.value);
    }
    for (let i = liveAttrs.length - 1; i >= 0; i--) {
      let attr = liveAttrs[i];
      if (!newEl.hasAttribute(attr.name)) {
        if (attr.name === "style" && hasDataShow || attr.name === "class" && liveHasClassDirectives || (attr.name === "value" || attr.name === "checked") && hasDataModel || bindTargets.has(attr.name)) continue;
        liveEl.removeAttribute(attr.name);
      }
    }
  }
  function patchTextNodes(liveEl, newEl) {
    if (liveEl.hasAttribute("data-text")) return;
    let liveTexts = [], newTexts = [];
    for (let child of Array.from(liveEl.childNodes))
      child.nodeType === Node.TEXT_NODE && liveTexts.push(child);
    for (let i = 0; i < newEl.childNodes.length; i++) {
      let child = newEl.childNodes[i];
      child.nodeType === Node.TEXT_NODE && newTexts.push({ node: child, index: i });
    }
    if (liveTexts.length === newTexts.length) {
      for (let i = 0; i < liveTexts.length; i++)
        liveTexts[i].textContent !== newTexts[i].node.textContent && (liveTexts[i].textContent = newTexts[i].node.textContent);
      return;
    }
    let usedLive = /* @__PURE__ */ new Set(), liveIdx = 0;
    for (let { node: newText, index: newChildIdx } of newTexts)
      if (liveIdx < liveTexts.length) {
        let liveText = liveTexts[liveIdx];
        liveIdx++, usedLive.add(liveText), liveText.textContent !== newText.textContent && (liveText.textContent = newText.textContent);
      } else {
        let ref = findTextInsertionRef(liveEl, newEl, newChildIdx);
        liveEl.insertBefore(document.createTextNode(newText.textContent ?? ""), ref);
      }
    for (let lt of liveTexts)
      !usedLive.has(lt) && lt.parentNode === liveEl && liveEl.removeChild(lt);
  }
  function findTextInsertionRef(liveEl, newEl, newIdx) {
    for (let j = newIdx + 1; j < newEl.childNodes.length; j++) {
      let sibling = newEl.childNodes[j];
      if (sibling.nodeType === Node.ELEMENT_NODE) {
        let key = sibling.getAttribute("data-forma-id");
        if (key) {
          let match = liveEl.querySelector(`[data-forma-id="${CSS.escape(key)}"]`);
          if (match && match.parentElement === liveEl) return match;
        }
      }
    }
    return null;
  }
  function diffChildren(liveParent, newParent, config) {
    if (ownsSubtree(liveParent)) return;
    patchTextNodes(liveParent, newParent);
    let liveChildren = Array.from(liveParent.children), newChildren = Array.from(newParent.children), liveKeyed = /* @__PURE__ */ new Map(), liveUnkeyed = [];
    for (let child of liveChildren) {
      if (child.hasAttribute("data-forma-leaving")) continue;
      let key = child.getAttribute("data-forma-id");
      key ? liveKeyed.set(key, child) : liveUnkeyed.push(child);
    }
    let unkeyedIdx = 0, usedLiveElements = /* @__PURE__ */ new Set();
    for (let newChild of newChildren) {
      let key = newChild.getAttribute("data-forma-id"), liveMatch;
      if (key)
        liveMatch = liveKeyed.get(key);
      else
        for (; unkeyedIdx < liveUnkeyed.length; ) {
          let candidate = liveUnkeyed[unkeyedIdx];
          if (unkeyedIdx++, candidate.tagName === newChild.tagName && !usedLiveElements.has(candidate)) {
            liveMatch = candidate;
            break;
          }
        }
      if (liveMatch) {
        if (usedLiveElements.add(liveMatch), liveMatch.hasAttribute("data-forma-state") && newChild.hasAttribute("data-forma-state"))
          switch (determineScopeMode(liveMatch, newChild)) {
            case "PRESERVE":
              patchAttributes(liveMatch, newChild), diffChildren(liveMatch, newChild, config);
              break;
            case "RESET":
              config.unmountScope(liveMatch), patchAttributes(liveMatch, newChild), replaceInnerContent(liveMatch, newChild), config.mountScope(liveMatch);
              break;
            case "REPLACE": {
              config.unmountScope(liveMatch);
              let replacement = newChild.cloneNode(!0);
              liveParent.replaceChild(replacement, liveMatch), config.mountScope(replacement), usedLiveElements.delete(liveMatch), liveMatch = replacement, usedLiveElements.add(replacement);
              break;
            }
          }
        else
          patchAttributes(liveMatch, newChild), diffChildren(liveMatch, newChild, config);
        ensurePosition(liveParent, liveMatch, newChild, newChildren);
      } else {
        let clone = newChild.cloneNode(!0), insertionRef = findInsertionPoint(liveParent, newChild, newChildren);
        liveParent.insertBefore(clone, insertionRef), usedLiveElements.add(clone), clone.hasAttribute("data-forma-state") && config.mountScope(clone);
        let nestedScopes = clone.querySelectorAll("[data-forma-state]");
        for (let nested of Array.from(nestedScopes))
          config.mountScope(nested);
      }
    }
    for (let child of liveChildren)
      if (!usedLiveElements.has(child)) {
        if (child.parentElement !== liveParent || child.hasAttribute("data-forma-leaving")) continue;
        child.hasAttribute("data-forma-state") && config.unmountScope(child);
        let nestedScopes = child.querySelectorAll("[data-forma-state]");
        for (let nested of Array.from(nestedScopes))
          config.unmountScope(nested);
        liveParent.removeChild(child);
      }
  }
  function replaceInnerContent(liveEl, newEl) {
    for (; liveEl.firstChild; )
      liveEl.removeChild(liveEl.firstChild);
    for (let child of Array.from(newEl.childNodes))
      liveEl.appendChild(child.cloneNode(!0));
  }
  function ensurePosition(parent, liveEl, _newEl, newChildren) {
    let newIdx = newChildren.indexOf(_newEl);
    if (Array.from(parent.children).indexOf(liveEl) !== newIdx) {
      let nextNewChild = newChildren[newIdx + 1];
      if (nextNewChild) {
        let nextKey = nextNewChild.getAttribute("data-forma-id");
        if (nextKey) {
          let nextLive = parent.querySelector(`[data-forma-id="${CSS.escape(nextKey)}"]`);
          if (nextLive && nextLive.parentElement === parent) {
            parent.insertBefore(liveEl, nextLive);
            return;
          }
        }
      }
      parent.appendChild(liveEl);
    }
  }
  function findInsertionPoint(parent, newChild, newChildren) {
    let newIdx = newChildren.indexOf(newChild);
    for (let i = newIdx + 1; i < newChildren.length; i++) {
      let key = newChildren[i].getAttribute("data-forma-id");
      if (key) {
        let existing = parent.querySelector(`[data-forma-id="${CSS.escape(key)}"]`);
        if (existing && existing.parentElement === parent)
          return existing;
      }
    }
    return null;
  }
  function createReconciler(config) {
    let lastHtmlByContainer = /* @__PURE__ */ new WeakMap();
    return function(container, html) {
      let trimmed = html.trim();
      if (trimmed && !(lastHtmlByContainer.get(container) === trimmed && container.hasChildNodes())) {
        lastHtmlByContainer.set(container, trimmed), config.disconnectObserver();
        try {
          if (!container.hasChildNodes() || container.children.length === 0) {
            container.innerHTML = trimmed, config.batch(() => {
              let scopes = container.querySelectorAll("[data-forma-state]");
              for (let scope of Array.from(scopes))
                config.mountScope(scope);
            });
            return;
          }
          let fragment = parseHTML(trimmed), templateContainer = document.createElement("div");
          templateContainer.appendChild(fragment);
          let liveKeys = /* @__PURE__ */ new Set();
          for (let child of Array.from(container.children)) {
            if (child.hasAttribute("data-forma-leaving")) continue;
            let key = child.getAttribute("data-forma-id");
            key && liveKeys.add(key);
          }
          let hasOverlap = !1;
          if (liveKeys.size > 0)
            for (let child of Array.from(templateContainer.children)) {
              let key = child.getAttribute("data-forma-id");
              if (key && liveKeys.has(key)) {
                hasOverlap = !0;
                break;
              }
            }
          if (liveKeys.size > 0 && !hasOverlap) {
            config.batch(() => {
              let liveScopes = container.querySelectorAll("[data-forma-state]");
              for (let scope of Array.from(liveScopes))
                config.unmountScope(scope);
              container.innerHTML = trimmed;
              let newScopes = container.querySelectorAll("[data-forma-state]");
              for (let scope of Array.from(newScopes))
                config.mountScope(scope);
            });
            return;
          }
          config.batch(() => {
            diffChildren(container, templateContainer, config);
          });
        } finally {
          config.reconnectObserver();
        }
      }
    };
  }

  // src/expr/errors.ts
  var EXPR_ERROR = /* @__PURE__ */ Symbol.for("forma.expr.error");
  function exprError(code, message, column = -1) {
    let err = new Error(message);
    return err.name = "FormaExpressionError", err.code = code, err.column = column, err[EXPR_ERROR] = !0, err;
  }
  function isExprError(e) {
    return typeof e == "object" && e !== null && e[EXPR_ERROR] === !0;
  }

  // src/expr/ast.ts
  var LIMITS = Object.freeze({
    MAX_SOURCE_LENGTH: 4096,
    MAX_AST_NODES: 512,
    MAX_AST_DEPTH: 32,
    MAX_ARROW_DEPTH: 2,
    MAX_CALL_ARGS: 4,
    MAX_ARROW_PARAMS: 3,
    MAX_OBJECT_KEYS: 24,
    MAX_ARRAY_ELEMENTS: 64,
    STEP_BUDGET: 1e5,
    MAX_ARRAY_LENGTH: 1e6,
    MAX_STRING_LENGTH: 1048576,
    MAX_REPEAT_COUNT: 1e4,
    MAX_FLAT_DEPTH: 8
  });

  // src/expr/host.ts
  var HOST = /* @__PURE__ */ Symbol.for("forma.expr.host");
  function brand(host) {
    return Object.freeze({ ...host, [HOST]: !0 });
  }
  function sealedTable(members) {
    return Object.freeze(
      Object.assign(/* @__PURE__ */ Object.create(null), members)
    );
  }
  function hostObject(kind, target, label) {
    return brand({ kind, label, target, maxArgs: 0 });
  }
  function hostNamespace(label, members) {
    return brand({ kind: "namespace", label, target: null, members: sealedTable(members), maxArgs: 0 });
  }
  function hostFn(label, fn, maxArgs, members) {
    return brand({
      kind: "fn",
      label,
      target: fn,
      members: members ? sealedTable(members) : void 0,
      maxArgs
    });
  }
  function isHost(v) {
    return typeof v == "object" && v !== null && v[HOST] === !0;
  }

  // src/expr/allowlist.ts
  var DENY_KEYS = /* @__PURE__ */ new Set([
    "constructor",
    "__proto__",
    "prototype",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "eval",
    "Function",
    "call",
    "apply",
    "bind",
    "caller",
    "callee",
    "arguments"
  ]), MAX_KEY_LENGTH = 128;
  function table(entries) {
    return Object.freeze(Object.assign(/* @__PURE__ */ Object.create(null), entries));
  }
  var AP = Array.prototype, SP = String.prototype, NP = Number.prototype, ARRAY_METHODS = table({
    at: AP.at,
    concat: AP.concat,
    every: AP.every,
    filter: AP.filter,
    find: AP.find,
    findIndex: AP.findIndex,
    flat: AP.flat,
    flatMap: AP.flatMap,
    includes: AP.includes,
    indexOf: AP.indexOf,
    join: AP.join,
    lastIndexOf: AP.lastIndexOf,
    map: AP.map,
    reduce: AP.reduce,
    reverse: AP.reverse,
    slice: AP.slice,
    some: AP.some,
    sort: AP.sort
  }), ARRAY_COPY_FIRST = /* @__PURE__ */ new Set(["sort", "reverse"]), STRING_METHODS = table({
    at: SP.at,
    charAt: SP.charAt,
    charCodeAt: SP.charCodeAt,
    concat: SP.concat,
    endsWith: SP.endsWith,
    includes: SP.includes,
    indexOf: SP.indexOf,
    lastIndexOf: SP.lastIndexOf,
    padEnd: SP.padEnd,
    padStart: SP.padStart,
    repeat: SP.repeat,
    replace: SP.replace,
    replaceAll: SP.replaceAll,
    slice: SP.slice,
    split: SP.split,
    startsWith: SP.startsWith,
    substring: SP.substring,
    toLowerCase: SP.toLowerCase,
    toUpperCase: SP.toUpperCase,
    trim: SP.trim,
    trimEnd: SP.trimEnd,
    trimStart: SP.trimStart
  }), NUMBER_METHODS = table({
    toFixed: NP.toFixed,
    toPrecision: NP.toPrecision,
    toString: NP.toString
  }), HOF_CALLBACK_PARAMS = table({
    every: 2,
    filter: 2,
    find: 2,
    findIndex: 2,
    flatMap: 2,
    map: 2,
    reduce: 3,
    some: 2,
    sort: 2
  }), ELEMENT_READ_PROPS = /* @__PURE__ */ new Set([
    "checked",
    "childElementCount",
    "className",
    "clientHeight",
    "clientWidth",
    "disabled",
    "hidden",
    "id",
    "innerText",
    "max",
    "min",
    "name",
    "nodeName",
    "offsetHeight",
    "offsetLeft",
    "offsetTop",
    "offsetWidth",
    "pattern",
    "placeholder",
    "readOnly",
    "required",
    "scrollHeight",
    "scrollLeft",
    "scrollTop",
    "scrollWidth",
    "selected",
    "step",
    "tagName",
    "textContent",
    "type",
    "value"
  ]), ELEMENT_WRITE_PROPS = /* @__PURE__ */ new Set([
    "checked",
    "className",
    "disabled",
    "hidden",
    "id",
    "innerText",
    "max",
    "min",
    "name",
    "pattern",
    "placeholder",
    "readOnly",
    "required",
    "scrollLeft",
    "scrollTop",
    "selected",
    "step",
    "textContent",
    "type",
    "value"
  ]), ELEMENT_METHODS = /* @__PURE__ */ new Set([
    "blur",
    "click",
    "closest",
    "focus",
    "getAttribute",
    "getBoundingClientRect",
    "hasAttribute",
    "matches",
    "querySelector",
    "querySelectorAll",
    "removeAttribute",
    "scrollIntoView",
    "setAttribute",
    "toggleAttribute"
  ]), ELEMENT_HOST_PROPS = table({
    classList: "classList",
    dataset: "dataset",
    style: "style",
    children: "elementList",
    firstElementChild: "element",
    lastElementChild: "element",
    nextElementSibling: "element",
    previousElementSibling: "element"
  }), ELEMENT_METHOD_RESULT = table({
    closest: "element",
    querySelector: "element",
    querySelectorAll: "elementList",
    getBoundingClientRect: "rect"
  }), RECT_KEYS = ["x", "y", "width", "height", "top", "right", "bottom", "left"], EVENT_READ_PROPS = /* @__PURE__ */ new Set([
    "altKey",
    "button",
    "clientX",
    "clientY",
    "code",
    "ctrlKey",
    "deltaX",
    "deltaY",
    "detail",
    "isTrusted",
    "key",
    "metaKey",
    "repeat",
    "shiftKey",
    "type"
  ]), EVENT_METHODS = /* @__PURE__ */ new Set([
    "preventDefault",
    "stopImmediatePropagation",
    "stopPropagation"
  ]), EVENT_HOST_PROPS = /* @__PURE__ */ new Set(["currentTarget", "target"]), CLASSLIST_METHODS = /* @__PURE__ */ new Set([
    "add",
    "contains",
    "remove",
    "replace",
    "toggle"
  ]), CLASSLIST_READ_PROPS = /* @__PURE__ */ new Set(["length", "value"]), STYLE_METHODS = /* @__PURE__ */ new Set([
    "getPropertyValue",
    "removeProperty",
    "setProperty"
  ]), STYLE_DENY_PROPS = /* @__PURE__ */ new Set(["cssText"]), SAFE_GLOBALS = table({
    Math: hostNamespace("Math", {
      abs: Math.abs,
      ceil: Math.ceil,
      floor: Math.floor,
      round: Math.round,
      trunc: Math.trunc,
      sign: Math.sign,
      min: Math.min,
      max: Math.max,
      pow: Math.pow,
      sqrt: Math.sqrt,
      cbrt: Math.cbrt,
      log: Math.log,
      log2: Math.log2,
      log10: Math.log10,
      exp: Math.exp,
      random: Math.random,
      hypot: Math.hypot,
      PI: Math.PI,
      E: Math.E
    }),
    JSON: hostNamespace("JSON", { parse: JSON.parse, stringify: JSON.stringify }),
    Object: hostNamespace("Object", {
      entries: Object.entries,
      keys: Object.keys,
      values: Object.values
    }),
    Array: hostNamespace("Array", { from: Array.from, isArray: Array.isArray, of: Array.of }),
    Date: hostNamespace("Date", { now: Date.now }),
    Number: hostFn("Number", Number, 1, {
      EPSILON: Number.EPSILON,
      MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
      MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
      isFinite: Number.isFinite,
      isInteger: Number.isInteger,
      isNaN: Number.isNaN,
      parseFloat: Number.parseFloat,
      parseInt: Number.parseInt
    }),
    String: hostFn("String", String, 1, { fromCharCode: String.fromCharCode }),
    Boolean: hostFn("Boolean", Boolean, 1),
    parseInt: hostFn("parseInt", parseInt, 2),
    parseFloat: hostFn("parseFloat", parseFloat, 1)
  });

  // src/expr/lexer.ts
  var PUNCTUATORS = [
    "===",
    "!==",
    "?.",
    "??",
    "=>",
    "&&",
    "||",
    "++",
    "--",
    "+=",
    "-=",
    "*=",
    "/=",
    "==",
    "!=",
    "<=",
    ">=",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    ",",
    ".",
    ";",
    ":",
    "?",
    "+",
    "-",
    "*",
    "/",
    "%",
    "!",
    "<",
    ">",
    "="
  ], SIMPLE_ESCAPES = Object.freeze({
    n: `
`,
    t: "	",
    r: "\r",
    "\\": "\\",
    "'": "'",
    '"': '"',
    "`": "`",
    0: "\0"
  }), SQ = "'", DQ = '"', BT = "`", BS = "\\";
  function isDigit(ch) {
    return ch >= "0" && ch <= "9";
  }
  function isIdentStart(ch) {
    return ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z" || ch === "_" || ch === "$";
  }
  function isIdentPart(ch) {
    return isIdentStart(ch) || isDigit(ch);
  }
  function isSpace(ch) {
    return ch === " " || ch === "	" || ch === `
` || ch === "\r";
  }
  function readEscape(src, i, base) {
    let ch = src[i + 1];
    if (ch === void 0)
      throw exprError("FORMA_E_SYNTAX", "unterminated escape sequence", base + i);
    let decoded = Object.hasOwn(SIMPLE_ESCAPES, ch) ? SIMPLE_ESCAPES[ch] : void 0;
    if (decoded === void 0)
      throw exprError(
        "FORMA_E_SYNTAX",
        `escape sequence "\\${ch}" is not allowed (only \\n \\t \\r \\\\ \\' \\" \\\` \\0)`,
        base + i
      );
    return { text: decoded, next: i + 2 };
  }
  function readTemplate(src, start, base) {
    let quasis = [], exprs = [], exprAt = [], chunk = "", i = start + 1;
    for (; i < src.length; ) {
      let ch = src[i];
      if (ch === BT)
        return quasis.push(chunk), {
          tok: { t: "tmpl", v: "", quasis, exprs, exprAt, i: base + start },
          next: i + 1
        };
      if (ch === BS) {
        let esc = readEscape(src, i, base);
        chunk += esc.text, i = esc.next;
        continue;
      }
      if (ch === "$" && src[i + 1] === "{") {
        quasis.push(chunk), chunk = "";
        let inner = readInterpolation(src, i + 2, base);
        exprs.push(inner.text), exprAt.push(base + i + 2), i = inner.next;
        continue;
      }
      chunk += ch, i++;
    }
    throw exprError("FORMA_E_SYNTAX", "unterminated template literal", base + start);
  }
  function readInterpolation(src, start, base) {
    let depth = 0, i = start;
    for (; i < src.length; ) {
      let ch = src[i];
      if (ch === SQ || ch === DQ) {
        i = skipQuoted(src, i, ch, base);
        continue;
      }
      if (ch === BT) {
        i = readTemplate(src, i, base).next;
        continue;
      }
      if (ch === "{") {
        depth++, i++;
        continue;
      }
      if (ch === "}") {
        if (depth === 0) return { text: src.slice(start, i), next: i + 1 };
        depth--, i++;
        continue;
      }
      i++;
    }
    throw exprError("FORMA_E_SYNTAX", "unterminated ${\u2026} interpolation", base + start);
  }
  function skipQuoted(src, i, quote, base) {
    let j = i + 1;
    for (; j < src.length; ) {
      let ch = src[j];
      if (ch === BS) {
        j = readEscape(src, j, base).next;
        continue;
      }
      if (ch === quote) return j + 1;
      j++;
    }
    throw exprError("FORMA_E_SYNTAX", "unterminated string literal", base + i);
  }
  function lex(src, base = 0) {
    let out = [], i = 0;
    for (; i < src.length; ) {
      let ch = src[i];
      if (isSpace(ch)) {
        i++;
        continue;
      }
      if (isDigit(ch)) {
        let j = i + 1;
        for (; j < src.length && isDigit(src[j]); ) j++;
        if (src[j] === "." && isDigit(src[j + 1] ?? ""))
          for (j += 2; j < src.length && isDigit(src[j]); ) j++;
        let text = src.slice(i, j);
        if (isIdentStart(src[j] ?? "") || src[j] === ".")
          throw exprError("FORMA_E_SYNTAX", `malformed number "${text}${src[j]}"`, base + i);
        out.push({ t: "num", v: text, n: Number(text), i: base + i }), i = j;
        continue;
      }
      if (isIdentStart(ch)) {
        let j = i + 1;
        for (; j < src.length && isIdentPart(src[j]); ) j++;
        out.push({ t: "name", v: src.slice(i, j), i: base + i }), i = j;
        continue;
      }
      if (ch === SQ || ch === DQ) {
        let value2 = "", j = i + 1, closed = !1;
        for (; j < src.length; ) {
          let c = src[j];
          if (c === BS) {
            let esc = readEscape(src, j, base);
            value2 += esc.text, j = esc.next;
            continue;
          }
          if (c === ch) {
            closed = !0, j++;
            break;
          }
          value2 += c, j++;
        }
        if (!closed) throw exprError("FORMA_E_SYNTAX", "unterminated string literal", base + i);
        out.push({ t: "str", v: value2, i: base + i }), i = j;
        continue;
      }
      if (ch === BT) {
        let { tok, next } = readTemplate(src, i, base);
        out.push(tok), i = next;
        continue;
      }
      let matched = "";
      for (let p of PUNCTUATORS)
        if (src.startsWith(p, i)) {
          matched = p;
          break;
        }
      if (!matched)
        throw exprError("FORMA_E_SYNTAX", `unexpected character "${ch}"`, base + i);
      out.push({ t: "punc", v: matched, i: base + i }), i += matched.length;
    }
    return out.push({ t: "eof", v: "", i: base + src.length }), out;
  }

  // src/expr/parser.ts
  var BINDING = {
    "??": 3,
    "||": 4,
    "&&": 5,
    "===": 8,
    "!==": 8,
    "==": 8,
    "!=": 8,
    "<": 9,
    ">": 9,
    "<=": 9,
    ">=": 9,
    "+": 11,
    "-": 11,
    "*": 12,
    "/": 12,
    "%": 12
  }, ASSIGN_OPS = /* @__PURE__ */ new Set(["=", "+=", "-=", "*=", "/="]), RESERVED = /* @__PURE__ */ new Set(["true", "false", "null", "undefined", "typeof", "if", "else"]);
  function state(toks) {
    return { toks, pos: 0, nodes: 0, depth: 0, arrowDepth: 0 };
  }
  function peek(st) {
    return st.toks[st.pos];
  }
  function isPunc(tok, v) {
    return tok.t === "punc" && tok.v === v;
  }
  function expectPunc(st, v) {
    let tok = peek(st);
    if (!isPunc(tok, v))
      throw exprError("FORMA_E_SYNTAX", `expected "${v}" but found ${describe(tok)}`, tok.i);
    return st.pos++, tok;
  }
  function describe(tok) {
    return tok.t === "eof" ? "end of expression" : tok.t === "str" ? "a string literal" : tok.t === "tmpl" ? "a template literal" : `"${tok.v}"`;
  }
  function mk(st, node) {
    if (st.nodes++, st.nodes > LIMITS.MAX_AST_NODES)
      throw exprError("FORMA_E_LIMIT", `expression has more than ${LIMITS.MAX_AST_NODES} nodes`, node.i);
    return node;
  }
  function checkStaticKey(name, at) {
    if (DENY_KEYS.has(name))
      throw exprError("FORMA_E_KEY_DENIED", `property "${name}" is never accessible`, at);
    if (name.length > MAX_KEY_LENGTH)
      throw exprError("FORMA_E_KEY_DENIED", "property name is too long", at);
    return name;
  }
  function parseConditional(st) {
    let test = parseBinary(st, 0), tok = peek(st);
    if (isPunc(tok, "?")) {
      st.pos++;
      let then = parseConditional(st);
      expectPunc(st, ":");
      let otherwise = parseConditional(st);
      return mk(st, { k: "Conditional", test, then, else: otherwise, i: test.i });
    }
    return test;
  }
  function parseBinary(st, minBp) {
    if (st.depth++, st.depth > LIMITS.MAX_AST_DEPTH)
      throw exprError("FORMA_E_LIMIT", `expression nests deeper than ${LIMITS.MAX_AST_DEPTH}`, peek(st).i);
    try {
      let left = parseUnary(st);
      for (; ; ) {
        let tok = peek(st);
        if (tok.t !== "punc") break;
        let bp = BINDING[tok.v];
        if (bp === void 0 || bp < minBp) break;
        st.pos++;
        let right = parseBinary(st, bp + 1);
        tok.v === "&&" || tok.v === "||" || tok.v === "??" ? (rejectNullishMix(tok.v, left, right, tok.i), left = mk(st, { k: "Logical", op: tok.v, left, right, i: tok.i })) : left = mk(st, { k: "Binary", op: tok.v, left, right, i: tok.i });
      }
      return left;
    } finally {
      st.depth--;
    }
  }
  function rejectNullishMix(op, left, right, at) {
    for (let side of [left, right])
      if (side.k === "Logical" && side.paren !== !0 && side.op === "??" != (op === "??"))
        throw exprError(
          "FORMA_E_SYNTAX",
          `"${op}" and "${side.op}" cannot be mixed without parentheses`,
          at
        );
  }
  function parseUnary(st) {
    let tok = peek(st);
    return tok.t === "punc" && (tok.v === "!" || tok.v === "-" || tok.v === "+") ? (st.pos++, mk(st, { k: "Unary", op: tok.v, arg: parseUnary(st), i: tok.i })) : tok.t === "name" && tok.v === "typeof" ? (st.pos++, mk(st, { k: "Unary", op: "typeof", arg: parseUnary(st), i: tok.i })) : parsePostfix(st);
  }
  function parsePostfix(st) {
    let node = parsePrimary(st);
    for (; ; ) {
      let tok = peek(st);
      if (isPunc(tok, ".")) {
        st.pos++, node = mk(st, { k: "Member", object: node, key: readMemberName(st), optional: !1, i: tok.i });
        continue;
      }
      if (isPunc(tok, "?.")) {
        st.pos++;
        let next = peek(st);
        if (isPunc(next, "[")) {
          st.pos++;
          let key = parseConditional(st);
          expectPunc(st, "]"), node = mk(st, { k: "Computed", object: node, key, optional: !0, i: tok.i });
        } else isPunc(next, "(") ? node = mk(st, { k: "Call", callee: node, args: parseArgs(st), optional: !0, i: tok.i }) : node = mk(st, { k: "Member", object: node, key: readMemberName(st), optional: !0, i: tok.i });
        continue;
      }
      if (isPunc(tok, "[")) {
        st.pos++;
        let key = parseConditional(st);
        expectPunc(st, "]"), node = mk(st, { k: "Computed", object: node, key, optional: !1, i: tok.i });
        continue;
      }
      if (isPunc(tok, "(")) {
        node = mk(st, { k: "Call", callee: node, args: parseArgs(st), optional: !1, i: tok.i });
        continue;
      }
      break;
    }
    return node;
  }
  function readMemberName(st) {
    let tok = peek(st);
    if (tok.t !== "name")
      throw exprError("FORMA_E_SYNTAX", `expected a property name but found ${describe(tok)}`, tok.i);
    return st.pos++, checkStaticKey(tok.v, tok.i);
  }
  function parseArgs(st) {
    let open = expectPunc(st, "("), args = [];
    if (!isPunc(peek(st), ")"))
      for (; ; ) {
        if (args.push(parseConditional(st)), isPunc(peek(st), ",")) {
          st.pos++;
          continue;
        }
        break;
      }
    if (expectPunc(st, ")"), args.length > LIMITS.MAX_CALL_ARGS)
      throw exprError("FORMA_E_LIMIT", `a call takes at most ${LIMITS.MAX_CALL_ARGS} arguments`, open.i);
    return args;
  }
  function isArrowAhead(st) {
    let depth = 0;
    for (let i = st.pos; i < st.toks.length; i++) {
      let tok = st.toks[i];
      if (tok.t === "punc") {
        if (tok.v === "(") depth++;
        else if (tok.v === ")" && (depth--, depth === 0))
          return isPunc(st.toks[i + 1] ?? { t: "eof", v: "", i: 0 }, "=>");
      }
    }
    return !1;
  }
  function parseArrow(st, params, at) {
    expectPunc(st, "=>");
    let bodyTok = peek(st);
    if (isPunc(bodyTok, "{"))
      throw exprError(
        "FORMA_E_UNSUPPORTED",
        "an arrow function body must be a single expression \u2014 block bodies are not supported",
        bodyTok.i
      );
    if (params.length > LIMITS.MAX_ARROW_PARAMS)
      throw exprError("FORMA_E_LIMIT", `an arrow function takes at most ${LIMITS.MAX_ARROW_PARAMS} parameters`, at);
    if (st.arrowDepth++, st.arrowDepth > LIMITS.MAX_ARROW_DEPTH)
      throw exprError("FORMA_E_LIMIT", `arrow functions nest at most ${LIMITS.MAX_ARROW_DEPTH} deep`, at);
    try {
      let body = parseConditional(st);
      return mk(st, { k: "Arrow", params, body, i: at });
    } finally {
      st.arrowDepth--;
    }
  }
  function parsePrimary(st) {
    let tok = peek(st);
    if (tok.t === "num")
      return st.pos++, mk(st, { k: "Literal", value: tok.n, i: tok.i });
    if (tok.t === "str")
      return st.pos++, mk(st, { k: "Literal", value: tok.v, i: tok.i });
    if (tok.t === "tmpl") {
      st.pos++;
      let exprs = (tok.exprs ?? []).map((src, n) => parseSub(st, src, tok.exprAt[n]));
      return mk(st, { k: "Template", quasis: tok.quasis, exprs, i: tok.i });
    }
    if (tok.t === "name") {
      if (tok.v === "true" || tok.v === "false")
        return st.pos++, mk(st, { k: "Literal", value: tok.v === "true", i: tok.i });
      if (tok.v === "null")
        return st.pos++, mk(st, { k: "Literal", value: null, i: tok.i });
      if (tok.v === "undefined")
        return st.pos++, mk(st, { k: "Literal", value: void 0, i: tok.i });
      if (RESERVED.has(tok.v))
        throw exprError("FORMA_E_SYNTAX", `"${tok.v}" cannot be used here`, tok.i);
      return st.pos++, isPunc(peek(st), "=>") ? parseArrow(st, [tok.v], tok.i) : mk(st, { k: "Identifier", name: tok.v, i: tok.i });
    }
    if (isPunc(tok, "(")) {
      if (isArrowAhead(st)) {
        st.pos++;
        let params = [];
        if (!isPunc(peek(st), ")"))
          for (; ; ) {
            let p = peek(st);
            if (p.t !== "name" || RESERVED.has(p.v))
              throw exprError(
                "FORMA_E_UNSUPPORTED",
                "arrow parameters must be plain identifiers \u2014 no destructuring, defaults or rest",
                p.i
              );
            if (st.pos++, params.push(p.v), isPunc(peek(st), ",")) {
              st.pos++;
              continue;
            }
            break;
          }
        return expectPunc(st, ")"), parseArrow(st, params, tok.i);
      }
      st.pos++;
      let inner = parseConditional(st);
      return expectPunc(st, ")"), inner.k === "Logical" && (inner.paren = !0), inner;
    }
    if (isPunc(tok, "[")) {
      st.pos++;
      let elements = [];
      if (!isPunc(peek(st), "]"))
        for (; ; ) {
          if (elements.push(parseConditional(st)), isPunc(peek(st), ",")) {
            if (st.pos++, isPunc(peek(st), "]")) break;
            continue;
          }
          break;
        }
      if (expectPunc(st, "]"), elements.length > LIMITS.MAX_ARRAY_ELEMENTS)
        throw exprError("FORMA_E_LIMIT", `an array literal holds at most ${LIMITS.MAX_ARRAY_ELEMENTS} elements`, tok.i);
      return mk(st, { k: "ArrayLit", elements, i: tok.i });
    }
    if (isPunc(tok, "{")) {
      st.pos++;
      let keys = [], values = [];
      if (!isPunc(peek(st), "}"))
        for (; ; ) {
          let keyTok = peek(st), key;
          if (keyTok.t === "name") key = checkStaticKey(keyTok.v, keyTok.i);
          else if (keyTok.t === "str") key = checkStaticKey(keyTok.v, keyTok.i);
          else
            throw exprError(
              "FORMA_E_UNSUPPORTED",
              "object keys must be identifiers or string literals \u2014 computed keys and spread are not supported",
              keyTok.i
            );
          if (st.pos++, isPunc(peek(st), ":"))
            st.pos++, values.push(parseConditional(st));
          else if (keyTok.t === "name")
            values.push(mk(st, { k: "Identifier", name: key, i: keyTok.i }));
          else
            throw exprError("FORMA_E_SYNTAX", 'expected ":" after a string object key', keyTok.i);
          if (keys.push(key), isPunc(peek(st), ",")) {
            if (st.pos++, isPunc(peek(st), "}")) break;
            continue;
          }
          break;
        }
      if (expectPunc(st, "}"), keys.length > LIMITS.MAX_OBJECT_KEYS)
        throw exprError("FORMA_E_LIMIT", `an object literal holds at most ${LIMITS.MAX_OBJECT_KEYS} keys`, tok.i);
      return mk(st, { k: "ObjectLit", keys, values, i: tok.i });
    }
    throw exprError("FORMA_E_SYNTAX", `unexpected ${describe(tok)}`, tok.i);
  }
  function parseSub(st, src, at) {
    let sub = {
      toks: lex(src, at),
      pos: 0,
      nodes: st.nodes,
      depth: st.depth,
      arrowDepth: st.arrowDepth
    }, expr = parseConditional(sub), trailing = peek(sub);
    if (trailing.t !== "eof")
      throw exprError("FORMA_E_SYNTAX", `unexpected ${describe(trailing)} in \${\u2026}`, trailing.i);
    return st.nodes = sub.nodes, expr;
  }
  function assertTarget(node, at) {
    if (node.k === "Identifier" || node.k === "Member" || node.k === "Computed") return node;
    throw exprError("FORMA_E_UNSUPPORTED", "assignment target must be a name or a property path", at);
  }
  function parseStmt(st) {
    let tok = peek(st);
    if (tok.t === "name" && tok.v === "if") {
      st.pos++, expectPunc(st, "(");
      let test = parseConditional(st);
      expectPunc(st, ")");
      let then = parseBlockOrStmt(st), otherwise = null, mark = st.pos;
      for (; isPunc(peek(st), ";"); ) st.pos++;
      let next = peek(st);
      return next.t === "name" && next.v === "else" ? (st.pos++, otherwise = parseBlockOrStmt(st)) : st.pos = mark, mk(st, { k: "If", test, then, else: otherwise, i: tok.i });
    }
    if (isPunc(tok, "++") || isPunc(tok, "--")) {
      st.pos++;
      let target = assertTarget(parsePostfix(st), tok.i);
      return mk(st, { k: "Update", target, op: tok.v, prefix: !0, i: tok.i });
    }
    let expr = parseConditional(st), after = peek(st);
    if (isPunc(after, "++") || isPunc(after, "--"))
      return st.pos++, mk(st, {
        k: "Update",
        target: assertTarget(expr, after.i),
        op: after.v,
        prefix: !1,
        i: expr.i
      });
    if (after.t === "punc" && ASSIGN_OPS.has(after.v)) {
      st.pos++;
      let value2 = parseConditional(st);
      return mk(st, {
        k: "Assign",
        target: assertTarget(expr, after.i),
        op: after.v,
        value: value2,
        i: expr.i
      });
    }
    return mk(st, { k: "ExprStmt", expr, i: expr.i });
  }
  function parseBlockOrStmt(st) {
    if (isPunc(peek(st), "{")) {
      st.pos++;
      let out = [];
      for (; isPunc(peek(st), ";"); ) st.pos++;
      for (; !isPunc(peek(st), "}"); ) {
        if (peek(st).t === "eof")
          throw exprError("FORMA_E_SYNTAX", "unterminated block", peek(st).i);
        let stmt = parseStmt(st);
        out.push(stmt);
        let sawSeparator = !1;
        for (; isPunc(peek(st), ";"); )
          st.pos++, sawSeparator = !0;
        if (!sawSeparator && stmt.k !== "If" && !isPunc(peek(st), "}"))
          throw exprError("FORMA_E_SYNTAX", `expected ";" between statements, found ${describe(peek(st))}`, peek(st).i);
      }
      return st.pos++, out;
    }
    return [parseStmt(st)];
  }
  function checkLength(source) {
    if (source.length > LIMITS.MAX_SOURCE_LENGTH)
      throw exprError(
        "FORMA_E_LIMIT",
        `expression is longer than ${LIMITS.MAX_SOURCE_LENGTH} characters`,
        0
      );
  }
  function parseExpression(source) {
    checkLength(source);
    let st = state(lex(source));
    if (peek(st).t === "eof")
      throw exprError("FORMA_E_SYNTAX", "empty expression", 0);
    let expr = parseConditional(st), trailing = peek(st);
    if (trailing.t !== "eof")
      throw exprError("FORMA_E_SYNTAX", `unexpected ${describe(trailing)}`, trailing.i);
    return expr;
  }
  function parseProgram(source) {
    checkLength(source);
    let st = state(lex(source)), out = [];
    for (; isPunc(peek(st), ";"); ) st.pos++;
    for (; peek(st).t !== "eof"; ) {
      let stmt = parseStmt(st);
      out.push(stmt);
      let sawSeparator = !1;
      for (; isPunc(peek(st), ";"); )
        st.pos++, sawSeparator = !0;
      if (!sawSeparator && stmt.k !== "If" && peek(st).t !== "eof")
        throw exprError("FORMA_E_SYNTAX", `expected ";" between statements, found ${describe(peek(st))}`, peek(st).i);
    }
    if (out.length === 0)
      throw exprError("FORMA_E_SYNTAX", "empty handler", 0);
    return out;
  }

  // src/expr/validate.ts
  function tooDeep(at) {
    throw exprError("FORMA_E_LIMIT", `expression nests deeper than ${LIMITS.MAX_AST_DEPTH}`, at);
  }
  function walk(node, depth, slot) {
    depth > LIMITS.MAX_AST_DEPTH && tooDeep(node.i);
    let d = depth + 1;
    switch (node.k) {
      case "Literal":
      case "Identifier":
        return;
      case "Template":
        for (let e of node.exprs) walk(e, d, null);
        return;
      case "ArrayLit":
        for (let e of node.elements) walk(e, d, null);
        return;
      case "ObjectLit":
        for (let e of node.values) walk(e, d, null);
        return;
      case "Unary":
        walk(node.arg, d, null);
        return;
      case "Binary":
      case "Logical":
        walk(node.left, d, null), walk(node.right, d, null);
        return;
      case "Conditional":
        walk(node.test, d, null), walk(node.then, d, null), walk(node.else, d, null);
        return;
      case "Member":
        walk(node.object, d, null);
        return;
      case "Computed":
        walk(node.object, d, null), walk(node.key, d, null);
        return;
      case "Call": {
        walk(node.callee, d, null);
        let method = node.callee.k === "Member" ? node.callee.key : "", callbackParams = Object.hasOwn(HOF_CALLBACK_PARAMS, method) ? HOF_CALLBACK_PARAMS[method] : null;
        node.args.forEach((arg, index) => {
          walk(arg, d, index === 0 ? callbackParams : null);
        });
        return;
      }
      case "Arrow": {
        if (slot === null)
          throw exprError(
            "FORMA_E_UNSUPPORTED",
            `an arrow function is only allowed as the first argument of ${Object.keys(HOF_CALLBACK_PARAMS).sort().join("/")} \u2014 it cannot be stored, assigned or returned`,
            node.i
          );
        if (node.params.length > slot)
          throw exprError(
            "FORMA_E_UNSUPPORTED",
            `this callback receives at most ${slot} parameter(s)`,
            node.i
          );
        if (new Set(node.params).size !== node.params.length)
          throw exprError("FORMA_E_SYNTAX", "duplicate arrow parameter name", node.i);
        walk(node.body, d, null);
        return;
      }
      default:
        throw exprError("FORMA_E_UNSUPPORTED", `unhandled node ${JSON.stringify(node)}`, 0);
    }
  }
  function walkStmt(stmt, depth) {
    depth > LIMITS.MAX_AST_DEPTH && tooDeep(stmt.i);
    let d = depth + 1;
    switch (stmt.k) {
      case "ExprStmt":
        if (stmt.expr.k !== "Call")
          throw exprError(
            "FORMA_E_UNSUPPORTED",
            "a handler statement must be an assignment, an update, an `if`, or a method call",
            stmt.i
          );
        walk(stmt.expr, d, null);
        return;
      case "Assign":
        walk(stmt.target, d, null), walk(stmt.value, d, null);
        return;
      case "Update":
        walk(stmt.target, d, null);
        return;
      case "If":
        walk(stmt.test, d, null);
        for (let s of stmt.then) walkStmt(s, d);
        for (let s of stmt.else ?? []) walkStmt(s, d);
        return;
      default:
        throw exprError("FORMA_E_UNSUPPORTED", `unhandled statement ${JSON.stringify(stmt)}`, 0);
    }
  }
  function validateExpression(node) {
    walk(node, 0, null);
  }
  function validateProgram(stmts) {
    for (let stmt of stmts) walkStmt(stmt, 0);
  }

  // src/expr/interp.ts
  var OBJECT_PROTO = Object.getPrototypeOf({}), stepBudget = LIMITS.STEP_BUDGET;
  function setStepBudget(n) {
    stepBudget = Number.isFinite(n) && n > 0 ? Math.min(n, 1e7) : LIMITS.STEP_BUDGET;
  }
  function makeCtx(scope) {
    return { scope, frame: null, steps: 0, budget: stepBudget };
  }
  function step(ctx, at) {
    if (++ctx.steps > ctx.budget)
      throw exprError("FORMA_E_BUDGET", `expression exceeded its ${ctx.budget}-step budget`, at);
  }
  function safeKey(raw, at) {
    if (typeof raw == "symbol")
      throw exprError("FORMA_E_KEY_DENIED", "a symbol cannot be used as a property key", at);
    let key = typeof raw == "string" ? raw : String(raw);
    if (key.length > MAX_KEY_LENGTH)
      throw exprError("FORMA_E_KEY_DENIED", "property name is too long", at);
    if (DENY_KEYS.has(key))
      throw exprError("FORMA_E_KEY_DENIED", `property "${key}" is never accessible`, at);
    return key;
  }
  function kindOf(v) {
    if (v == null) return "none";
    if (isHost(v)) return "host";
    if (Array.isArray(v)) return "array";
    let t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return t;
    if (t === "object") {
      let proto = Object.getPrototypeOf(v);
      if (proto === OBJECT_PROTO || proto === null) return "object";
    }
    return "other";
  }
  function describeKind(v) {
    let k = kindOf(v);
    return k === "host" ? v.label : k;
  }
  function safeRead(recv, rawKey, at, optional) {
    if (recv == null)
      return void 0;
    let key = safeKey(rawKey, at), kind = kindOf(recv);
    if (kind === "host") return hostRead(recv, key, at);
    if (kind === "array") {
      if (key === "length") return recv.length;
      if (Object.hasOwn(ARRAY_METHODS, key))
        throw exprError("FORMA_E_PROPERTY_DENIED", `"${key}" is a method, not a value \u2014 call it`, at);
      return ownDataValue(recv, key, at);
    }
    if (kind === "string") {
      let str = recv;
      if (key === "length") return str.length;
      if (Object.hasOwn(STRING_METHODS, key))
        throw exprError("FORMA_E_PROPERTY_DENIED", `"${key}" is a method, not a value \u2014 call it`, at);
      if (/^\d+$/.test(key)) return Reflect.apply(STRING_METHODS.at, str, [Number(key)]);
      throw exprError("FORMA_E_PROPERTY_DENIED", `strings have no readable property "${key}"`, at);
    }
    if (kind === "object") return ownDataValue(recv, key, at);
    throw kind === "number" && Object.hasOwn(NUMBER_METHODS, key) ? exprError("FORMA_E_PROPERTY_DENIED", `"${key}" is a method, not a value \u2014 call it`, at) : exprError(
      "FORMA_E_PROPERTY_DENIED",
      `cannot read "${key}" from a ${describeKind(recv)} value`,
      at
    );
  }
  function ownDataValue(recv, key, at) {
    if (!Object.hasOwn(recv, key)) return;
    let desc = Object.getOwnPropertyDescriptor(recv, key);
    if (!desc || !Object.hasOwn(desc, "value"))
      throw exprError(
        "FORMA_E_PROPERTY_DENIED",
        `"${key}" is an accessor property; expressions read data only`,
        at
      );
    return desc.value;
  }
  function wrapElement(v, label) {
    return v == null ? void 0 : hostObject("element", v, label);
  }
  function hostRead(host, key, at) {
    let target = host.target;
    switch (host.kind) {
      case "element": {
        if (Object.hasOwn(ELEMENT_HOST_PROPS, key)) {
          let as = ELEMENT_HOST_PROPS[key], value2 = Reflect.get(target, key);
          return as === "element" ? wrapElement(value2, `${host.label}.${key}`) : as === "elementList" ? toElementList(value2, `${host.label}.${key}`) : value2 == null ? void 0 : hostObject(as, value2, `${host.label}.${key}`);
        }
        if (ELEMENT_READ_PROPS.has(key)) return Reflect.get(target, key);
        throw ELEMENT_METHODS.has(key) ? exprError("FORMA_E_PROPERTY_DENIED", `${host.label}.${key} is a method, not a value \u2014 call it`, at) : exprError("FORMA_E_PROPERTY_DENIED", `${host.label}.${key} is not on the element allowlist`, at);
      }
      case "event": {
        if (EVENT_HOST_PROPS.has(key)) return wrapElement(Reflect.get(target, key), `${host.label}.${key}`);
        if (EVENT_READ_PROPS.has(key)) return Reflect.get(target, key);
        throw EVENT_METHODS.has(key) ? exprError("FORMA_E_PROPERTY_DENIED", `${host.label}.${key} is a method, not a value \u2014 call it`, at) : exprError("FORMA_E_PROPERTY_DENIED", `${host.label}.${key} is not on the event allowlist`, at);
      }
      case "classList": {
        if (CLASSLIST_READ_PROPS.has(key)) return Reflect.get(target, key);
        throw CLASSLIST_METHODS.has(key) ? exprError("FORMA_E_PROPERTY_DENIED", `${host.label}.${key} is a method, not a value \u2014 call it`, at) : exprError("FORMA_E_PROPERTY_DENIED", `classList has no readable property "${key}"`, at);
      }
      case "style": {
        if (STYLE_DENY_PROPS.has(key))
          throw exprError("FORMA_E_PROPERTY_DENIED", `style.${key} is not available`, at);
        if (STYLE_METHODS.has(key))
          throw exprError("FORMA_E_PROPERTY_DENIED", `style.${key} is a method, not a value \u2014 call it`, at);
        let value2 = Reflect.get(target, key);
        return typeof value2 == "string" ? value2 : void 0;
      }
      case "dataset": {
        let value2 = Reflect.get(target, key);
        return typeof value2 == "string" ? value2 : void 0;
      }
      case "refs": {
        let el = target.get(key);
        return el === void 0 ? void 0 : hostObject("element", el, `$refs.${key}`);
      }
      case "namespace":
      case "fn": {
        let members = host.members;
        if (!members || !Object.hasOwn(members, key))
          throw exprError("FORMA_E_PROPERTY_DENIED", `${host.label}.${key} is not on the allowlist`, at);
        let value2 = members[key];
        if (typeof value2 == "function" || isHost(value2))
          throw exprError("FORMA_E_PROPERTY_DENIED", `${host.label}.${key} is a function, not a value \u2014 call it`, at);
        return value2;
      }
      default: {
        let never = host.kind;
        throw exprError("FORMA_E_PROPERTY_DENIED", `unknown host ${String(never)}`, at);
      }
    }
  }
  function toElementList(value2, label) {
    let list = value2;
    if (!list || typeof list.length != "number") return [];
    let n = Math.min(list.length, LIMITS.MAX_ARRAY_LENGTH), out = [];
    for (let i = 0; i < n; i++) out.push(hostObject("element", list[i], `${label}[${i}]`));
    return out;
  }
  function resolveIdent(name, ctx, at) {
    for (let f = ctx.frame; f !== null; f = f.parent) {
      let i = f.names.indexOf(name);
      if (i >= 0) return f.values[i];
    }
    let getter = ctx.scope.getters[name];
    if (typeof getter == "function") return getter();
    if (Object.hasOwn(SAFE_GLOBALS, name)) return SAFE_GLOBALS[name];
    throw exprError(
      "FORMA_E_UNRESOLVED",
      `"${name}" is not declared in this scope \u2014 expressions cannot reach globals`,
      at
    );
  }
  function checkResultSize(result, at) {
    if (typeof result == "string" && result.length > LIMITS.MAX_STRING_LENGTH)
      throw exprError("FORMA_E_BUDGET", "the resulting string is too large", at);
    if (Array.isArray(result) && result.length > LIMITS.MAX_ARRAY_LENGTH)
      throw exprError("FORMA_E_BUDGET", "the resulting array is too large", at);
    return result;
  }
  function guardArgs(method, args, at) {
    if (method === "repeat") {
      let n = Number(args[0]);
      if (!(n >= 0) || n > LIMITS.MAX_REPEAT_COUNT)
        throw exprError("FORMA_E_BUDGET", `repeat() is capped at ${LIMITS.MAX_REPEAT_COUNT}`, at);
    } else if (method === "padStart" || method === "padEnd") {
      let n = Number(args[0]);
      if (!(n >= 0) || n > LIMITS.MAX_STRING_LENGTH)
        throw exprError("FORMA_E_BUDGET", "pad length is too large", at);
    } else if (method === "flat") {
      let n = args.length === 0 ? 1 : Number(args[0]);
      if (!Number.isFinite(n) || n < 0 || n > LIMITS.MAX_FLAT_DEPTH)
        throw exprError("FORMA_E_BUDGET", `flat() depth is capped at ${LIMITS.MAX_FLAT_DEPTH}`, at);
    }
  }
  function makeCallback(node, ctx, maxParams, at) {
    if (node.k === "Arrow") {
      let { params, body } = node;
      return (...jsArgs) => {
        step(ctx, at);
        let frame = { names: params, values: jsArgs.slice(0, params.length), parent: ctx.frame }, saved = ctx.frame;
        ctx.frame = frame;
        try {
          return evalExpr(body, ctx);
        } finally {
          ctx.frame = saved;
        }
      };
    }
    let value2 = evalExpr(node, ctx);
    if (isHost(value2) && value2.kind === "fn") {
      let fn = value2.target, arity = Math.min(value2.maxArgs, maxParams);
      return (...jsArgs) => (step(ctx, at), Reflect.apply(fn, void 0, jsArgs.slice(0, arity)));
    }
    throw exprError(
      "FORMA_E_CALL_DENIED",
      "this argument must be an arrow function or an allowlisted built-in",
      node.i
    );
  }
  function evalArg(node, ctx) {
    let value2 = evalExpr(node, ctx);
    if (isHost(value2))
      throw exprError(
        "FORMA_E_CALL_DENIED",
        `${value2.label} cannot be passed as an argument`,
        node.i
      );
    return value2;
  }
  function evalCall(node, ctx) {
    let at = node.i, callee = node.callee;
    if (callee.k === "Identifier") {
      let target = resolveIdent(callee.name, ctx, callee.i);
      if (isHost(target) && target.kind === "fn") {
        let args2 = node.args.map((a) => evalArg(a, ctx));
        return checkResultSize(
          Reflect.apply(target.target, void 0, args2.slice(0, target.maxArgs)),
          at
        );
      }
      throw exprError(
        "FORMA_E_CALL_DENIED",
        `"${callee.name}" is not a callable this grammar offers \u2014 a value held in state is never invocable`,
        at
      );
    }
    if (callee.k !== "Member" && callee.k !== "Computed")
      throw exprError("FORMA_E_CALL_DENIED", "only allowlisted methods can be called", at);
    let recv = evalExpr(callee.object, ctx);
    if (recv == null) return;
    let method = callee.k === "Member" ? callee.key : safeKey(evalExpr(callee.key, ctx), callee.key.i), kind = kindOf(recv);
    if (kind === "host") return callHostMethod(recv, method, node.args, ctx, at);
    let tbl = kind === "array" ? ARRAY_METHODS : kind === "string" ? STRING_METHODS : kind === "number" ? NUMBER_METHODS : null;
    if (!tbl || !Object.hasOwn(tbl, method))
      throw exprError(
        "FORMA_E_METHOD_DENIED",
        `no method "${method}" is offered for a ${describeKind(recv)} value`,
        at
      );
    let callbackParams = Object.hasOwn(HOF_CALLBACK_PARAMS, method) ? HOF_CALLBACK_PARAMS[method] : null, args = [];
    node.args.forEach((argNode, index) => {
      index === 0 && callbackParams !== null ? args.push(makeCallback(argNode, ctx, callbackParams, at)) : args.push(evalArg(argNode, ctx));
    }), guardArgs(method, args, at);
    let receiver = ARRAY_COPY_FIRST.has(method) ? recv.slice() : recv;
    return checkResultSize(Reflect.apply(tbl[method], receiver, args), at);
  }
  var ATTR_WRITE_METHODS = /* @__PURE__ */ new Set(["setAttribute", "toggleAttribute"]);
  function guardAttrWrite(host, method, args, at) {
    let el = host.target, name = String(args[0] ?? "");
    if (!isSafeAttrName(name))
      throw exprError(
        "FORMA_E_METHOD_DENIED",
        `${host.label}.${method}("${name}") \u2014 that is not a well-formed attribute name`,
        at
      );
    let value2 = method === "setAttribute" ? String(args[1] ?? "") : "";
    if (isUnsafeAttrWrite(el.localName, name, value2))
      throw exprError(
        "FORMA_E_METHOD_DENIED",
        `${host.label}.${method}("${name}") would create an XSS sink on <${el.localName}>`,
        at
      );
  }
  function callHostMethod(host, method, argNodes, ctx, at) {
    let args = argNodes.map((a) => evalArg(a, ctx));
    if (host.kind === "namespace" || host.kind === "fn") {
      let members = host.members, fn2 = members && Object.hasOwn(members, method) ? members[method] : void 0;
      if (typeof fn2 != "function")
        throw exprError("FORMA_E_METHOD_DENIED", `${host.label}.${method} is not on the allowlist`, at);
      return checkResultSize(Reflect.apply(fn2, void 0, args), at);
    }
    let allowed = host.kind === "element" ? ELEMENT_METHODS : host.kind === "event" ? EVENT_METHODS : host.kind === "classList" ? CLASSLIST_METHODS : host.kind === "style" ? STYLE_METHODS : null;
    if (!allowed || !allowed.has(method))
      throw exprError("FORMA_E_METHOD_DENIED", `${host.label}.${method}() is not on the allowlist`, at);
    if (host.kind === "style" && method === "setProperty" && STYLE_DENY_PROPS.has(String(args[0])))
      throw exprError("FORMA_E_METHOD_DENIED", `style.setProperty("${String(args[0])}") is not available`, at);
    host.kind === "element" && ATTR_WRITE_METHODS.has(method) && guardAttrWrite(host, method, args, at);
    let target = host.target, fn = Reflect.get(target, method);
    if (typeof fn != "function")
      throw exprError("FORMA_E_METHOD_DENIED", `${host.label}.${method}() is unavailable here`, at);
    let result = Reflect.apply(fn, target, args);
    if (host.kind === "element" && Object.hasOwn(ELEMENT_METHOD_RESULT, method)) {
      let as = ELEMENT_METHOD_RESULT[method];
      if (as === "element") return wrapElement(result, `${host.label}.${method}()`);
      if (as === "elementList") return toElementList(result, `${host.label}.${method}()`);
      let rect = result, plain = {};
      for (let k of RECT_KEYS) plain[k] = Number(rect?.[k] ?? 0);
      return plain;
    }
    return checkResultSize(result, at);
  }
  function evalExpr(node, ctx) {
    switch (step(ctx, node.i), node.k) {
      case "Literal":
        return node.value;
      case "Identifier":
        return resolveIdent(node.name, ctx, node.i);
      case "Template": {
        let out = node.quasis[0] ?? "";
        for (let i = 0; i < node.exprs.length; i++) {
          let value2 = evalExpr(node.exprs[i], ctx);
          if (out += value2 == null ? "" : stringify(value2, node.i), out += node.quasis[i + 1] ?? "", out.length > LIMITS.MAX_STRING_LENGTH)
            throw exprError("FORMA_E_BUDGET", "the resulting string is too large", node.i);
        }
        return out;
      }
      case "ArrayLit":
        return node.elements.map((e) => evalExpr(e, ctx));
      case "ObjectLit": {
        let out = {};
        for (let i = 0; i < node.keys.length; i++)
          out[safeKey(node.keys[i], node.i)] = evalExpr(node.values[i], ctx);
        return out;
      }
      case "Unary": {
        if (node.op === "typeof") return typeof evalExpr(node.arg, ctx);
        let v = evalExpr(node.arg, ctx);
        return node.op === "!" ? !v : node.op === "-" ? -v : +v;
      }
      case "Logical": {
        let left = evalExpr(node.left, ctx);
        return node.op === "&&" ? left && evalExpr(node.right, ctx) : node.op === "||" ? left || evalExpr(node.right, ctx) : left ?? evalExpr(node.right, ctx);
      }
      case "Conditional":
        return evalExpr(node.test, ctx) ? evalExpr(node.then, ctx) : evalExpr(node.else, ctx);
      case "Binary": {
        let l = evalExpr(node.left, ctx), r = evalExpr(node.right, ctx), op = node.op;
        switch (op) {
          case "===":
            return l === r;
          case "!==":
            return l !== r;
          // eslint-disable-next-line eqeqeq -- `==` is a documented operator of this grammar
          case "==":
            return l == r;
          // eslint-disable-next-line eqeqeq
          case "!=":
            return l != r;
          case "<":
            return l < r;
          case ">":
            return l > r;
          case "<=":
            return l <= r;
          case ">=":
            return l >= r;
          case "+": {
            if (isHost(l) || isHost(r))
              throw exprError("FORMA_E_PROPERTY_DENIED", "a host value cannot be concatenated", node.i);
            let sum = l + r;
            return checkResultSize(sum, node.i);
          }
          case "-":
            return l - r;
          case "*":
            return l * r;
          case "/":
            return l / r;
          case "%":
            return l % r;
          default:
            throw exprError("FORMA_E_UNSUPPORTED", `unknown operator ${String(op)}`, node.i);
        }
      }
      case "Member":
        return safeRead(evalExpr(node.object, ctx), node.key, node.i, node.optional);
      case "Computed": {
        let obj = evalExpr(node.object, ctx);
        return obj == null ? void 0 : safeRead(obj, evalExpr(node.key, ctx), node.i, node.optional);
      }
      case "Call":
        return evalCall(node, ctx);
      case "Arrow":
        throw exprError("FORMA_E_UNSUPPORTED", "a function is not a value in this grammar", node.i);
      default:
        throw exprError("FORMA_E_UNSUPPORTED", `unhandled node ${JSON.stringify(node)}`, 0);
    }
  }
  function stringify(value2, at) {
    if (isHost(value2))
      throw exprError("FORMA_E_PROPERTY_DENIED", `${value2.label} cannot be rendered as text`, at);
    return String(value2);
  }
  function writeMember(recv, key, value2, at) {
    let kind = kindOf(recv);
    if (kind === "host") {
      let host = recv, target = host.target;
      if (host.kind === "element") {
        if (!ELEMENT_WRITE_PROPS.has(key))
          throw exprError("FORMA_E_ASSIGN_DENIED", `${host.label}.${key} is not writable`, at);
        Reflect.set(target, key, value2);
        return;
      }
      if (host.kind === "style") {
        if (STYLE_DENY_PROPS.has(key))
          throw exprError("FORMA_E_ASSIGN_DENIED", `style.${key} is not writable`, at);
        Reflect.set(target, key, value2 == null ? "" : String(value2));
        return;
      }
      if (host.kind === "dataset") {
        Reflect.set(target, key, value2 == null ? "" : String(value2));
        return;
      }
      throw exprError("FORMA_E_ASSIGN_DENIED", `${host.label} is read-only`, at);
    }
    if (kind === "object" || kind === "array") {
      if (kind === "array" && key === "length")
        throw exprError("FORMA_E_ASSIGN_DENIED", "array length is not writable", at);
      let desc = Object.getOwnPropertyDescriptor(recv, key);
      if (desc && !Object.hasOwn(desc, "value"))
        throw exprError("FORMA_E_ASSIGN_DENIED", `"${key}" is an accessor property`, at);
      Reflect.set(recv, key, value2);
      return;
    }
    throw exprError("FORMA_E_ASSIGN_DENIED", `cannot assign to a property of a ${describeKind(recv)} value`, at);
  }
  function applyOp(op, current, operand) {
    switch (op) {
      case "=":
        return operand;
      case "+=":
        return current + operand;
      case "-=":
        return current - operand;
      case "*=":
        return current * operand;
      case "/=":
        return current / operand;
      default:
        return op;
    }
  }
  function runStmt(stmt, ctx) {
    switch (step(ctx, stmt.i), stmt.k) {
      case "ExprStmt":
        evalExpr(stmt.expr, ctx);
        return;
      case "Assign": {
        let target = stmt.target;
        if (target.k === "Identifier") {
          let setter = ctx.scope.setters[target.name];
          if (typeof setter != "function")
            throw exprError(
              "FORMA_E_ASSIGN_DENIED",
              `"${target.name}" is not a writable state key in this scope`,
              target.i
            );
          let current2 = stmt.op === "=" ? void 0 : resolveIdent(target.name, ctx, target.i);
          setter(applyOp(stmt.op, current2, evalExpr(stmt.value, ctx)));
          return;
        }
        let recv = evalExpr(target.object, ctx);
        if (recv == null)
          throw exprError("FORMA_E_ASSIGN_DENIED", "cannot assign to a property of null", target.i);
        let key = target.k === "Member" ? target.key : safeKey(evalExpr(target.key, ctx), target.i), current = stmt.op === "=" ? void 0 : safeRead(recv, key, target.i, !1);
        writeMember(recv, safeKey(key, target.i), applyOp(stmt.op, current, evalExpr(stmt.value, ctx)), target.i);
        return;
      }
      case "Update": {
        let delta = stmt.op === "++" ? 1 : -1, target = stmt.target;
        if (target.k === "Identifier") {
          let setter = ctx.scope.setters[target.name];
          if (typeof setter != "function")
            throw exprError(
              "FORMA_E_ASSIGN_DENIED",
              `"${target.name}" is not a writable state key in this scope`,
              target.i
            );
          setter(resolveIdent(target.name, ctx, target.i) + delta);
          return;
        }
        let recv = evalExpr(target.object, ctx);
        if (recv == null)
          throw exprError("FORMA_E_ASSIGN_DENIED", "cannot assign to a property of null", target.i);
        let key = safeKey(
          target.k === "Member" ? target.key : evalExpr(target.key, ctx),
          target.i
        );
        writeMember(recv, key, safeRead(recv, key, target.i, !1) + delta, target.i);
        return;
      }
      case "If":
        if (evalExpr(stmt.test, ctx))
          for (let s of stmt.then) runStmt(s, ctx);
        else
          for (let s of stmt.else ?? []) runStmt(s, ctx);
        return;
      default:
        throw exprError("FORMA_E_UNSUPPORTED", `unhandled statement ${JSON.stringify(stmt)}`, 0);
    }
  }
  function runProgram(stmts, ctx) {
    for (let stmt of stmts) runStmt(stmt, ctx);
  }

  // src/expr/index.ts
  var CACHE_MAX = 2048;
  function cacheGet(cache, key) {
    return cache.get(key);
  }
  function cacheSet(cache, key, entry) {
    if (cache.size >= CACHE_MAX) {
      let oldest = cache.keys().next().value;
      oldest !== void 0 && cache.delete(oldest);
    }
    cache.set(key, entry);
  }
  var exprCache = /* @__PURE__ */ new Map(), programCache = /* @__PURE__ */ new Map();
  function clearExpressionCache() {
    exprCache.clear(), programCache.clear();
  }
  function compileExpression(source) {
    let hit = cacheGet(exprCache, source);
    if (hit) {
      if (hit.ok) return hit.value;
      throw hit.error;
    }
    try {
      let node = parseExpression(source);
      return validateExpression(node), cacheSet(exprCache, source, { ok: !0, value: node }), node;
    } catch (err) {
      throw isExprError(err) && cacheSet(exprCache, source, { ok: !1, error: err }), err;
    }
  }
  function compileHandler(source) {
    let hit = cacheGet(programCache, source);
    if (hit) {
      if (hit.ok) return hit.value;
      throw hit.error;
    }
    try {
      let stmts = parseProgram(source);
      return validateProgram(stmts), cacheSet(programCache, source, { ok: !0, value: stmts }), stmts;
    } catch (err) {
      throw isExprError(err) && cacheSet(programCache, source, { ok: !1, error: err }), err;
    }
  }
  function evaluateExpression(node, scope) {
    return evalExpr(node, makeCtx(scope));
  }
  function runHandler(stmts, scope) {
    runProgram(stmts, makeCtx(scope));
  }

  // src/runtime.ts
  function isUnsafeAttrBinding(name, value2, tag) {
    return !!(isEventHandlerAttr(name) || isUrlAttr(name) && isDangerousUrl(value2, tag));
  }
  var _refetchRegistry = /* @__PURE__ */ new Map();
  function $refetch(id) {
    let fn = _refetchRegistry.get(id);
    fn ? fn() : _debug && dbg(`$refetch: no data-fetch with id "${id}" found`);
  }
  function createChildScope(parent, locals) {
    let localGetters = /* @__PURE__ */ Object.create(null);
    for (let key of Object.keys(locals))
      localGetters[key] = () => locals[key];
    return {
      getters: new Proxy(parent.getters, {
        get(target, prop) {
          return prop in localGetters ? localGetters[prop] : target[prop];
        },
        has(target, prop) {
          return prop in localGetters || prop in target;
        }
      }),
      setters: parent.setters
    };
  }
  var _debug = !1, _diagnosticsEnabled = !0;
  function dbg(...args) {
    (_debug || typeof window < "u" && window.__FORMA_DEBUG) && console.log("[FormaJS]", ...args);
  }
  var diagnostics = /* @__PURE__ */ new Map();
  function parseBooleanFlag(raw) {
    if (raw == null) return;
    let normalized = raw.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes") return !0;
    if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no") return !1;
  }
  var CONFIG_SCRIPT_SELECTOR = [
    "script[data-forma-diagnostics]",
    "script[data-forma-auto-containment]",
    "script[data-forma-expr-budget]"
  ].join(",");
  function findConfigScript() {
    let current = document.currentScript;
    return current || document.querySelector(CONFIG_SCRIPT_SELECTOR);
  }
  function readRuntimeConfig() {
    let config = {};
    if (typeof window < "u") {
      let globalConfig = window.__FORMA_RUNTIME_CONFIG;
      globalConfig && (typeof globalConfig.exprBudget == "number" && (config.exprBudget = globalConfig.exprBudget), typeof globalConfig.diagnostics == "boolean" && (config.diagnostics = globalConfig.diagnostics), typeof globalConfig.autoContainment == "boolean" && (config.autoContainment = globalConfig.autoContainment));
    }
    if (typeof document < "u") {
      let script = findConfigScript();
      if (script) {
        let budgetFromAttr = Number(script.getAttribute("data-forma-expr-budget"));
        Number.isFinite(budgetFromAttr) && budgetFromAttr > 0 && (config.exprBudget = budgetFromAttr);
        let diagnosticsFromAttr = parseBooleanFlag(script.getAttribute("data-forma-diagnostics"));
        diagnosticsFromAttr !== void 0 && (config.diagnostics = diagnosticsFromAttr);
        let containmentFromAttr = parseBooleanFlag(script.getAttribute("data-forma-auto-containment"));
        containmentFromAttr !== void 0 && (config.autoContainment = containmentFromAttr);
      }
    }
    return config;
  }
  function reportDiagnostic(kind, expr, reason, code = "FORMA_E_UNSUPPORTED") {
    if (!_diagnosticsEnabled) return;
    let key = `${kind}|${reason}|${expr}`, now = Date.now(), existing = diagnostics.get(key);
    if (existing) {
      existing.count += 1, existing.lastSeenAt = now;
      return;
    }
    diagnostics.set(key, {
      kind,
      expr,
      reason,
      code,
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now
    }), console.warn(`[FormaJS] ${reason}: ${expr}`);
    try {
      if (typeof window < "u") {
        let detail = { kind, expr, reason, code, count: 1 };
        window.dispatchEvent(new CustomEvent("formajs:diagnostic", { detail }));
      }
    } catch {
    }
  }
  var runtimeConfig = readRuntimeConfig();
  typeof runtimeConfig.exprBudget == "number" && setStepBudget(runtimeConfig.exprBudget);
  typeof runtimeConfig.diagnostics == "boolean" && (_diagnosticsEnabled = runtimeConfig.diagnostics);
  var _autoContainment = runtimeConfig.autoContainment === !0;
  function getScheduler() {
    let candidate = globalThis?.scheduler;
    if (candidate && (typeof candidate.yield == "function" || typeof candidate.postTask == "function"))
      return candidate;
  }
  async function yieldToMain() {
    let scheduler = getScheduler();
    if (scheduler?.yield) {
      await scheduler.yield();
      return;
    }
    if (scheduler?.postTask) {
      await scheduler.postTask(() => {
      }, { priority: "background" });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  function applyContainmentHints(root = document, options = {}) {
    let selector = options.selector ?? "[data-forma-contain]";
    if (!selector || typeof root.querySelectorAll != "function") return 0;
    let nodes = root.querySelectorAll(selector), applied = 0;
    for (let i = 0; i < nodes.length; i++) {
      let el = nodes[i];
      if (!el?.style) continue;
      let contain = el.getAttribute("data-forma-contain") ?? options.contain ?? "layout style paint", contentVisibility = el.getAttribute("data-forma-content-visibility") ?? options.contentVisibility ?? "auto", containIntrinsicSize = el.getAttribute("data-forma-contain-intrinsic-size") ?? options.containIntrinsicSize ?? "auto 800px", skipExisting = options.skipIfAlreadySet === !0, changed = !1, containCurrent = el.style.getPropertyValue("contain"), contentVisCurrent = el.style.getPropertyValue("content-visibility"), containSizeCurrent = el.style.getPropertyValue("contain-intrinsic-size");
      contain !== "off" && (!skipExisting || !containCurrent) && (el.style.setProperty("contain", contain), changed = !0), contentVisibility !== "off" && (!skipExisting || !contentVisCurrent) && (el.style.setProperty("content-visibility", contentVisibility), changed = !0), containIntrinsicSize !== "off" && (!skipExisting || !containSizeCurrent) && (el.style.setProperty("contain-intrinsic-size", containIntrinsicSize), changed = !0), changed && applied++;
    }
    return _debug && applied > 0 && dbg("applyContainmentHints: applied to", applied, "element(s)"), applied;
  }
  var RE_STRIP_BRACES = /^\{|\}$/g, RE_COMPUTED = /^(\w+)\s*=\s*(.+)$/, RE_FETCH = /^(.+?)(?:→|->)\s*(\S+)(.*)$/, RE_FETCH_METHOD = /^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i, RE_STRIP_ITEM_BRACES = /^\{item\.?|\}$/g, TRANSITION_STATE_SYM = /* @__PURE__ */ Symbol.for("forma-transition-state"), scopeExpressionCache = /* @__PURE__ */ new WeakMap(), scopeHandlerCache = /* @__PURE__ */ new WeakMap(), compiledTemplateCache = /* @__PURE__ */ new Map(), COMPILED_TEMPLATE_CACHE_MAX = 2048;
  function cacheCompiledTemplate(key, template) {
    if (compiledTemplateCache.size >= COMPILED_TEMPLATE_CACHE_MAX) {
      let first = compiledTemplateCache.keys().next().value;
      first !== void 0 && compiledTemplateCache.delete(first);
    }
    compiledTemplateCache.set(key, template);
  }
  var TEXT_BINDING_SYM = /* @__PURE__ */ Symbol.for("forma-text-binding-cache");
  function toTextValue(value2) {
    return value2 == null ? "" : typeof value2 == "string" ? value2 : typeof value2 == "symbol" ? value2.toString() : String(value2);
  }
  function setElementTextFast(el, next) {
    let cache = el[TEXT_BINDING_SYM];
    if (cache || (cache = { initialized: !1, last: "", node: null }, el[TEXT_BINDING_SYM] = cache), cache.initialized && cache.last === next) return;
    let node = cache.node;
    if (!node || node.parentNode !== el || el.childNodes.length !== 1 || el.firstChild !== node)
      if (el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE)
        node = el.firstChild, cache.node = node;
      else {
        el.textContent = next;
        let first = el.firstChild;
        cache.node = first && first.nodeType === Node.TEXT_NODE && el.childNodes.length === 1 ? first : null, cache.last = next, cache.initialized = !0;
        return;
      }
    node.data = next, cache.last = next, cache.initialized = !0;
  }
  function readBalancedSegment(input, start, open, close) {
    if (input[start] !== open) return null;
    let depth = 0, inSingle = !1, inDouble = !1, inTemplate = !1, escaped = !1;
    for (let i = start; i < input.length; i++) {
      let ch = input[i];
      if (escaped) {
        escaped = !1;
        continue;
      }
      if (ch === "\\" && (inSingle || inDouble || inTemplate)) {
        escaped = !0;
        continue;
      }
      if (inSingle) {
        ch === "'" && (inSingle = !1);
        continue;
      }
      if (inDouble) {
        ch === '"' && (inDouble = !1);
        continue;
      }
      if (inTemplate) {
        ch === "`" && (inTemplate = !1);
        continue;
      }
      if (ch === "'") {
        inSingle = !0;
        continue;
      }
      if (ch === '"') {
        inDouble = !0;
        continue;
      }
      if (ch === "`") {
        inTemplate = !0;
        continue;
      }
      if (ch === open) {
        depth++;
        continue;
      }
      if (ch === close && (depth--, depth === 0))
        return {
          inner: input.slice(start + 1, i),
          end: i
        };
    }
    return null;
  }
  function compileTemplate(text) {
    let cached = compiledTemplateCache.get(text);
    if (cached) return cached;
    let statics = [], dynamics = [], lastIndex = 0, re = /\{item\.?(\w*)\}/g, m;
    for (; (m = re.exec(text)) !== null; )
      statics.push(text.slice(lastIndex, m.index)), dynamics.push(m[1]), lastIndex = re.lastIndex;
    statics.push(text.slice(lastIndex));
    let result = {
      statics,
      dynamics,
      hasItemRef: dynamics.length > 0
    };
    return cacheCompiledTemplate(text, result), result;
  }
  var templateTexts = /* @__PURE__ */ new WeakMap();
  function evaluateCompiledTemplate(compiled, item) {
    if (!compiled.hasItemRef) return compiled.statics[0];
    let result = compiled.statics[0];
    for (let i = 0; i < compiled.dynamics.length; i++) {
      let key = compiled.dynamics[i];
      key ? result += String(item?.[key] ?? "") : result += typeof item == "object" ? JSON.stringify(item) : String(item ?? ""), result += compiled.statics[i + 1] ?? "";
    }
    return result;
  }
  function cloneWithTemplateData(template, item) {
    let clone = template.cloneNode(!0), walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    for (; walker.nextNode(); ) {
      let node = walker.currentNode, text = node.textContent ?? "";
      if (text.includes("{item")) {
        let compiled = compileTemplate(text);
        templateTexts.set(node, compiled), node.textContent = evaluateCompiledTemplate(compiled, item);
      }
    }
    return cloneAttributeTemplates(clone, item), clone;
  }
  function updateTemplateData(el, item) {
    let walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (; walker.nextNode(); ) {
      let node = walker.currentNode, compiled = templateTexts.get(node);
      compiled && (node.textContent = evaluateCompiledTemplate(compiled, item));
    }
  }
  var templateAttrs = /* @__PURE__ */ new WeakMap(), DIRECTIVE_ATTR_PREFIXES = [
    "data-list",
    "data-show",
    "data-text",
    "data-if",
    "data-model",
    "data-on:",
    "data-class:",
    "data-bind:",
    "data-computed",
    "data-persist",
    "data-fetch",
    "data-transition",
    "data-transition:"
  ];
  function isDirectiveAttr(name) {
    for (let prefix of DIRECTIVE_ATTR_PREFIXES)
      if (name === prefix || name.startsWith(prefix)) return !0;
    return !1;
  }
  function splitClassTokens(raw) {
    return raw ? raw.trim().split(/\s+/).map((t) => t.trim()).filter(Boolean) : [];
  }
  function parseDurationTokenMs(token) {
    let t = token.trim().toLowerCase();
    if (t.endsWith("ms")) {
      let n = Number(t.slice(0, -2));
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    if (t.endsWith("s")) {
      let n = Number(t.slice(0, -1));
      return Number.isFinite(n) && n >= 0 ? n * 1e3 : null;
    }
    return null;
  }
  function parseClassTokensAndDuration(raw) {
    let classes = [], durationMs;
    for (let token of splitClassTokens(raw)) {
      let parsed = parseDurationTokenMs(token);
      parsed != null ? durationMs = parsed : classes.push(token);
    }
    return { classes, durationMs };
  }
  function uniqueTokens(tokens) {
    return Array.from(new Set(tokens.filter(Boolean)));
  }
  function parseCssTimeListMs(raw) {
    return raw ? raw.split(",").map((part) => parseDurationTokenMs(part.trim())).filter((ms) => ms != null) : [];
  }
  function maxCombinedTimingsMs(durations, delays) {
    if (durations.length === 0 && delays.length === 0) return 0;
    if (durations.length === 0) return Math.max(...delays, 0);
    if (delays.length === 0) return Math.max(...durations, 0);
    let len = Math.max(durations.length, delays.length), max = 0;
    for (let i = 0; i < len; i++) {
      let d = durations[i % durations.length] ?? 0, delay = delays[i % delays.length] ?? 0;
      d + delay > max && (max = d + delay);
    }
    return max;
  }
  function resolveTransitionDurationMs(el, explicitMs) {
    if (typeof explicitMs == "number") return explicitMs;
    let cs = window.getComputedStyle(el), trans = maxCombinedTimingsMs(
      parseCssTimeListMs(cs.transitionDuration),
      parseCssTimeListMs(cs.transitionDelay)
    ), anim = maxCombinedTimingsMs(
      parseCssTimeListMs(cs.animationDuration),
      parseCssTimeListMs(cs.animationDelay)
    );
    return Math.max(trans, anim);
  }
  function getTransitionState(el) {
    let existing = el[TRANSITION_STATE_SYM];
    if (existing) return existing;
    let created = { token: 0, cancel: null };
    return el[TRANSITION_STATE_SYM] = created, created;
  }
  function clearTransitionState(el) {
    let state2 = el[TRANSITION_STATE_SYM];
    state2?.cancel && state2.cancel(), delete el[TRANSITION_STATE_SYM];
  }
  function parseTransitionSpec(el) {
    if (!(el.hasAttribute("data-transition") || Array.from(el.attributes).some((a) => a.name.startsWith("data-transition:")))) return null;
    let base = parseClassTokensAndDuration(el.getAttribute("data-transition")).classes, enter = parseClassTokensAndDuration(el.getAttribute("data-transition:enter")), leave = parseClassTokensAndDuration(el.getAttribute("data-transition:leave")), enterFrom = splitClassTokens(
      el.getAttribute("data-transition:enter-from") ?? el.getAttribute("data-transition:enter-start")
    ), enterTo = splitClassTokens(
      el.getAttribute("data-transition:enter-to") ?? el.getAttribute("data-transition:enter-end")
    ), leaveFrom = splitClassTokens(
      el.getAttribute("data-transition:leave-from") ?? el.getAttribute("data-transition:leave-start")
    ), leaveTo = splitClassTokens(
      el.getAttribute("data-transition:leave-to") ?? el.getAttribute("data-transition:leave-end")
    ), durationBoth = parseDurationTokenMs(el.getAttribute("data-transition:duration") ?? ""), enterDuration = parseDurationTokenMs(el.getAttribute("data-transition:duration-enter") ?? "") ?? enter.durationMs ?? durationBoth ?? void 0, leaveDuration = parseDurationTokenMs(el.getAttribute("data-transition:duration-leave") ?? "") ?? leave.durationMs ?? durationBoth ?? void 0;
    return {
      enter: uniqueTokens([...base, ...enter.classes]),
      enterFrom: uniqueTokens(enterFrom),
      enterTo: uniqueTokens(enterTo),
      leave: uniqueTokens([...base, ...leave.classes]),
      leaveFrom: uniqueTokens(leaveFrom),
      leaveTo: uniqueTokens(leaveTo),
      enterDurationMs: enterDuration,
      leaveDurationMs: leaveDuration
    };
  }
  function removeClasses(el, classes) {
    for (let cls of classes)
      el.classList.remove(cls);
  }
  function addClasses(el, classes) {
    for (let cls of classes)
      el.classList.add(cls);
  }
  function runTransitionPhase(el, phaseClasses, onDone) {
    let cleanupClasses = uniqueTokens([
      ...phaseClasses.base,
      ...phaseClasses.from,
      ...phaseClasses.to
    ]), done = !1, timeoutId = null, raf1 = null, raf2 = null, finish = () => {
      done || (done = !0, timeoutId != null && window.clearTimeout(timeoutId), raf1 != null && cancelAnimationFrame(raf1), raf2 != null && cancelAnimationFrame(raf2), removeClasses(el, cleanupClasses), onDone());
    };
    return addClasses(el, phaseClasses.base), addClasses(el, phaseClasses.from), removeClasses(el, phaseClasses.to), raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (done) return;
        removeClasses(el, phaseClasses.from), addClasses(el, phaseClasses.to);
        let ms = resolveTransitionDurationMs(el, phaseClasses.durationMs);
        if (ms <= 0) {
          finish();
          return;
        }
        timeoutId = window.setTimeout(finish, ms + 25);
      });
    }), finish;
  }
  function transitionInsert(el, parent, ref, spec) {
    if (parent.insertBefore(el, ref), !spec) return;
    let state2 = getTransitionState(el);
    state2.token += 1;
    let token = state2.token;
    state2.cancel && state2.cancel(), state2.cancel = runTransitionPhase(
      el,
      {
        base: spec.enter,
        from: spec.enterFrom,
        to: spec.enterTo,
        durationMs: spec.enterDurationMs
      },
      () => {
        let current = getTransitionState(el);
        current.token === token && (current.cancel = null);
      }
    );
  }
  function transitionRemove(el, spec, onDone) {
    if (el.hasAttribute("data-forma-leaving")) {
      onDone();
      return;
    }
    if (!spec) {
      onDone();
      return;
    }
    el.setAttribute("data-forma-leaving", "");
    let state2 = getTransitionState(el);
    state2.token += 1;
    let token = state2.token;
    state2.cancel && state2.cancel(), state2.cancel = runTransitionPhase(
      el,
      {
        base: spec.leave,
        from: spec.leaveFrom,
        to: spec.leaveTo,
        durationMs: spec.leaveDurationMs
      },
      () => {
        let current = getTransitionState(el);
        current.token === token && (current.cancel = null), el.removeAttribute("data-forma-leaving"), onDone();
      }
    );
  }
  function applyShowVisibility(el, visible, transition, initial) {
    if (!transition || initial) {
      el.style.display = visible ? "" : "none", transition && removeClasses(el, uniqueTokens([
        ...transition.enter,
        ...transition.enterFrom,
        ...transition.enterTo,
        ...transition.leave,
        ...transition.leaveFrom,
        ...transition.leaveTo
      ]));
      return;
    }
    let state2 = getTransitionState(el);
    state2.token += 1;
    let token = state2.token;
    if (state2.cancel && state2.cancel(), state2.cancel = null, visible) {
      el.style.display = "", state2.cancel = runTransitionPhase(
        el,
        {
          base: transition.enter,
          from: transition.enterFrom,
          to: transition.enterTo,
          durationMs: transition.enterDurationMs
        },
        () => {
          let current = getTransitionState(el);
          current.token === token && (current.cancel = null);
        }
      );
      return;
    }
    state2.cancel = runTransitionPhase(
      el,
      {
        base: transition.leave,
        from: transition.leaveFrom,
        to: transition.leaveTo,
        durationMs: transition.leaveDurationMs
      },
      () => {
        let current = getTransitionState(el);
        current.token === token && (el.style.display = "none", current.cancel = null);
      }
    );
  }
  function cloneAttributeTemplates(el, item) {
    let all = [el, ...Array.from(el.querySelectorAll("*"))];
    for (let node of all) {
      let entries = [];
      for (let attr of Array.from(node.attributes))
        if (!isDirectiveAttr(attr.name) && attr.value.includes("{item")) {
          let compiled = compileTemplate(attr.value);
          entries.push({ attr: attr.name, compiled });
          let value2 = evaluateCompiledTemplate(compiled, item);
          isUnsafeAttrBinding(attr.name, value2, node.tagName.toLowerCase()) ? node.removeAttribute(attr.name) : node.setAttribute(attr.name, value2);
        }
      entries.length > 0 && templateAttrs.set(node, entries);
    }
  }
  function getScopeCache(cache, scope) {
    let scoped = cache.get(scope);
    return scoped || (scoped = /* @__PURE__ */ new Map(), cache.set(scope, scoped)), scoped;
  }
  var EXPR_FAILED = /* @__PURE__ */ Symbol("forma-expression-failed");
  function stripBraces(raw) {
    let trimmed = raw.trim();
    if (!trimmed.startsWith("{")) return trimmed;
    let seg = readBalancedSegment(trimmed, 0, "{", "}");
    return !seg || seg.end !== trimmed.length - 1 ? trimmed : seg.inner.trim();
  }
  function logExprFailure(el, expr, err, what) {
    let where = err.column >= 0 ? ` at column ${err.column + 1}` : "", head = el ? `
  on: ${el.outerHTML.slice(0, 120)}` : "";
    console.error(`[FormaJS] ${what} not evaluated${where}: ${expr}
  ${err.code}: ${err.message}${head}`);
  }
  function reportExprFailure(el, expr, err) {
    logExprFailure(el, expr, err, "expression"), reportDiagnostic("expression-unsupported", expr, err.message, err.code), el?.setAttribute("data-forma-expr-error", "unsupported");
  }
  function reportHandlerFailure(el, expr, err) {
    logExprFailure(el, expr, err, "handler"), reportDiagnostic("handler-unsupported", expr, err.message, err.code), el?.setAttribute("data-forma-handler-error", "unsupported");
  }
  function buildEvaluator(expr, scope, el) {
    let cleaned = stripBraces(expr), cache = getScopeCache(scopeExpressionCache, scope), cached = cache.get(cleaned);
    if (cached) return cached;
    let compiled;
    try {
      compiled = compileExpression(cleaned);
    } catch (err) {
      if (!isExprError(err)) throw err;
      return reportExprFailure(el, cleaned, err), null;
    }
    let run2 = () => evaluateExpression(compiled, scope);
    return cache.set(cleaned, run2), run2;
  }
  function buildHandler(expr, scope, el) {
    let cleaned = stripBraces(expr), cache = getScopeCache(scopeHandlerCache, scope), cached = cache.get(cleaned);
    if (cached) return cached;
    let program;
    try {
      program = compileHandler(cleaned);
    } catch (err) {
      if (!isExprError(err)) throw err;
      reportHandlerFailure(el, cleaned, err);
      let failed = { handler: () => {
      }, supported: !1 };
      return cache.set(cleaned, failed), failed;
    }
    let eventLocals = { $event: void 0, event: void 0 }, eventScope = createChildScope(scope, eventLocals), result = { handler: (e) => {
      let outer = eventLocals.$event, wrapped = hostObject("event", e, "$event");
      eventLocals.$event = wrapped, eventLocals.event = wrapped;
      try {
        batch(() => runHandler(program, eventScope));
      } catch (err) {
        if (!isExprError(err)) throw err;
        reportHandlerFailure(e.currentTarget ?? el, cleaned, err);
      } finally {
        eventLocals.$event = outer, eventLocals.event = outer;
      }
    }, supported: !0 };
    return cache.set(cleaned, result), result;
  }
  var FORBIDDEN_STATE_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  function parseState(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return _debug && dbg("parseState: Invalid JSON in data-forma-state \u2014 use valid JSON with quoted keys. Got:", raw.slice(0, 200)), {};
    }
    if (typeof parsed != "object" || parsed === null || Array.isArray(parsed))
      return _debug && dbg("parseState: data-forma-state must be a JSON object. Got:", raw.slice(0, 200)), {};
    let state2 = parsed;
    for (let key of FORBIDDEN_STATE_KEYS)
      Object.hasOwn(state2, key) && delete state2[key];
    return state2;
  }
  function initScope(stateEl) {
    let raw = stateEl.getAttribute("data-forma-state") ?? "{}", state2 = parseState(raw), keys = Object.keys(state2);
    _debug && (dbg("initScope: parsed", keys.length, "keys:", keys.join(", ")), keys.length === 0 && dbg("initScope: WARNING \u2014 empty state! Raw attribute:", raw.slice(0, 200)));
    let getters = /* @__PURE__ */ Object.create(null), setters = /* @__PURE__ */ Object.create(null);
    for (let [key, initial] of Object.entries(state2)) {
      let [get, set] = createSignal(initial);
      getters[key] = get, setters[key] = set;
    }
    let refetchHost = hostFn("$refetch", (id) => $refetch(String(id)), 1);
    return getters.$refetch = () => refetchHost, { getters, setters };
  }
  function bindElement(el, scope, disposers) {
    let elMagics = {
      $el: hostObject("element", el, "$el"),
      $dispatch: hostFn("$dispatch", (name, detail) => {
        el.dispatchEvent(new CustomEvent(String(name), {
          bubbles: !0,
          composed: !0,
          // crosses Shadow DOM boundaries (important for <forma-stage>)
          detail
        }));
      }, 2)
    };
    scope = createChildScope(scope, elMagics), el.hasAttribute("data-forma-expr-error") && el.removeAttribute("data-forma-expr-error"), el.hasAttribute("data-forma-handler-error") && el.removeAttribute("data-forma-handler-error");
    let evaluator = (expression) => {
      let fn = buildEvaluator(expression, scope, el);
      return fn ? () => {
        try {
          return fn();
        } catch (err) {
          if (!isExprError(err)) throw err;
          return reportExprFailure(el, stripBraces(expression), err), EXPR_FAILED;
        }
      } : () => EXPR_FAILED;
    }, known = getDirectives(el), computedAttr = !known || known.has("data-computed") ? el.getAttribute("data-computed") : null;
    if (computedAttr) {
      let parts = computedAttr.split(/;\s*(?=\w+\s*=[^=])/);
      for (let part of parts) {
        let trimmed = part.trim();
        if (!trimmed) continue;
        let match = trimmed.match(RE_COMPUTED);
        if (match) {
          let name = match[1], expr = match[2], prevGetter = scope.getters[name];
          delete scope.getters[name];
          let evaluate = buildEvaluator(`{${expr}}`, scope, el);
          if (evaluate) {
            let cell = createComputed(() => {
              try {
                return { ok: !0, v: evaluate() };
              } catch (err) {
                if (!isExprError(err)) throw err;
                return { ok: !1, e: err };
              }
            });
            scope.getters[name] = () => {
              let r = cell();
              if (!r.ok) throw r.e;
              return r.v;
            };
          }
          prevGetter || delete scope.setters[name];
        }
      }
    }
    let textExpr = !known || known.has("data-text") ? el.getAttribute("data-text") : null;
    if (textExpr) {
      let evaluate = evaluator(textExpr), dispose = internalEffect(() => {
        let value2 = evaluate();
        value2 !== EXPR_FAILED && setElementTextFast(el, toTextValue(value2));
      });
      disposers.push(dispose);
    }
    let showExpr = !known || known.has("data-show") ? el.getAttribute("data-show") : null;
    if (showExpr) {
      let evaluate = evaluator(showExpr), transition = parseTransitionSpec(el);
      if (_debug) {
        let tag = el.tagName.toLowerCase(), cls = el.className ? `.${String(el.className).split(" ")[0]}` : "";
        dbg(`bindElement: data-show="${showExpr}" on <${tag}${cls}>`);
      }
      let initialized = !1, dispose = internalEffect(() => {
        let value2 = evaluate();
        if (value2 === EXPR_FAILED) return;
        let visible = !!value2;
        _debug && dbg(`data-show effect: "${showExpr}" \u2192 ${visible}`), applyShowVisibility(el, visible, transition, !initialized), initialized = !0;
      });
      disposers.push(dispose), transition && disposers.push(() => clearTransitionState(el));
    }
    let ifExpr = !known || known.has("data-if") ? el.getAttribute("data-if") : null;
    if (ifExpr) {
      let evaluate = evaluator(ifExpr), transition = parseTransitionSpec(el), placeholder = document.createComment("forma-if"), parent = el.parentNode, inserted = !0, initialized = !1, dispose = internalEffect(() => {
        let value2 = evaluate();
        if (value2 === EXPR_FAILED) return;
        let show = !!value2;
        show && !inserted ? (clearTransitionState(el), el.removeAttribute("data-forma-leaving"), initialized && transition ? transitionInsert(el, parent, placeholder, transition) : parent?.insertBefore(el, placeholder), inserted = !0) : !show && inserted && (initialized && transition ? transitionRemove(el, transition, () => {
          el.parentNode && (parent?.insertBefore(placeholder, el), el.remove());
        }) : (parent?.insertBefore(placeholder, el), el.remove()), inserted = !1), initialized = !0;
      });
      disposers.push(dispose), transition && disposers.push(() => clearTransitionState(el));
    }
    let modelExpr = !known || known.has("data-model") ? el.getAttribute("data-model") : null;
    if (modelExpr) {
      let prop = modelExpr.replace(RE_STRIP_BRACES, "").trim(), getter = scope.getters[prop], setter = scope.setters[prop];
      if ((!getter || !setter) && prop.includes(".")) {
        getter = evaluator(prop);
        let lastDot = prop.lastIndexOf("."), basePath = prop.slice(0, lastDot), key = prop.slice(lastDot + 1), baseGet = evaluator(basePath);
        setter = (v) => {
          let base = baseGet();
          base !== EXPR_FAILED && base != null && typeof base == "object" && (base[key] = v);
        };
      }
      if (getter && setter) {
        let input = el, tag = input.tagName, dispose = internalEffect(() => {
          let val = getter();
          if (val === EXPR_FAILED) return;
          let type = input.type;
          if (type === "checkbox") {
            input.checked = !!val;
            let indetExpr = el.getAttribute("data-model-indeterminate");
            if (indetExpr) {
              let indetGetter = scope.getters[indetExpr.replace(RE_STRIP_BRACES, "").trim()];
              indetGetter && (input.indeterminate = !!indetGetter());
            }
          } else if (type === "radio")
            input.checked = String(val) === input.value;
          else if (tag === "SELECT" && input.multiple) {
            let sel = input, arr = Array.isArray(val) ? val.map(String) : [];
            for (let opt of Array.from(sel.options)) opt.selected = arr.includes(opt.value);
          } else
            input.value = String(val ?? "");
        });
        disposers.push(dispose);
        let event = input.type === "checkbox" || input.type === "radio" || tag === "SELECT" ? "change" : "input", onModelInput = () => {
          let type = input.type;
          if (type === "checkbox")
            setter(input.checked);
          else if (type === "radio")
            input.checked && setter(input.value);
          else if (tag === "SELECT" && input.multiple)
            setter(Array.from(input.selectedOptions).map((o) => o.value));
          else if (type === "number" || type === "range") {
            let raw = input.value;
            if (raw === "")
              setter(null);
            else {
              let n = Number(raw);
              Number.isNaN(n) || setter(n);
            }
          } else
            setter(input.value);
        };
        input.addEventListener(event, onModelInput), disposers.push(() => {
          input.removeEventListener(event, onModelInput);
        });
      }
    }
    let hasColonDirectives = !known || hasAnyPrefix(known, "data-on:", "data-class:", "data-bind:"), attrs = Array.from(el.attributes);
    if (hasColonDirectives) for (let i = 0; i < attrs.length; i++) {
      let attr = attrs[i], name = attr.name;
      if (name.startsWith("data-on:")) {
        let event = name.slice(8), built = buildHandler(attr.value, scope, el), handler = built.handler;
        if (_debug) {
          let tag = el.tagName.toLowerCase(), id = el.id ? `#${el.id}` : "", cls = el.className ? `.${String(el.className).split(" ")[0]}` : "";
          dbg(`bindElement: data-on:${event}="${attr.value}" on <${tag}${id}${cls}>`);
        }
        if (built.supported || el.setAttribute("data-forma-handler-error", "unsupported"), _debug) {
          let attrVal = attr.value, tracedHandler = (e) => {
            dbg(`HANDLER FIRED: data-on:${event}="${attrVal}"`, "isTrusted:", e.isTrusted), handler(e);
          };
          el.addEventListener(event, tracedHandler), disposers.push(() => {
            el.removeEventListener(event, tracedHandler);
          });
        } else
          el.addEventListener(event, handler), disposers.push(() => {
            el.removeEventListener(event, handler);
          });
      } else if (name.startsWith("data-class:")) {
        let cls = name.slice(11), evaluate = evaluator(attr.value), dispose = internalEffect(() => {
          let value2 = evaluate();
          value2 !== EXPR_FAILED && el.classList.toggle(cls, !!value2);
        });
        disposers.push(dispose);
      } else if (name.startsWith("data-bind:")) {
        let attrName = name.slice(10), evaluate = evaluator(attr.value), dispose = internalEffect(() => {
          let val = evaluate();
          if (val === EXPR_FAILED) return;
          if (val == null || val === !1) {
            el.removeAttribute(attrName);
            return;
          }
          let str = val === !0 ? "" : String(val);
          isUnsafeAttrBinding(attrName, str, el.tagName.toLowerCase()) ? el.removeAttribute(attrName) : el.setAttribute(attrName, str);
        });
        disposers.push(dispose);
      }
    }
    let persistExpr = !known || known.has("data-persist") ? el.getAttribute("data-persist") : null;
    if (persistExpr) {
      let prop = persistExpr.replace(RE_STRIP_BRACES, "").trim(), getter = scope.getters[prop], setter = scope.setters[prop];
      if (getter && setter) {
        let key = "forma:" + prop;
        try {
          let saved = localStorage.getItem(key);
          saved !== null && setter(JSON.parse(saved));
        } catch {
        }
        let dispose = internalEffect(() => {
          try {
            localStorage.setItem(key, JSON.stringify(getter()));
          } catch {
          }
        });
        disposers.push(dispose);
      }
    }
    let listExpr = !known || known.has("data-list") ? el.getAttribute("data-list") : null;
    if (listExpr) {
      let evaluate = evaluator(listExpr), templateEl = el.children[0];
      if (templateEl) {
        let disposeCloneBindings2 = function(node) {
          let el2 = node;
          if (Array.isArray(el2.__formaDisposers)) {
            for (let d of el2.__formaDisposers)
              try {
                d();
              } catch {
              }
            delete el2.__formaDisposers;
          }
        }, createBoundClone2 = function(item, index) {
          let clone = cloneWithTemplateData(template, item), childScope = createChildScope(scope, { item, index }), itemDisposers = [];
          bindElement(clone, childScope, itemDisposers);
          for (let desc of Array.from(clone.querySelectorAll("*")))
            bindElement(desc, childScope, itemDisposers);
          return clone.__formaDisposers = itemDisposers, clone;
        }, updateBoundClone2 = function(node, item, index) {
          disposeCloneBindings2(node), updateTemplateData(node, item);
          let childScope = createChildScope(scope, { item, index }), itemDisposers = [];
          bindElement(node, childScope, itemDisposers);
          for (let desc of Array.from(node.querySelectorAll("*")))
            bindElement(desc, childScope, itemDisposers);
          node.__formaDisposers = itemDisposers;
        };
        var disposeCloneBindings = disposeCloneBindings2, createBoundClone = createBoundClone2, updateBoundClone = updateBoundClone2;
        let template = templateEl.cloneNode(!0);
        el.removeChild(templateEl);
        let keyAttr = template.getAttribute("data-key"), keyProp = keyAttr ? keyAttr.replace(RE_STRIP_ITEM_BRACES, "").trim() : null, listTransition = parseTransitionSpec(el), oldItems = [], oldNodes = [], listHooks = listTransition ? {
          onInsert: (node) => {
            let htmlEl = node;
            if (!htmlEl.setAttribute) return;
            let state2 = getTransitionState(htmlEl);
            state2.token += 1;
            let token = state2.token;
            state2.cancel && state2.cancel(), state2.cancel = runTransitionPhase(
              htmlEl,
              {
                base: listTransition.enter,
                from: listTransition.enterFrom,
                to: listTransition.enterTo,
                durationMs: listTransition.enterDurationMs
              },
              () => {
                let current = getTransitionState(htmlEl);
                current.token === token && (current.cancel = null);
              }
            );
          },
          onBeforeRemove: (node, done) => {
            let htmlEl = node;
            if (!htmlEl.setAttribute) {
              done();
              return;
            }
            disposeCloneBindings2(node), transitionRemove(htmlEl, listTransition, () => {
              done();
            });
          }
        } : void 0, dispose = internalEffect(() => {
          let rawItems = evaluate();
          if (rawItems === EXPR_FAILED) return;
          if (!Array.isArray(rawItems)) {
            for (let n of oldNodes)
              disposeCloneBindings2(n), el.removeChild(n);
            oldItems = [], oldNodes = [];
            return;
          }
          if (listTransition) {
            let leavingNodes = el.querySelectorAll("[data-forma-leaving]");
            for (let ln of Array.from(leavingNodes))
              clearTransitionState(ln), ln.removeAttribute("data-forma-leaving"), ln.parentNode && ln.parentNode.removeChild(ln);
          }
          let prevNodes = new Set(oldNodes), wrapped = rawItems.map((item, i) => ({ __idx: i, __item: item })), result = reconcileList(
            el,
            oldItems,
            wrapped,
            oldNodes,
            keyProp ? (w) => String(w.__item?.[keyProp] ?? "") : (w) => w.__idx,
            (w) => createBoundClone2(w.__item, w.__idx),
            (node, w) => updateBoundClone2(node, w.__item, w.__idx),
            void 0,
            // beforeNode
            listHooks
          ), nextNodes = new Set(result.nodes);
          for (let n of prevNodes)
            if (!nextNodes.has(n)) {
              if (n.hasAttribute?.("data-forma-leaving")) continue;
              disposeCloneBindings2(n);
            }
          oldItems = result.items, oldNodes = result.nodes;
        });
        disposers.push(dispose);
      }
    }
    let fetchExpr = !known || known.has("data-fetch") ? el.getAttribute("data-fetch") : null;
    if (fetchExpr) {
      let arrowMatch = fetchExpr.match(RE_FETCH);
      if (arrowMatch) {
        let urlPart = arrowMatch[1].trim(), target = arrowMatch[2].trim(), modifiers = arrowMatch[3]?.trim() ?? "", method = "GET", url = urlPart, methodMatch = urlPart.match(RE_FETCH_METHOD);
        methodMatch && (method = methodMatch[1].toUpperCase(), url = methodMatch[2].trim());
        let loadingTarget, errorTarget, interval;
        for (let mod of modifiers.split("|").filter(Boolean)) {
          let [k, v] = mod.split(":").map((s) => s.trim());
          k === "loading" ? loadingTarget = v : k === "error" ? errorTarget = v : k === "poll" && (interval = parseInt(v ?? "0", 10));
        }
        let [getTarget, setTarget] = createSignal(null);
        if (scope.getters[target] = getTarget, scope.setters[target] = setTarget, loadingTarget) {
          let [gl, sl] = createSignal(!1);
          scope.getters[loadingTarget] = gl, scope.setters[loadingTarget] = sl;
        }
        if (errorTarget) {
          let [ge, se] = createSignal(null);
          scope.getters[errorTarget] = ge, scope.setters[errorTarget] = se;
        }
        let doFetch = () => {
          loadingTarget && scope.setters[loadingTarget](!0), fetch(url, { method }).then((r) => r.json()).then((data) => {
            setTarget(data), loadingTarget && scope.setters[loadingTarget](!1);
          }).catch((err) => {
            errorTarget && scope.setters[errorTarget](err.message), loadingTarget && scope.setters[loadingTarget](!1);
          });
        }, fetchId = el.getAttribute("data-fetch-id");
        if (fetchId && (_refetchRegistry.set(fetchId, doFetch), disposers.push(() => _refetchRegistry.delete(fetchId))), doFetch(), interval && interval > 0) {
          let id = setInterval(doFetch, interval);
          disposers.push(() => clearInterval(id));
        }
      }
    }
  }
  function hasDirective(el) {
    let attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      let name = attrs[i].name;
      if (name.startsWith("data-text") || name.startsWith("data-show") || name.startsWith("data-if") || name.startsWith("data-model") || name.startsWith("data-computed") || name.startsWith("data-persist") || name.startsWith("data-list") || name.startsWith("data-fetch") || name.startsWith("data-on:") || name.startsWith("data-class:") || name.startsWith("data-bind:") || name.startsWith("data-transition"))
        return !0;
    }
    return !1;
  }
  var _directiveMap = null;
  function setDirectiveMap(map) {
    if (!map || Object.keys(map).length === 0) {
      _directiveMap = null;
      return;
    }
    _directiveMap = /* @__PURE__ */ new Map();
    for (let id in map)
      _directiveMap.set(id, new Set(map[id]));
  }
  function buildDirectiveSelector() {
    if (!_directiveMap || _directiveMap.size === 0 || _directiveMap.size > 200) return null;
    let parts = [];
    for (let id of _directiveMap.keys())
      parts.push(`[data-forma-id="${id}"]`);
    return parts.join(",");
  }
  function getDirectives(el) {
    if (!_directiveMap) return null;
    let id = el.getAttribute("data-forma-id");
    return id ? _directiveMap.get(id) ?? null : null;
  }
  function hasAnyPrefix(set, ...prefixes) {
    for (let entry of set)
      for (let prefix of prefixes)
        if (entry.startsWith(prefix)) return !0;
    return !1;
  }
  function mountScope(root) {
    if (root.__formaDisposers) {
      _debug && dbg("mountScope: SKIPPED (already mounted)");
      return;
    }
    let scope = initScope(root), disposers = [], refsMap = /* @__PURE__ */ new Map(), refEls = root.querySelectorAll("[data-ref]");
    for (let i = 0; i < refEls.length; i++) {
      let el = refEls[i], name = el.getAttribute("data-ref");
      name && refsMap.set(name, el);
    }
    let rootRefName = root.getAttribute("data-ref");
    rootRefName && refsMap.set(rootRefName, root);
    let refsHost = hostObject("refs", refsMap, "$refs");
    scope.getters.$refs = () => refsHost, bindElement(root, scope, disposers);
    let boundCount = 0, selector = buildDirectiveSelector(), scanAll = selector === null, targets = scanAll ? root.querySelectorAll("*") : root.querySelectorAll(selector);
    for (let i = 0; i < targets.length; i++) {
      let el = targets[i];
      el.parentNode !== null && (scanAll && !hasDirective(el) || (bindElement(el, scope, disposers), boundCount++));
    }
    root.__formaDisposers = disposers, root.__formaScope = scope, root.__formaInitialState = root.getAttribute("data-forma-state") ?? "{}", _debug && dbg("mountScope: DONE \u2014", boundCount, "elements bound,", disposers.length, "disposers", selector ? "(targeted)" : "(full scan)");
  }
  function unmountScope(root) {
    let disposers = root.__formaDisposers;
    if (disposers) {
      for (let d of disposers)
        try {
          d();
        } catch {
        }
      delete root.__formaDisposers, delete root.__formaScope, delete root.__formaInitialState;
    }
  }
  var _observer = null, ELEMENT_NODE = 1, MUTATION_CHUNK_SIZE = 40, _pendingMutations = [], _drainingMutations = !1;
  function processMutation(mutation) {
    for (let i = 0; i < mutation.removedNodes.length; i++) {
      let node = mutation.removedNodes[i];
      if (node.nodeType !== ELEMENT_NODE) continue;
      let el = node;
      el.hasAttribute("data-forma-state") && (_debug && dbg("MutationObserver: REMOVED scope"), unmountScope(el));
      let removed = el.querySelectorAll("[data-forma-state]");
      for (let j = 0; j < removed.length; j++)
        unmountScope(removed[j]);
    }
    for (let i = 0; i < mutation.addedNodes.length; i++) {
      let node = mutation.addedNodes[i];
      if (node.nodeType !== ELEMENT_NODE) continue;
      let el = node;
      if (el.closest("[data-forma-leaving]")) continue;
      el.hasAttribute("data-forma-state") && (_debug && dbg("MutationObserver: ADDED scope via mutation"), mountScope(el));
      let added = el.querySelectorAll("[data-forma-state]");
      _debug && added.length > 0 && dbg("MutationObserver: found", added.length, "nested scope(s) in added subtree");
      for (let j = 0; j < added.length; j++) {
        let desc = added[j];
        desc.closest("[data-forma-leaving]") || mountScope(desc);
      }
    }
    if (mutation.type === "attributes" && mutation.attributeName === "data-forma-state") {
      let target = mutation.target;
      unmountScope(target), target.hasAttribute("data-forma-state") && mountScope(target);
    }
  }
  async function drainMutationQueue() {
    try {
      for (; _pendingMutations.length > 0; ) {
        let batch2 = _pendingMutations.splice(0, MUTATION_CHUNK_SIZE);
        for (let i = 0; i < batch2.length; i++)
          processMutation(batch2[i]);
        _pendingMutations.length > 0 && await yieldToMain();
      }
    } finally {
      _drainingMutations = !1, _pendingMutations.length > 0 && !_drainingMutations && (_drainingMutations = !0, drainMutationQueue());
    }
  }
  function handleMutations(mutations) {
    _debug && dbg("MutationObserver: queued", mutations.length, "mutation(s)"), _pendingMutations.push(...mutations), !_drainingMutations && (_drainingMutations = !0, drainMutationQueue());
  }
  function startObserver() {
    if (_observer) return;
    _observer = new MutationObserver(handleMutations);
    let target = document.body || document.documentElement;
    target && _observer.observe(target, {
      childList: !0,
      subtree: !0,
      attributes: !0,
      attributeFilter: ["data-forma-state"]
    });
  }
  function stopObserver() {
    _observer && (_observer.disconnect(), _observer = null);
  }
  function initRuntime() {
    _autoContainment && applyContainmentHints(document, { skipIfAlreadySet: !0 });
    let stateRoots = document.querySelectorAll("[data-forma-state]");
    _debug && dbg("initRuntime: found", stateRoots.length, "scope(s)");
    for (let root of Array.from(stateRoots))
      mountScope(root);
    startObserver(), _debug && dbg("initRuntime: MutationObserver started");
  }
  function destroyRuntime() {
    stopObserver();
    let stateRoots = document.querySelectorAll("[data-forma-state]");
    for (let root of Array.from(stateRoots))
      unmountScope(root);
    clearExpressionCache();
  }
  function mount(el) {
    el.hasAttribute("data-forma-state") && mountScope(el);
    let descendants = el.querySelectorAll("[data-forma-state]");
    for (let desc of Array.from(descendants))
      mountScope(desc);
  }
  function unmount(el) {
    el.hasAttribute("data-forma-state") && unmountScope(el);
    let descendants = el.querySelectorAll("[data-forma-state]");
    for (let desc of Array.from(descendants))
      unmountScope(desc);
  }
  typeof document < "u" && (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", initRuntime) : initRuntime());
  function setDebug(on) {
    _debug = on;
  }
  function setDiagnostics(on) {
    _diagnosticsEnabled = on;
  }
  function getDiagnostics() {
    return Array.from(diagnostics.values()).map((d) => ({ ...d }));
  }
  function clearDiagnostics() {
    diagnostics.clear();
  }
  function getScopes() {
    let roots = document.querySelectorAll("[data-forma-state]"), result = [];
    for (let root of Array.from(roots)) {
      if (root.closest("[data-forma-leaving]")) continue;
      let scope = root.__formaScope, initialJSON = root.__formaInitialState;
      if (!scope) continue;
      let values = {};
      for (let key of Object.keys(scope.getters)) {
        let val = scope.getters[key]();
        values[key] = { value: val, type: typeof val };
      }
      result.push({
        element: root,
        id: root.getAttribute("data-forma-id") || root.id || root.tagName.toLowerCase(),
        values,
        initialJSON: initialJSON ?? "{}"
      });
    }
    return result;
  }
  function setScopeValue(element, key, value2) {
    let scope = element.__formaScope;
    scope?.setters[key] && batch(() => {
      scope.setters[key](value2);
    });
  }
  function resetScope(element) {
    let scope = element.__formaScope, initialJSON = element.__formaInitialState;
    if (!scope || !initialJSON) return;
    let initial = parseState(initialJSON);
    batch(() => {
      for (let [key, val] of Object.entries(initial))
        scope.setters[key]?.(val);
    });
  }
  var _reconciler = null;
  function getReconciler() {
    return _reconciler || (_reconciler = createReconciler({
      mountScope,
      unmountScope,
      disconnectObserver() {
        _observer && _observer.disconnect();
      },
      reconnectObserver() {
        if (_observer) {
          let target = document.body || document.documentElement;
          target && _observer.observe(target, {
            childList: !0,
            subtree: !0,
            attributes: !0,
            attributeFilter: ["data-forma-state"]
          });
        }
      },
      batch
    })), _reconciler;
  }
  function reconcile(container, html) {
    getReconciler()(container, html);
  }
  return __toCommonJS(runtime_exports);
})();
//# sourceMappingURL=formajs-runtime.global.js.map
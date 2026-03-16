"use strict";
var FormaRuntime = (() => {
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

  // src/runtime.ts
  var runtime_exports = {};
  __export(runtime_exports, {
    applyContainmentHints: () => applyContainmentHints,
    clearDiagnostics: () => clearDiagnostics,
    destroyRuntime: () => destroyRuntime,
    getDiagnostics: () => getDiagnostics,
    getScopes: () => getScopes,
    getUnsafeEvalMode: () => getUnsafeEvalMode,
    initRuntime: () => initRuntime,
    mount: () => mount,
    reconcile: () => reconcile,
    resetScope: () => resetScope,
    setDebug: () => setDebug,
    setDiagnostics: () => setDiagnostics,
    setDirectiveMap: () => setDirectiveMap,
    setScopeValue: () => setScopeValue,
    setUnsafeEval: () => setUnsafeEval,
    setUnsafeEvalMode: () => setUnsafeEvalMode,
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
  function startBatch() {
    ++batchDepth;
  }
  function endBatch() {
    if (!--batchDepth) {
      flush();
    }
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
  function registerDisposer(dispose) {
    if (currentRoot) {
      currentRoot.disposers.push(dispose);
    }
  }
  function hasActiveRoot() {
    return currentRoot !== null;
  }

  // src/reactive/effect.ts
  var POOL_SIZE = 32;
  var pool = [];
  for (let i = 0; i < POOL_SIZE; i++) pool.push([]);
  function internalEffect(fn) {
    const dispose = effect(fn);
    if (hasActiveRoot()) {
      registerDisposer(dispose);
    }
    return dispose;
  }

  // src/reactive/computed.ts
  function createComputed(fn) {
    return computed(fn);
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
  function reconcileSmall(parent, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks) {
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
          parent.removeChild(oldNodes[i]);
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
    let nextSibling = beforeNode ?? null;
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
          nextSibling = node;
          continue;
        }
      }
      if (nextSibling) {
        parent.insertBefore(node, nextSibling);
      } else {
        parent.appendChild(node);
      }
      if (isNew) hooks?.onInsert?.(node);
      newNodes[i] = node;
      nextSibling = node;
    }
    return { nodes: newNodes, items: newItems };
  }
  function reconcileList(parent, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks) {
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
          parent.removeChild(oldNodes[i]);
        }
      }
      return { nodes: [], items: [] };
    }
    if (oldLen === 0) {
      const nodes = new Array(newLen);
      for (let i = 0; i < newLen; i++) {
        const node = createFn(newItems[i]);
        if (beforeNode) {
          parent.insertBefore(node, beforeNode);
        } else {
          parent.appendChild(node);
        }
        hooks?.onInsert?.(node);
        nodes[i] = node;
      }
      return { nodes, items: newItems };
    }
    if (oldLen < SMALL_LIST_THRESHOLD) {
      return reconcileSmall(parent, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks);
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
          parent.removeChild(oldNodes[i]);
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
    let nextSibling = beforeNode ?? null;
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
          nextSibling = node;
          continue;
        }
      }
      if (nextSibling) {
        parent.insertBefore(node, nextSibling);
      } else {
        parent.appendChild(node);
      }
      if (isNew) hooks?.onInsert?.(node);
      newNodes[i] = node;
      nextSibling = node;
    }
    return { nodes: newNodes, items: newItems };
  }

  // src/dom/reconcile.ts
  function getBindTargets(el) {
    const targets = /* @__PURE__ */ new Set();
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const name = attrs[i].name;
      if (name.startsWith("data-bind:")) {
        targets.add(name.slice(10));
      }
    }
    return targets;
  }
  function ownsSubtree(el) {
    return el.hasAttribute("data-list") || el.hasAttribute("data-if");
  }
  function getStateKeys(json) {
    try {
      const obj = JSON.parse(json);
      return Object.keys(obj).sort();
    } catch {
      return [];
    }
  }
  function sameShape(keysA, keysB) {
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      if (keysA[i] !== keysB[i]) return false;
    }
    return true;
  }
  function determineScopeMode(liveEl, newEl) {
    const liveModule = liveEl.getAttribute("data-module");
    const newModule = newEl.getAttribute("data-module");
    if (liveModule !== newModule) return "REPLACE";
    const liveInitialState = liveEl.__formaInitialState;
    const liveStateJSON = liveInitialState ?? liveEl.getAttribute("data-forma-state") ?? "{}";
    const newStateJSON = newEl.getAttribute("data-forma-state") ?? "{}";
    const liveKeys = getStateKeys(liveStateJSON);
    const newKeys = getStateKeys(newStateJSON);
    if (sameShape(liveKeys, newKeys)) return "PRESERVE";
    return "RESET";
  }
  var _parseTemplate = null;
  function parseHTML(html) {
    if (!_parseTemplate) _parseTemplate = document.createElement("template");
    _parseTemplate.innerHTML = html;
    return _parseTemplate.content;
  }
  function patchAttributes(liveEl, newEl) {
    const bindTargets = getBindTargets(liveEl);
    const hasDataShow = liveEl.hasAttribute("data-show");
    const hasDataModel = liveEl.hasAttribute("data-model");
    let liveHasClassDirectives = false;
    const liveAttrs = liveEl.attributes;
    for (let i = 0; i < liveAttrs.length; i++) {
      if (liveAttrs[i].name.startsWith("data-class:")) {
        liveHasClassDirectives = true;
        break;
      }
    }
    const newAttrs = newEl.attributes;
    for (let i = 0; i < newAttrs.length; i++) {
      const attr = newAttrs[i];
      if (attr.name === "style" && hasDataShow) continue;
      if (attr.name === "class" && liveHasClassDirectives) continue;
      if ((attr.name === "value" || attr.name === "checked") && hasDataModel) continue;
      if (bindTargets.has(attr.name)) continue;
      const liveVal = liveEl.getAttribute(attr.name);
      if (liveVal !== attr.value) {
        liveEl.setAttribute(attr.name, attr.value);
      }
    }
    for (let i = liveAttrs.length - 1; i >= 0; i--) {
      const attr = liveAttrs[i];
      if (!newEl.hasAttribute(attr.name)) {
        if (attr.name === "style" && hasDataShow) continue;
        if (attr.name === "class" && liveHasClassDirectives) continue;
        if ((attr.name === "value" || attr.name === "checked") && hasDataModel) continue;
        if (bindTargets.has(attr.name)) continue;
        liveEl.removeAttribute(attr.name);
      }
    }
  }
  function patchTextNodes(liveEl, newEl) {
    if (liveEl.hasAttribute("data-text")) return;
    const liveTexts = [];
    const newTexts = [];
    for (const child of Array.from(liveEl.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) liveTexts.push(child);
    }
    for (let i = 0; i < newEl.childNodes.length; i++) {
      const child = newEl.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE) newTexts.push({ node: child, index: i });
    }
    if (liveTexts.length === newTexts.length) {
      for (let i = 0; i < liveTexts.length; i++) {
        if (liveTexts[i].textContent !== newTexts[i].node.textContent) {
          liveTexts[i].textContent = newTexts[i].node.textContent;
        }
      }
      return;
    }
    const usedLive = /* @__PURE__ */ new Set();
    let liveIdx = 0;
    for (const { node: newText, index: newChildIdx } of newTexts) {
      if (liveIdx < liveTexts.length) {
        const liveText = liveTexts[liveIdx];
        liveIdx++;
        usedLive.add(liveText);
        if (liveText.textContent !== newText.textContent) {
          liveText.textContent = newText.textContent;
        }
      } else {
        const ref = findTextInsertionRef(liveEl, newEl, newChildIdx);
        liveEl.insertBefore(document.createTextNode(newText.textContent ?? ""), ref);
      }
    }
    for (const lt of liveTexts) {
      if (!usedLive.has(lt) && lt.parentNode === liveEl) {
        liveEl.removeChild(lt);
      }
    }
  }
  function findTextInsertionRef(liveEl, newEl, newIdx) {
    for (let j = newIdx + 1; j < newEl.childNodes.length; j++) {
      const sibling = newEl.childNodes[j];
      if (sibling.nodeType === Node.ELEMENT_NODE) {
        const key = sibling.getAttribute("data-forma-id");
        if (key) {
          const match = liveEl.querySelector(`[data-forma-id="${CSS.escape(key)}"]`);
          if (match && match.parentElement === liveEl) return match;
        }
      }
    }
    return null;
  }
  function diffChildren(liveParent, newParent, config) {
    if (ownsSubtree(liveParent)) return;
    patchTextNodes(liveParent, newParent);
    const liveChildren = Array.from(liveParent.children);
    const newChildren = Array.from(newParent.children);
    const liveKeyed = /* @__PURE__ */ new Map();
    const liveUnkeyed = [];
    for (const child of liveChildren) {
      if (child.hasAttribute("data-forma-leaving")) continue;
      const key = child.getAttribute("data-forma-id");
      if (key) {
        liveKeyed.set(key, child);
      } else {
        liveUnkeyed.push(child);
      }
    }
    let unkeyedIdx = 0;
    const usedLiveElements = /* @__PURE__ */ new Set();
    for (const newChild of newChildren) {
      const key = newChild.getAttribute("data-forma-id");
      let liveMatch;
      if (key) {
        liveMatch = liveKeyed.get(key);
      } else {
        while (unkeyedIdx < liveUnkeyed.length) {
          const candidate = liveUnkeyed[unkeyedIdx];
          unkeyedIdx++;
          if (candidate.tagName === newChild.tagName && !usedLiveElements.has(candidate)) {
            liveMatch = candidate;
            break;
          }
        }
      }
      if (liveMatch) {
        usedLiveElements.add(liveMatch);
        if (liveMatch.hasAttribute("data-forma-state") && newChild.hasAttribute("data-forma-state")) {
          const mode = determineScopeMode(liveMatch, newChild);
          switch (mode) {
            case "PRESERVE":
              patchAttributes(liveMatch, newChild);
              diffChildren(liveMatch, newChild, config);
              break;
            case "RESET":
              config.unmountScope(liveMatch);
              patchAttributes(liveMatch, newChild);
              replaceInnerContent(liveMatch, newChild);
              config.mountScope(liveMatch);
              break;
            case "REPLACE": {
              config.unmountScope(liveMatch);
              const replacement = newChild.cloneNode(true);
              liveParent.replaceChild(replacement, liveMatch);
              config.mountScope(replacement);
              usedLiveElements.delete(liveMatch);
              liveMatch = replacement;
              usedLiveElements.add(replacement);
              break;
            }
          }
        } else {
          patchAttributes(liveMatch, newChild);
          diffChildren(liveMatch, newChild, config);
        }
        ensurePosition(liveParent, liveMatch, newChild, newChildren);
      } else {
        const clone = newChild.cloneNode(true);
        const insertionRef = findInsertionPoint(liveParent, newChild, newChildren);
        liveParent.insertBefore(clone, insertionRef);
        usedLiveElements.add(clone);
        if (clone.hasAttribute("data-forma-state")) {
          config.mountScope(clone);
        }
        const nestedScopes = clone.querySelectorAll("[data-forma-state]");
        for (const nested of Array.from(nestedScopes)) {
          config.mountScope(nested);
        }
      }
    }
    for (const child of liveChildren) {
      if (!usedLiveElements.has(child)) {
        if (child.parentElement !== liveParent) continue;
        if (child.hasAttribute("data-forma-leaving")) continue;
        if (child.hasAttribute("data-forma-state")) {
          config.unmountScope(child);
        }
        const nestedScopes = child.querySelectorAll("[data-forma-state]");
        for (const nested of Array.from(nestedScopes)) {
          config.unmountScope(nested);
        }
        liveParent.removeChild(child);
      }
    }
  }
  function replaceInnerContent(liveEl, newEl) {
    while (liveEl.firstChild) {
      liveEl.removeChild(liveEl.firstChild);
    }
    for (const child of Array.from(newEl.childNodes)) {
      liveEl.appendChild(child.cloneNode(true));
    }
  }
  function ensurePosition(parent, liveEl, _newEl, newChildren) {
    const newIdx = newChildren.indexOf(_newEl);
    const liveChildElements = Array.from(parent.children);
    const currentIdx = liveChildElements.indexOf(liveEl);
    if (currentIdx !== newIdx) {
      const nextNewChild = newChildren[newIdx + 1];
      if (nextNewChild) {
        const nextKey = nextNewChild.getAttribute("data-forma-id");
        if (nextKey) {
          const nextLive = parent.querySelector(`[data-forma-id="${CSS.escape(nextKey)}"]`);
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
    const newIdx = newChildren.indexOf(newChild);
    for (let i = newIdx + 1; i < newChildren.length; i++) {
      const key = newChildren[i].getAttribute("data-forma-id");
      if (key) {
        const existing = parent.querySelector(`[data-forma-id="${CSS.escape(key)}"]`);
        if (existing && existing.parentElement === parent) {
          return existing;
        }
      }
    }
    return null;
  }
  function createReconciler(config) {
    let _lastHtml = "";
    return function reconcile2(container, html) {
      const trimmed = html.trim();
      if (!trimmed) return;
      if (trimmed === _lastHtml && container.hasChildNodes()) return;
      _lastHtml = trimmed;
      config.disconnectObserver();
      try {
        if (!container.hasChildNodes() || container.children.length === 0) {
          container.innerHTML = trimmed;
          config.batch(() => {
            const scopes = container.querySelectorAll("[data-forma-state]");
            for (const scope of Array.from(scopes)) {
              config.mountScope(scope);
            }
          });
          return;
        }
        const fragment = parseHTML(trimmed);
        const templateContainer = document.createElement("div");
        templateContainer.appendChild(fragment);
        const liveKeys = /* @__PURE__ */ new Set();
        for (const child of Array.from(container.children)) {
          if (child.hasAttribute("data-forma-leaving")) continue;
          const key = child.getAttribute("data-forma-id");
          if (key) liveKeys.add(key);
        }
        let hasOverlap = false;
        if (liveKeys.size > 0) {
          for (const child of Array.from(templateContainer.children)) {
            const key = child.getAttribute("data-forma-id");
            if (key && liveKeys.has(key)) {
              hasOverlap = true;
              break;
            }
          }
        }
        if (liveKeys.size > 0 && !hasOverlap) {
          config.batch(() => {
            const liveScopes = container.querySelectorAll("[data-forma-state]");
            for (const scope of Array.from(liveScopes)) {
              config.unmountScope(scope);
            }
            container.innerHTML = trimmed;
            const newScopes = container.querySelectorAll("[data-forma-state]");
            for (const scope of Array.from(newScopes)) {
              config.mountScope(scope);
            }
          });
          return;
        }
        config.batch(() => {
          diffChildren(container, templateContainer, config);
        });
      } finally {
        config.reconnectObserver();
      }
    };
  }

  // src/runtime.ts
  var _refetchRegistry = /* @__PURE__ */ new Map();
  function $refetch(id) {
    const fn = _refetchRegistry.get(id);
    if (fn) {
      fn();
    } else if (_debug) {
      dbg(`$refetch: no data-fetch with id "${id}" found`);
    }
  }
  function createChildScope(parent, locals) {
    const localGetters = /* @__PURE__ */ Object.create(null);
    for (const key of Object.keys(locals)) {
      localGetters[key] = () => locals[key];
    }
    return {
      getters: new Proxy(parent.getters, {
        get(target, prop) {
          if (prop in localGetters) return localGetters[prop];
          return target[prop];
        },
        has(target, prop) {
          return prop in localGetters || prop in target;
        }
      }),
      setters: parent.setters
    };
  }
  var _debug = false;
  var _unsafeEvalMode = "mutable";
  var _allowUnsafeEval = false;
  var _diagnosticsEnabled = true;
  function dbg(...args) {
    if (_debug || typeof window !== "undefined" && window.__FORMA_DEBUG) {
      console.log("[FormaJS]", ...args);
    }
  }
  var diagnostics = /* @__PURE__ */ new Map();
  function parseBooleanFlag(raw) {
    if (raw == null) return void 0;
    const normalized = raw.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes") return true;
    if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no") return false;
    return void 0;
  }
  function parseUnsafeEvalMode(raw) {
    if (raw == null) return void 0;
    const normalized = raw.trim().toLowerCase();
    if (normalized === "mutable") return "mutable";
    if (normalized === "locked-off" || normalized === "off" || normalized === "disabled") {
      return "locked-off";
    }
    if (normalized === "locked-on" || normalized === "on" || normalized === "enabled") {
      return "locked-on";
    }
    return void 0;
  }
  function readRuntimeConfig() {
    const config = {};
    if (typeof window !== "undefined") {
      const globalConfig = window.__FORMA_RUNTIME_CONFIG;
      if (globalConfig) {
        if (typeof globalConfig.allowUnsafeEval === "boolean") {
          config.allowUnsafeEval = globalConfig.allowUnsafeEval;
        }
        if (typeof globalConfig.unsafeEvalMode === "string") {
          const parsed = parseUnsafeEvalMode(globalConfig.unsafeEvalMode);
          if (parsed) config.unsafeEvalMode = parsed;
        }
        if (typeof globalConfig.lockUnsafeEval === "boolean") {
          config.lockUnsafeEval = globalConfig.lockUnsafeEval;
        }
        if (typeof globalConfig.diagnostics === "boolean") {
          config.diagnostics = globalConfig.diagnostics;
        }
        if (typeof globalConfig.autoContainment === "boolean") {
          config.autoContainment = globalConfig.autoContainment;
        }
      }
    }
    if (typeof document !== "undefined") {
      const script = document.currentScript;
      if (script) {
        const unsafeFromAttr = parseBooleanFlag(script.getAttribute("data-forma-unsafe-eval"));
        if (unsafeFromAttr !== void 0) {
          config.allowUnsafeEval = unsafeFromAttr;
        }
        const modeFromAttr = parseUnsafeEvalMode(
          script.getAttribute("data-forma-unsafe-eval-mode")
        );
        if (modeFromAttr !== void 0) {
          config.unsafeEvalMode = modeFromAttr;
        }
        const lockFromAttr = parseBooleanFlag(script.getAttribute("data-forma-lock-unsafe-eval"));
        if (lockFromAttr !== void 0) {
          config.lockUnsafeEval = lockFromAttr;
        }
        const diagnosticsFromAttr = parseBooleanFlag(script.getAttribute("data-forma-diagnostics"));
        if (diagnosticsFromAttr !== void 0) {
          config.diagnostics = diagnosticsFromAttr;
        }
        const containmentFromAttr = parseBooleanFlag(script.getAttribute("data-forma-auto-containment"));
        if (containmentFromAttr !== void 0) {
          config.autoContainment = containmentFromAttr;
        }
      }
    }
    return config;
  }
  function reportDiagnostic(kind, expr, reason) {
    if (!_diagnosticsEnabled) return;
    const key = `${kind}|${reason}|${expr}`;
    const now = Date.now();
    const existing = diagnostics.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeenAt = now;
    } else {
      diagnostics.set(key, {
        kind,
        expr,
        reason,
        count: 1,
        firstSeenAt: now,
        lastSeenAt: now
      });
      console.warn(`[FormaJS] ${reason}: ${expr}`);
    }
    try {
      if (typeof window !== "undefined") {
        const detail = {
          kind,
          expr,
          reason,
          count: diagnostics.get(key)?.count ?? 1
        };
        window.dispatchEvent(new CustomEvent("formajs:diagnostic", { detail }));
      }
    } catch {
    }
  }
  var __EVAL_CAPABLE__ = true;
  var buildUnsafeEvalMode = parseUnsafeEvalMode(
    true ? "mutable" : void 0
  );
  if (buildUnsafeEvalMode) {
    _unsafeEvalMode = buildUnsafeEvalMode;
    if (_unsafeEvalMode === "locked-off") _allowUnsafeEval = false;
    if (_unsafeEvalMode === "locked-on") _allowUnsafeEval = true;
    if (_unsafeEvalMode === "mutable") _allowUnsafeEval = true;
  }
  var runtimeConfig = readRuntimeConfig();
  var configUnsafeMode = runtimeConfig.lockUnsafeEval ? "locked-off" : runtimeConfig.unsafeEvalMode;
  if (configUnsafeMode) {
    _unsafeEvalMode = configUnsafeMode;
    if (_unsafeEvalMode === "locked-off") _allowUnsafeEval = false;
    if (_unsafeEvalMode === "locked-on") _allowUnsafeEval = true;
  }
  if (_unsafeEvalMode === "mutable" && typeof runtimeConfig.allowUnsafeEval === "boolean") {
    _allowUnsafeEval = runtimeConfig.allowUnsafeEval;
  }
  if (typeof runtimeConfig.diagnostics === "boolean") {
    _diagnosticsEnabled = runtimeConfig.diagnostics;
  }
  var _autoContainment = runtimeConfig.autoContainment === true;
  function getScheduler() {
    const candidate = globalThis?.scheduler;
    if (!candidate) return void 0;
    if (typeof candidate.yield === "function" || typeof candidate.postTask === "function") {
      return candidate;
    }
    return void 0;
  }
  async function yieldToMain() {
    const scheduler = getScheduler();
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
    const selector = options.selector ?? "[data-forma-contain]";
    if (!selector) return 0;
    if (typeof root.querySelectorAll !== "function") return 0;
    const nodes = root.querySelectorAll(selector);
    let applied = 0;
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (!el?.style) continue;
      const contain = el.getAttribute("data-forma-contain") ?? options.contain ?? "layout style paint";
      const contentVisibility = el.getAttribute("data-forma-content-visibility") ?? options.contentVisibility ?? "auto";
      const containIntrinsicSize = el.getAttribute("data-forma-contain-intrinsic-size") ?? options.containIntrinsicSize ?? "auto 800px";
      const skipExisting = options.skipIfAlreadySet === true;
      let changed = false;
      const containCurrent = el.style.getPropertyValue("contain");
      const contentVisCurrent = el.style.getPropertyValue("content-visibility");
      const containSizeCurrent = el.style.getPropertyValue("contain-intrinsic-size");
      if (contain !== "off" && (!skipExisting || !containCurrent)) {
        el.style.setProperty("contain", contain);
        changed = true;
      }
      if (contentVisibility !== "off" && (!skipExisting || !contentVisCurrent)) {
        el.style.setProperty("content-visibility", contentVisibility);
        changed = true;
      }
      if (containIntrinsicSize !== "off" && (!skipExisting || !containSizeCurrent)) {
        el.style.setProperty("contain-intrinsic-size", containIntrinsicSize);
        changed = true;
      }
      if (changed) applied++;
    }
    if (_debug && applied > 0) {
      dbg("applyContainmentHints: applied to", applied, "element(s)");
    }
    return applied;
  }
  var RE_STRING_SINGLE = /^'[^']*'$/;
  var RE_STRING_DOUBLE = /^"[^"]*"$/;
  var RE_NUMBER = /^-?\d+(\.\d+)?$/;
  var RE_IDENTIFIER = /^[a-zA-Z_$]\w*$/;
  var RE_DOT_ACCESS = /^(\w+)\.(\w+)$/;
  var RE_BRACKET = /^(\w+)\[(\d+|'[^']*'|"[^"]*")\]$/;
  var RE_TERNARY = /^(.+?)\s*\?\s*(.+?)\s*:\s*(.+)$/;
  var RE_NULLISH = /^(.+?)\s*\?\?\s*(.+)$/;
  var RE_AND = /^(.+?)\s*&&\s*(.+)$/;
  var RE_OR = /^(.+?)\s*\|\|\s*(.+)$/;
  var RE_COMPARISON = /^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/;
  var RE_MUL = /^(.+?)\s*([*/%])\s*(.+)$/;
  var RE_ADD = /^(.+?)\s*([+-])\s*(.+)$/;
  var RE_TEMPLATE_LIT = /^`([^`]*)`$/;
  var RE_TEMPLATE_INTERP = /\$\{([^}]+)\}/g;
  var RE_GROUP_METHOD_CALL = /^\((.+)\)\.(\w+)\((.*)\)$/;
  var RE_STRIP_BRACES = /^\{|\}$/g;
  var RE_DIGIT_ONLY = /^\d+$/;
  var RE_POST_INCR = /^(\w+)(\+\+|--)$/;
  var RE_PRE_INCR = /^(\+\+|--)(\w+)$/;
  var RE_TOGGLE = /^(\w+)\s*=\s*!(\w+)$/;
  var RE_ASSIGN = /^(\w+)\s*=\s*(.+)$/;
  var RE_COMPOUND = /^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+)$/;
  var RE_IF_PREFIX = /^if\b/;
  var RE_COMPUTED = /^(\w+)\s*=\s*(.+)$/;
  var RE_FETCH = /^(.+?)(?:→|->)\s*(\S+)(.*)$/;
  var RE_FETCH_METHOD = /^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i;
  var RE_STRIP_ITEM_BRACES = /^\{item\.?|\}$/g;
  var RE_EVENT_REF = /\bevent\s*[.([]|\$event\b/;
  var RE_REFETCH_CALL = /^\$refetch\(\s*['"]([^'"]+)['"]\s*\)$/;
  var TRANSITION_STATE_SYM = /* @__PURE__ */ Symbol.for("forma-transition-state");
  var EXPRESSION_CACHE_MAX = 2048;
  var expressionCache = /* @__PURE__ */ new Map();
  function cacheExpression(key, factory) {
    if (expressionCache.size >= EXPRESSION_CACHE_MAX) {
      const first = expressionCache.keys().next().value;
      if (first !== void 0) expressionCache.delete(first);
    }
    expressionCache.set(key, factory);
  }
  var scopeExpressionCache = /* @__PURE__ */ new WeakMap();
  var scopeHandlerCache = /* @__PURE__ */ new WeakMap();
  var compiledTemplateCache = /* @__PURE__ */ new Map();
  var COMPILED_TEMPLATE_CACHE_MAX = 2048;
  function cacheCompiledTemplate(key, template) {
    if (compiledTemplateCache.size >= COMPILED_TEMPLATE_CACHE_MAX) {
      const first = compiledTemplateCache.keys().next().value;
      if (first !== void 0) compiledTemplateCache.delete(first);
    }
    compiledTemplateCache.set(key, template);
  }
  var UNSAFE_METHOD_NAMES = /* @__PURE__ */ new Set([
    "constructor",
    "__proto__",
    "prototype",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "eval",
    "Function"
  ]);
  var BLOCKED_METHOD_REGEXES = (() => {
    const result = [];
    for (const name of UNSAFE_METHOD_NAMES) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result.push({
        name,
        // Match as property access (.name) or bare identifier at start
        dotRe: new RegExp(`(?:^|\\.)${escaped}(?:\\s*\\(|\\s*$|[^\\w$])`, "m"),
        // Match bracket access with single quotes, double quotes, or backticks
        bracketRe: new RegExp(`\\[\\s*(?:'${escaped}'|"${escaped}"|\`` + escaped + `\`)\\s*\\]`)
      });
    }
    return result;
  })();
  function findBlockedMethod(expr) {
    let cleaned = expr.replace(/\/\*[\s\S]*?\*\//g, "");
    cleaned = cleaned.replace(/\/\/[^\n]*/g, "");
    cleaned = cleaned.replace(/\s*\.\s*/g, ".");
    for (const { name, dotRe, bracketRe } of BLOCKED_METHOD_REGEXES) {
      if (dotRe.test(cleaned)) return name;
      if (bracketRe.test(cleaned)) return name;
    }
    if (cleaned.includes("[")) {
      const bracketContents = extractBracketContents(cleaned);
      for (const content of bracketContents) {
        if (!content.includes("+")) continue;
        const fragments = content.match(/['"`]([^'"`]*?)['"`]/g);
        if (!fragments) continue;
        const joined = fragments.map((f) => f.slice(1, -1)).join("");
        if (UNSAFE_METHOD_NAMES.has(joined)) return joined;
      }
    }
    return null;
  }
  function extractBracketContents(expr) {
    const results = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === "[") {
        if (depth === 0) start = i + 1;
        depth++;
      } else if (expr[i] === "]") {
        depth--;
        if (depth === 0 && start >= 0) {
          results.push(expr.slice(start, i));
          start = -1;
        }
      }
    }
    return results;
  }
  var TEXT_BINDING_SYM = /* @__PURE__ */ Symbol.for("forma-text-binding-cache");
  function toTextValue(value2) {
    if (value2 == null) return "";
    if (typeof value2 === "string") return value2;
    if (typeof value2 === "symbol") return value2.toString();
    return String(value2);
  }
  function setElementTextFast(el, next) {
    let cache = el[TEXT_BINDING_SYM];
    if (!cache) {
      cache = { initialized: false, last: "", node: null };
      el[TEXT_BINDING_SYM] = cache;
    }
    if (cache.initialized && cache.last === next) return;
    let node = cache.node;
    if (!node || node.parentNode !== el || el.childNodes.length !== 1 || el.firstChild !== node) {
      if (el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE) {
        node = el.firstChild;
        cache.node = node;
      } else {
        el.textContent = next;
        const first = el.firstChild;
        cache.node = first && first.nodeType === Node.TEXT_NODE && el.childNodes.length === 1 ? first : null;
        cache.last = next;
        cache.initialized = true;
        return;
      }
    }
    node.data = next;
    cache.last = next;
    cache.initialized = true;
  }
  function splitCallArgs(raw) {
    const out = [];
    if (raw.trim() === "") return out;
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    let start = 0;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (inSingle) {
        if (ch === "'") inSingle = false;
        continue;
      }
      if (inDouble) {
        if (ch === '"') inDouble = false;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        continue;
      }
      if (ch === "(") {
        depth++;
        continue;
      }
      if (ch === ")") {
        if (depth > 0) depth--;
        continue;
      }
      if (ch === "," && depth === 0) {
        out.push(raw.slice(start, i).trim());
        start = i + 1;
      }
    }
    out.push(raw.slice(start).trim());
    return out.filter(Boolean);
  }
  function readBalancedSegment(input, start, open, close) {
    if (input[start] !== open) return null;
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;
    for (let i = start; i < input.length; i++) {
      const ch = input[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\" && (inSingle || inDouble || inTemplate)) {
        escaped = true;
        continue;
      }
      if (inSingle) {
        if (ch === "'") inSingle = false;
        continue;
      }
      if (inDouble) {
        if (ch === '"') inDouble = false;
        continue;
      }
      if (inTemplate) {
        if (ch === "`") inTemplate = false;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }
      if (ch === open) {
        depth++;
        continue;
      }
      if (ch === close) {
        depth--;
        if (depth === 0) {
          return {
            inner: input.slice(start + 1, i),
            end: i
          };
        }
      }
    }
    return null;
  }
  function splitTopLevelStatements(raw) {
    const input = raw.trim();
    if (!input) return [];
    const out = [];
    let depthParen = 0;
    let depthBrace = 0;
    let depthBracket = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;
    let start = 0;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\" && (inSingle || inDouble || inTemplate)) {
        escaped = true;
        continue;
      }
      if (inSingle) {
        if (ch === "'") inSingle = false;
        continue;
      }
      if (inDouble) {
        if (ch === '"') inDouble = false;
        continue;
      }
      if (inTemplate) {
        if (ch === "`") inTemplate = false;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }
      if (ch === "(") depthParen++;
      else if (ch === ")" && depthParen > 0) depthParen--;
      else if (ch === "{") depthBrace++;
      else if (ch === "}" && depthBrace > 0) depthBrace--;
      else if (ch === "[") depthBracket++;
      else if (ch === "]" && depthBracket > 0) depthBracket--;
      if (ch === ";" && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
        const stmt = input.slice(start, i).trim();
        if (stmt) out.push(stmt);
        start = i + 1;
      }
    }
    const tail = input.slice(start).trim();
    if (tail) out.push(tail);
    return out;
  }
  function consumeStatement(raw) {
    const input = raw.trim();
    if (!input) return null;
    if (input.startsWith("{")) {
      const block = readBalancedSegment(input, 0, "{", "}");
      if (!block) return null;
      const body = block.inner.trim();
      let rest = input.slice(block.end + 1).trim();
      if (rest.startsWith(";")) rest = rest.slice(1).trim();
      return { body, rest };
    }
    let depthParen = 0;
    let depthBrace = 0;
    let depthBracket = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\" && (inSingle || inDouble || inTemplate)) {
        escaped = true;
        continue;
      }
      if (inSingle) {
        if (ch === "'") inSingle = false;
        continue;
      }
      if (inDouble) {
        if (ch === '"') inDouble = false;
        continue;
      }
      if (inTemplate) {
        if (ch === "`") inTemplate = false;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }
      if (ch === "(") depthParen++;
      else if (ch === ")" && depthParen > 0) depthParen--;
      else if (ch === "{") depthBrace++;
      else if (ch === "}" && depthBrace > 0) depthBrace--;
      else if (ch === "[") depthBracket++;
      else if (ch === "]" && depthBracket > 0) depthBracket--;
      if (ch === ";" && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
        return {
          body: input.slice(0, i).trim(),
          rest: input.slice(i + 1).trim()
        };
      }
    }
    return {
      body: input,
      rest: ""
    };
  }
  function parseIfHandler(expr, scope) {
    const input = expr.trim();
    if (!RE_IF_PREFIX.test(input)) return null;
    if (RE_EVENT_REF.test(input)) return null;
    let idx = 2;
    while (idx < input.length && /\s/.test(input[idx])) idx++;
    if (input[idx] !== "(") return null;
    const condSegment = readBalancedSegment(input, idx, "(", ")");
    if (!condSegment) return null;
    const condExpr = parseExpression(condSegment.inner.trim(), scope);
    if (!condExpr) return null;
    let rest = input.slice(condSegment.end + 1).trim();
    const thenStmt = consumeStatement(rest);
    if (!thenStmt || !thenStmt.body) return null;
    const thenHandler = parseHandler(thenStmt.body, scope);
    if (!thenHandler) return null;
    rest = thenStmt.rest.trim();
    let elseHandler = null;
    if (rest.startsWith("else")) {
      rest = rest.slice("else".length).trim();
      const elseStmt = consumeStatement(rest);
      if (!elseStmt || !elseStmt.body) return null;
      elseHandler = parseHandler(elseStmt.body, scope);
      if (!elseHandler) return null;
      rest = elseStmt.rest.trim();
    }
    if (rest.length > 0) return null;
    return (e) => {
      batch(() => {
        if (condExpr()) thenHandler(e);
        else elseHandler?.(e);
      });
    };
  }
  function unwrapOuterParens(raw) {
    let expr = raw.trim();
    while (expr.startsWith("(")) {
      const segment = readBalancedSegment(expr, 0, "(", ")");
      if (!segment || segment.end !== expr.length - 1) break;
      const inner = segment.inner.trim();
      if (!inner) break;
      expr = inner;
    }
    return expr;
  }
  function compileTemplate(text) {
    const cached = compiledTemplateCache.get(text);
    if (cached) return cached;
    const statics = [];
    const dynamics = [];
    let lastIndex = 0;
    const re = /\{item\.?(\w*)\}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      statics.push(text.slice(lastIndex, m.index));
      dynamics.push(m[1]);
      lastIndex = re.lastIndex;
    }
    statics.push(text.slice(lastIndex));
    const result = {
      statics,
      dynamics,
      hasItemRef: dynamics.length > 0
    };
    cacheCompiledTemplate(text, result);
    return result;
  }
  var templateTexts = /* @__PURE__ */ new WeakMap();
  function evaluateCompiledTemplate(compiled, item) {
    if (!compiled.hasItemRef) return compiled.statics[0];
    let result = compiled.statics[0];
    for (let i = 0; i < compiled.dynamics.length; i++) {
      const key = compiled.dynamics[i];
      if (!key) {
        result += typeof item === "object" ? JSON.stringify(item) : String(item ?? "");
      } else {
        result += String(item?.[key] ?? "");
      }
      result += compiled.statics[i + 1] ?? "";
    }
    return result;
  }
  function cloneWithTemplateData(template, item) {
    const clone = template.cloneNode(true);
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent ?? "";
      if (text.includes("{item")) {
        const compiled = compileTemplate(text);
        templateTexts.set(node, compiled);
        node.textContent = evaluateCompiledTemplate(compiled, item);
      }
    }
    cloneAttributeTemplates(clone, item);
    return clone;
  }
  function updateTemplateData(el, item) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const compiled = templateTexts.get(node);
      if (compiled) {
        node.textContent = evaluateCompiledTemplate(compiled, item);
      }
    }
  }
  var templateAttrs = /* @__PURE__ */ new WeakMap();
  var DIRECTIVE_ATTR_PREFIXES = [
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
    for (const prefix of DIRECTIVE_ATTR_PREFIXES) {
      if (name === prefix || name.startsWith(prefix)) return true;
    }
    return false;
  }
  function splitClassTokens(raw) {
    if (!raw) return [];
    return raw.trim().split(/\s+/).map((t) => t.trim()).filter(Boolean);
  }
  function parseDurationTokenMs(token) {
    const t = token.trim().toLowerCase();
    if (t.endsWith("ms")) {
      const n = Number(t.slice(0, -2));
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    if (t.endsWith("s")) {
      const n = Number(t.slice(0, -1));
      return Number.isFinite(n) && n >= 0 ? n * 1e3 : null;
    }
    return null;
  }
  function parseClassTokensAndDuration(raw) {
    const classes = [];
    let durationMs;
    for (const token of splitClassTokens(raw)) {
      const parsed = parseDurationTokenMs(token);
      if (parsed != null) {
        durationMs = parsed;
      } else {
        classes.push(token);
      }
    }
    return { classes, durationMs };
  }
  function uniqueTokens(tokens) {
    return Array.from(new Set(tokens.filter(Boolean)));
  }
  function parseCssTimeListMs(raw) {
    if (!raw) return [];
    return raw.split(",").map((part) => parseDurationTokenMs(part.trim())).filter((ms) => ms != null);
  }
  function maxCombinedTimingsMs(durations, delays) {
    if (durations.length === 0 && delays.length === 0) return 0;
    if (durations.length === 0) return Math.max(...delays, 0);
    if (delays.length === 0) return Math.max(...durations, 0);
    const len = Math.max(durations.length, delays.length);
    let max = 0;
    for (let i = 0; i < len; i++) {
      const d = durations[i % durations.length] ?? 0;
      const delay = delays[i % delays.length] ?? 0;
      if (d + delay > max) max = d + delay;
    }
    return max;
  }
  function resolveTransitionDurationMs(el, explicitMs) {
    if (typeof explicitMs === "number") return explicitMs;
    const cs = window.getComputedStyle(el);
    const trans = maxCombinedTimingsMs(
      parseCssTimeListMs(cs.transitionDuration),
      parseCssTimeListMs(cs.transitionDelay)
    );
    const anim = maxCombinedTimingsMs(
      parseCssTimeListMs(cs.animationDuration),
      parseCssTimeListMs(cs.animationDelay)
    );
    return Math.max(trans, anim);
  }
  function getTransitionState(el) {
    const existing = el[TRANSITION_STATE_SYM];
    if (existing) return existing;
    const created = { token: 0, cancel: null };
    el[TRANSITION_STATE_SYM] = created;
    return created;
  }
  function clearTransitionState(el) {
    const state = el[TRANSITION_STATE_SYM];
    if (state?.cancel) {
      state.cancel();
    }
    delete el[TRANSITION_STATE_SYM];
  }
  function parseTransitionSpec(el) {
    const hasTransitionAttr = el.hasAttribute("data-transition") || Array.from(el.attributes).some((a) => a.name.startsWith("data-transition:"));
    if (!hasTransitionAttr) return null;
    const base = parseClassTokensAndDuration(el.getAttribute("data-transition")).classes;
    const enter = parseClassTokensAndDuration(el.getAttribute("data-transition:enter"));
    const leave = parseClassTokensAndDuration(el.getAttribute("data-transition:leave"));
    const enterFrom = splitClassTokens(
      el.getAttribute("data-transition:enter-from") ?? el.getAttribute("data-transition:enter-start")
    );
    const enterTo = splitClassTokens(
      el.getAttribute("data-transition:enter-to") ?? el.getAttribute("data-transition:enter-end")
    );
    const leaveFrom = splitClassTokens(
      el.getAttribute("data-transition:leave-from") ?? el.getAttribute("data-transition:leave-start")
    );
    const leaveTo = splitClassTokens(
      el.getAttribute("data-transition:leave-to") ?? el.getAttribute("data-transition:leave-end")
    );
    const durationBoth = parseDurationTokenMs(el.getAttribute("data-transition:duration") ?? "");
    const enterDuration = parseDurationTokenMs(el.getAttribute("data-transition:duration-enter") ?? "") ?? enter.durationMs ?? durationBoth ?? void 0;
    const leaveDuration = parseDurationTokenMs(el.getAttribute("data-transition:duration-leave") ?? "") ?? leave.durationMs ?? durationBoth ?? void 0;
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
    for (const cls of classes) {
      el.classList.remove(cls);
    }
  }
  function addClasses(el, classes) {
    for (const cls of classes) {
      el.classList.add(cls);
    }
  }
  function runTransitionPhase(el, phaseClasses, onDone) {
    const cleanupClasses = uniqueTokens([
      ...phaseClasses.base,
      ...phaseClasses.from,
      ...phaseClasses.to
    ]);
    let done = false;
    let timeoutId = null;
    let raf1 = null;
    let raf2 = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      if (raf1 != null) cancelAnimationFrame(raf1);
      if (raf2 != null) cancelAnimationFrame(raf2);
      removeClasses(el, cleanupClasses);
      onDone();
    };
    addClasses(el, phaseClasses.base);
    addClasses(el, phaseClasses.from);
    removeClasses(el, phaseClasses.to);
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (done) return;
        removeClasses(el, phaseClasses.from);
        addClasses(el, phaseClasses.to);
        const ms = resolveTransitionDurationMs(el, phaseClasses.durationMs);
        if (ms <= 0) {
          finish();
          return;
        }
        timeoutId = window.setTimeout(finish, ms + 25);
      });
    });
    return finish;
  }
  function transitionInsert(el, parent, ref, spec) {
    parent.insertBefore(el, ref);
    if (!spec) return;
    const state = getTransitionState(el);
    state.token += 1;
    const token = state.token;
    if (state.cancel) state.cancel();
    state.cancel = runTransitionPhase(
      el,
      {
        base: spec.enter,
        from: spec.enterFrom,
        to: spec.enterTo,
        durationMs: spec.enterDurationMs
      },
      () => {
        const current = getTransitionState(el);
        if (current.token === token) current.cancel = null;
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
    const state = getTransitionState(el);
    state.token += 1;
    const token = state.token;
    if (state.cancel) state.cancel();
    state.cancel = runTransitionPhase(
      el,
      {
        base: spec.leave,
        from: spec.leaveFrom,
        to: spec.leaveTo,
        durationMs: spec.leaveDurationMs
      },
      () => {
        const current = getTransitionState(el);
        if (current.token === token) current.cancel = null;
        el.removeAttribute("data-forma-leaving");
        onDone();
      }
    );
  }
  function applyShowVisibility(el, visible, transition, initial) {
    if (!transition || initial) {
      el.style.display = visible ? "" : "none";
      if (transition) {
        removeClasses(el, uniqueTokens([
          ...transition.enter,
          ...transition.enterFrom,
          ...transition.enterTo,
          ...transition.leave,
          ...transition.leaveFrom,
          ...transition.leaveTo
        ]));
      }
      return;
    }
    const state = getTransitionState(el);
    state.token += 1;
    const token = state.token;
    if (state.cancel) state.cancel();
    state.cancel = null;
    if (visible) {
      el.style.display = "";
      state.cancel = runTransitionPhase(
        el,
        {
          base: transition.enter,
          from: transition.enterFrom,
          to: transition.enterTo,
          durationMs: transition.enterDurationMs
        },
        () => {
          const current = getTransitionState(el);
          if (current.token === token) current.cancel = null;
        }
      );
      return;
    }
    state.cancel = runTransitionPhase(
      el,
      {
        base: transition.leave,
        from: transition.leaveFrom,
        to: transition.leaveTo,
        durationMs: transition.leaveDurationMs
      },
      () => {
        const current = getTransitionState(el);
        if (current.token !== token) return;
        el.style.display = "none";
        current.cancel = null;
      }
    );
  }
  function cloneAttributeTemplates(el, item) {
    const all = [el, ...Array.from(el.querySelectorAll("*"))];
    for (const node of all) {
      const entries = [];
      for (const attr of Array.from(node.attributes)) {
        if (isDirectiveAttr(attr.name)) continue;
        if (attr.value.includes("{item")) {
          const compiled = compileTemplate(attr.value);
          entries.push({ attr: attr.name, compiled });
          node.setAttribute(attr.name, evaluateCompiledTemplate(compiled, item));
        }
      }
      if (entries.length > 0) {
        templateAttrs.set(node, entries);
      }
    }
  }
  function parseChainedAccess(expr, scope) {
    let pos = 0;
    const identMatch = expr.match(/^[a-zA-Z_$]\w*/);
    if (!identMatch) return null;
    const rootName = identMatch[0];
    pos = rootName.length;
    if (pos >= expr.length) return null;
    if (expr[pos] !== "." && !(expr[pos] === "?" && expr[pos + 1] === ".")) return null;
    const steps = [];
    while (pos < expr.length) {
      let optional = false;
      if (expr[pos] === "?" && expr[pos + 1] === ".") {
        optional = true;
        pos += 2;
      } else if (expr[pos] === ".") {
        pos += 1;
      } else {
        return null;
      }
      const nameMatch = expr.slice(pos).match(/^\w+/);
      if (!nameMatch) return null;
      const name = nameMatch[0];
      pos += name.length;
      if (UNSAFE_METHOD_NAMES.has(name)) return () => void 0;
      if (pos < expr.length && expr[pos] === "(") {
        const balanced = readBalancedSegment(expr, pos, "(", ")");
        if (!balanced) return null;
        const argsRaw = balanced.inner.trim();
        const argFns = [];
        for (const arg of splitCallArgs(argsRaw)) {
          const parsed = parseExpression(arg, scope);
          if (!parsed) return null;
          argFns.push(parsed);
        }
        steps.push({ type: "call", name, optional, argFns });
        pos = balanced.end + 1;
      } else {
        steps.push({ type: "prop", name, optional });
      }
    }
    if (pos !== expr.length) return null;
    if (steps.length === 0) return null;
    const rootExpr = rootName === "Math" ? (() => Math) : (() => scope.getters[rootName]?.());
    return () => {
      let val = rootExpr();
      for (const step of steps) {
        if (val == null) {
          if (step.optional) return void 0;
          return void 0;
        }
        if (step.type === "prop") {
          val = val[step.name];
        } else {
          const method = val[step.name];
          if (typeof method !== "function") return void 0;
          const args = step.argFns.map((fn) => fn());
          val = method.apply(val, args);
        }
      }
      return val;
    };
  }
  function parseExpression(expr, scope) {
    const cachedFactory = expressionCache.get(expr);
    if (cachedFactory) return cachedFactory(scope);
    const result = parseExpressionUncached(expr, scope);
    if (result !== null) {
      if (expr === "true" || expr === "false" || expr === "null" || expr === "undefined") {
        const val = expr === "true" ? true : expr === "false" ? false : expr === "null" ? null : void 0;
        cacheExpression(expr, () => () => val);
      } else if (RE_IDENTIFIER.test(expr)) {
        cacheExpression(expr, (s) => () => s.getters[expr]?.());
      } else if (RE_STRING_SINGLE.test(expr) || RE_STRING_DOUBLE.test(expr)) {
        const val = expr.slice(1, -1);
        cacheExpression(expr, () => () => val);
      } else if (RE_NUMBER.test(expr)) {
        const val = Number(expr);
        cacheExpression(expr, () => () => val);
      } else {
        const dotMatch = expr.match(RE_DOT_ACCESS);
        if (dotMatch) {
          const p1 = dotMatch[1], p2 = dotMatch[2];
          cacheExpression(expr, (s) => () => {
            const obj = s.getters[p1]?.();
            return obj?.[p2];
          });
        }
      }
    }
    return result;
  }
  function parseExpressionUncached(expr, scope) {
    expr = expr.trim();
    const unwrapped = unwrapOuterParens(expr);
    if (unwrapped !== expr) {
      return parseExpression(unwrapped, scope);
    }
    if (RE_STRING_SINGLE.test(expr) || RE_STRING_DOUBLE.test(expr)) {
      const val = expr.slice(1, -1);
      return () => val;
    }
    if (RE_NUMBER.test(expr)) {
      const val = Number(expr);
      return () => val;
    }
    if (expr === "true") return () => true;
    if (expr === "false") return () => false;
    if (expr === "null") return () => null;
    if (expr === "undefined") return () => void 0;
    if (RE_IDENTIFIER.test(expr)) {
      return () => scope.getters[expr]?.();
    }
    {
      const chainResult = parseChainedAccess(expr, scope);
      if (chainResult) return chainResult;
    }
    const groupedCallMatch = expr.match(RE_GROUP_METHOD_CALL);
    if (groupedCallMatch) {
      const baseRaw = groupedCallMatch[1].trim();
      const methodName = groupedCallMatch[2];
      const argsRaw = groupedCallMatch[3].trim();
      if (UNSAFE_METHOD_NAMES.has(methodName)) return () => void 0;
      const baseExpr = parseExpression(baseRaw, scope);
      if (!baseExpr) return null;
      const argFns = [];
      for (const arg of splitCallArgs(argsRaw)) {
        const parsed = parseExpression(arg, scope);
        if (!parsed) return null;
        argFns.push(parsed);
      }
      return () => {
        const base = baseExpr();
        const method = base?.[methodName];
        if (typeof method !== "function") return void 0;
        const args = argFns.map((fn) => fn());
        return method.apply(base, args);
      };
    }
    if (expr.startsWith("!")) {
      const inner = parseExpression(expr.slice(1).trim(), scope);
      if (inner) return () => !inner();
    }
    const bracketMatch = expr.match(RE_BRACKET);
    if (bracketMatch) {
      const objExpr = parseExpression(bracketMatch[1], scope);
      let key;
      const rawKey = bracketMatch[2];
      if (RE_DIGIT_ONLY.test(rawKey)) {
        key = Number(rawKey);
      } else {
        key = rawKey.slice(1, -1);
      }
      if (objExpr) {
        return () => objExpr()?.[key];
      }
    }
    if (expr.startsWith("[")) {
      const balanced = readBalancedSegment(expr, 0, "[", "]");
      if (balanced && balanced.end === expr.length - 1) {
        const inner = balanced.inner.trim();
        if (inner === "") {
          return () => [];
        }
        const elements = splitCallArgs(inner);
        const elementFns = [];
        let allParsed = true;
        for (const el of elements) {
          const parsed = parseExpression(el.trim(), scope);
          if (!parsed) {
            allParsed = false;
            break;
          }
          elementFns.push(parsed);
        }
        if (allParsed) {
          return () => elementFns.map((fn) => fn());
        }
      }
    }
    const ternaryMatch = expr.match(RE_TERNARY);
    if (ternaryMatch) {
      const cond = parseExpression(ternaryMatch[1].trim(), scope);
      const then = parseExpression(ternaryMatch[2].trim(), scope);
      const els = parseExpression(ternaryMatch[3].trim(), scope);
      if (cond && then && els) {
        return () => cond() ? then() : els();
      }
    }
    const nullishMatch = expr.match(RE_NULLISH);
    if (nullishMatch) {
      const left = parseExpression(nullishMatch[1].trim(), scope);
      const right = parseExpression(nullishMatch[2].trim(), scope);
      if (left && right) {
        return () => left() ?? right();
      }
    }
    const orMatch = expr.match(RE_OR);
    if (orMatch) {
      const left = parseExpression(orMatch[1].trim(), scope);
      const right = parseExpression(orMatch[2].trim(), scope);
      if (left && right) {
        return () => left() || right();
      }
    }
    const andMatch = expr.match(RE_AND);
    if (andMatch) {
      const left = parseExpression(andMatch[1].trim(), scope);
      const right = parseExpression(andMatch[2].trim(), scope);
      if (left && right) {
        return () => left() && right();
      }
    }
    const compMatch = expr.match(RE_COMPARISON);
    if (compMatch) {
      const left = parseExpression(compMatch[1].trim(), scope);
      const right = parseExpression(compMatch[3].trim(), scope);
      if (left && right) {
        const op = compMatch[2];
        return () => {
          const l = left(), r = right();
          switch (op) {
            case "===":
              return l === r;
            case "!==":
              return l !== r;
            case "==":
              return l == r;
            case "!=":
              return l != r;
            case ">":
              return l > r;
            case "<":
              return l < r;
            case ">=":
              return l >= r;
            case "<=":
              return l <= r;
          }
        };
      }
    }
    const addMatch = expr.match(RE_ADD);
    if (addMatch) {
      const left = parseExpression(addMatch[1].trim(), scope);
      const right = parseExpression(addMatch[3].trim(), scope);
      if (left && right) {
        const op = addMatch[2];
        return () => {
          const l = left(), r = right();
          if (op === "+") return l + r;
          return l - r;
        };
      }
    }
    const mulMatch = expr.match(RE_MUL);
    if (mulMatch) {
      const left = parseExpression(mulMatch[1].trim(), scope);
      const right = parseExpression(mulMatch[3].trim(), scope);
      if (left && right) {
        const op = mulMatch[2];
        return () => {
          const l = left(), r = right();
          switch (op) {
            case "*":
              return l * r;
            case "/":
              return l / r;
            case "%":
              return l % r;
          }
        };
      }
    }
    const tmplMatch = expr.match(RE_TEMPLATE_LIT);
    if (tmplMatch) {
      const raw = tmplMatch[1];
      const staticParts = [];
      const dynamicFns = [];
      let lastIndex = 0;
      const re = new RegExp(RE_TEMPLATE_INTERP.source, "g");
      let m;
      while ((m = re.exec(raw)) !== null) {
        staticParts.push(raw.slice(lastIndex, m.index));
        const inner = parseExpression(m[1].trim(), scope);
        if (!inner) return null;
        dynamicFns.push(inner);
        lastIndex = re.lastIndex;
      }
      staticParts.push(raw.slice(lastIndex));
      return () => {
        let result = staticParts[0];
        for (let i = 0; i < dynamicFns.length; i++) {
          result += String(dynamicFns[i]() ?? "");
          result += staticParts[i + 1] ?? "";
        }
        return result;
      };
    }
    return null;
  }
  function getScopeCache(cache, scope) {
    let scoped = cache.get(scope);
    if (!scoped) {
      scoped = /* @__PURE__ */ new Map();
      cache.set(scope, scoped);
    }
    return scoped;
  }
  function cspExpressionHint(expr) {
    if (expr.includes("...")) {
      return `Unsupported expression in CSP-safe mode: spread syntax detected. Use .concat() instead, or enable unsafe-eval via setUnsafeEval(true).`;
    }
    if (expr.includes("=>")) {
      return `Unsupported expression in CSP-safe mode: arrow function detected. Extract logic to a data-computed attribute, or enable unsafe-eval via setUnsafeEval(true).`;
    }
    return `Unsupported expression in CSP-safe mode. Simplify the expression or enable unsafe-eval via setUnsafeEval(true).`;
  }
  function buildEvaluator(expr, scope) {
    const cleaned = expr.replace(RE_STRIP_BRACES, "").trim();
    const cache = getScopeCache(scopeExpressionCache, scope);
    const cached = cache.get(cleaned);
    if (cached) return cached;
    const cspFn = parseExpression(cleaned, scope);
    if (cspFn) {
      cache.set(cleaned, cspFn);
      return cspFn;
    }
    if (!__EVAL_CAPABLE__ || !_allowUnsafeEval) {
      dbg("buildEvaluator: blocked unsafe eval fallback for expression:", cleaned);
      reportDiagnostic("expression-unsupported", cleaned, cspExpressionHint(cleaned));
      const blocked = () => void 0;
      cache.set(cleaned, blocked);
      return blocked;
    }
    const blockedMethod = findBlockedMethod(cleaned);
    if (blockedMethod) {
      const msg = `Blocked unsafe method "${blockedMethod}" in expression`;
      reportDiagnostic("expression-unsupported", cleaned, msg);
      throw new Error(`[FormaJS] ${msg}: ${cleaned}`);
    }
    try {
      const fn = new Function("__scope", `with(__scope) { return (${cleaned}); }`);
      const proxy = new Proxy(/* @__PURE__ */ Object.create(null), {
        has(_, key) {
          return key in scope.getters;
        },
        get(_, key) {
          if (UNSAFE_METHOD_NAMES.has(key)) return void 0;
          const g = scope.getters[key];
          return g ? g() : void 0;
        }
      });
      const unsafe = () => fn(proxy);
      cache.set(cleaned, unsafe);
      return unsafe;
    } catch {
      reportDiagnostic("expression-unsupported", cleaned, "Expression too complex for CSP-safe mode. Enable unsafe-eval via FormaRuntime.unsafeEval = true, or use the standard (non-hardened) build.");
      const failed = () => void 0;
      cache.set(cleaned, failed);
      return failed;
    }
  }
  function parseHandler(expr, scope) {
    const normalized = expr.trim().replace(/;+$/g, "").trim();
    if (!normalized) return null;
    const ifHandler = parseIfHandler(normalized, scope);
    if (ifHandler) return ifHandler;
    const stmts = splitTopLevelStatements(normalized);
    if (stmts.length > 1) {
      const handlers = stmts.map((s) => parseHandler(s, scope));
      if (handlers.every((h) => h !== null)) {
        return (e) => {
          batch(() => {
            for (const h of handlers) h(e);
          });
        };
      }
      return null;
    }
    const single = stmts[0] ?? normalized;
    const incrMatch = single.match(RE_POST_INCR);
    if (incrMatch) {
      const name = incrMatch[1];
      const op = incrMatch[2];
      return () => {
        batch(() => {
          const val = scope.getters[name]?.() ?? 0;
          scope.setters[name]?.(op === "++" ? val + 1 : val - 1);
        });
      };
    }
    const preIncrMatch = single.match(RE_PRE_INCR);
    if (preIncrMatch) {
      const op = preIncrMatch[1];
      const name = preIncrMatch[2];
      return () => {
        batch(() => {
          const val = scope.getters[name]?.() ?? 0;
          scope.setters[name]?.(op === "++" ? val + 1 : val - 1);
        });
      };
    }
    const toggleMatch = single.match(RE_TOGGLE);
    if (toggleMatch && toggleMatch[1] === toggleMatch[2]) {
      const name = toggleMatch[1];
      return () => {
        batch(() => {
          scope.setters[name]?.(!scope.getters[name]?.());
        });
      };
    }
    const assignMatch = single.match(RE_ASSIGN);
    if (assignMatch) {
      const name = assignMatch[1];
      const valExpr = parseExpression(assignMatch[2].trim(), scope);
      if (valExpr) {
        if (_debug) dbg(`parseHandler: assignment "${name} = ..." \u2014 setter exists:`, !!scope.setters[name], ", getter exists:", !!scope.getters[name]);
        return () => {
          batch(() => {
            const val = valExpr();
            if (_debug) dbg(`SETTER: ${name} = ${val} (was: ${scope.getters[name]?.()})`);
            scope.setters[name]?.(val);
          });
        };
      }
    }
    const compoundMatch = single.match(RE_COMPOUND);
    if (compoundMatch) {
      const name = compoundMatch[1];
      const op = compoundMatch[2];
      const valExpr = parseExpression(compoundMatch[3].trim(), scope);
      if (valExpr) {
        return () => {
          batch(() => {
            const current = scope.getters[name]?.() ?? 0;
            const val = valExpr();
            switch (op) {
              case "+=":
                scope.setters[name]?.(current + val);
                break;
              case "-=":
                scope.setters[name]?.(current - val);
                break;
              case "*=":
                scope.setters[name]?.(current * val);
                break;
              case "/=":
                scope.setters[name]?.(current / val);
                break;
            }
          });
        };
      }
    }
    const refetchMatch = single.match(RE_REFETCH_CALL);
    if (refetchMatch) {
      const fetchId = refetchMatch[1];
      return () => $refetch(fetchId);
    }
    return null;
  }
  function buildHandler(expr, scope) {
    let cleaned = expr.trim();
    if (cleaned.startsWith("{")) {
      const seg = readBalancedSegment(cleaned, 0, "{", "}");
      if (seg && seg.end === cleaned.length - 1) {
        cleaned = seg.inner.trim();
      }
    }
    const cache = getScopeCache(scopeHandlerCache, scope);
    const cached = cache.get(cleaned);
    if (cached) return cached;
    const cspFn = parseHandler(cleaned, scope);
    if (cspFn) {
      const result = { handler: cspFn, supported: true };
      cache.set(cleaned, result);
      return result;
    }
    if (!__EVAL_CAPABLE__ || !_allowUnsafeEval) {
      dbg("buildHandler: blocked unsafe eval fallback for expression:", cleaned);
      reportDiagnostic("handler-unsupported", cleaned, cspExpressionHint(cleaned));
      const result = {
        handler: () => {
        },
        supported: false
      };
      cache.set(cleaned, result);
      return result;
    }
    const blockedMethod = findBlockedMethod(cleaned);
    if (blockedMethod) {
      const msg = `Blocked unsafe method "${blockedMethod}" in handler`;
      reportDiagnostic("handler-unsupported", cleaned, msg);
      throw new Error(`[FormaJS] ${msg}: ${cleaned}`);
    }
    try {
      const fn = new Function("__scope", "$event", "event", `with(__scope) { ${cleaned} }`);
      const proxy = new Proxy(/* @__PURE__ */ Object.create(null), {
        has(_, key) {
          if (key === "$event" || key === "event") return false;
          return key in scope.getters || key in scope.setters;
        },
        get(_, key) {
          if (UNSAFE_METHOD_NAMES.has(key)) return void 0;
          const g = scope.getters[key];
          return g ? g() : void 0;
        },
        set(_, key, value2) {
          const s = scope.setters[key];
          if (s) s(value2);
          return true;
        }
      });
      const unsafeHandler = (e) => {
        batch(() => fn(proxy, e, e));
      };
      const result = {
        handler: unsafeHandler,
        supported: true
      };
      cache.set(cleaned, result);
      return result;
    } catch {
      reportDiagnostic("handler-unsupported", cleaned, "Expression too complex for CSP-safe mode. Enable unsafe-eval via FormaRuntime.unsafeEval = true, or use the standard (non-hardened) build.");
      const result = {
        handler: () => {
        },
        supported: false
      };
      cache.set(cleaned, result);
      return result;
    }
  }
  var FORBIDDEN_STATE_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  function parseState(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (_debug) {
        dbg("parseState: Invalid JSON in data-forma-state \u2014 use valid JSON with quoted keys. Got:", raw.slice(0, 200));
      }
      return {};
    }
    for (const key of FORBIDDEN_STATE_KEYS) {
      if (key in parsed) delete parsed[key];
    }
    return parsed;
  }
  function initScope(stateEl) {
    const raw = stateEl.getAttribute("data-forma-state") ?? "{}";
    const state = parseState(raw);
    const keys = Object.keys(state);
    if (_debug) {
      dbg("initScope: parsed", keys.length, "keys:", keys.join(", "));
      if (keys.length === 0) {
        dbg("initScope: WARNING \u2014 empty state! Raw attribute:", raw.slice(0, 200));
      }
    }
    const getters = {};
    const setters = {};
    for (const [key, initial] of Object.entries(state)) {
      const [get, set] = createSignal(initial);
      getters[key] = get;
      setters[key] = set;
    }
    getters["$refetch"] = () => $refetch;
    return { getters, setters };
  }
  var SAFE_EL_PROPS = /* @__PURE__ */ new Set([
    // Identity & attributes
    "id",
    "className",
    "tagName",
    "nodeName",
    "getAttribute",
    "setAttribute",
    "removeAttribute",
    "hasAttribute",
    "toggleAttribute",
    "dataset",
    "classList",
    // Content
    "textContent",
    "innerText",
    // Form elements
    "value",
    "checked",
    "disabled",
    "selected",
    "type",
    "name",
    "placeholder",
    "readOnly",
    "required",
    "min",
    "max",
    "step",
    "pattern",
    // Dimensions & position
    "getBoundingClientRect",
    "offsetWidth",
    "offsetHeight",
    "offsetTop",
    "offsetLeft",
    "clientWidth",
    "clientHeight",
    "scrollWidth",
    "scrollHeight",
    "scrollTop",
    "scrollLeft",
    // Style
    "style",
    "hidden",
    // Focus & interaction
    "focus",
    "blur",
    "click",
    "scrollIntoView",
    "scrollTo",
    // Traversal (safe — returns elements, not window/document)
    "closest",
    "matches",
    "querySelector",
    "querySelectorAll",
    "children",
    "childElementCount",
    "firstElementChild",
    "lastElementChild",
    "nextElementSibling",
    "previousElementSibling"
  ]);
  function createSafeElProxy(el) {
    return new Proxy(el, {
      get(target, prop) {
        if (typeof prop === "symbol") return Reflect.get(target, prop);
        if (!SAFE_EL_PROPS.has(prop)) return void 0;
        const val = Reflect.get(target, prop);
        return typeof val === "function" ? val.bind(target) : val;
      },
      set(target, prop, value2) {
        if (typeof prop === "symbol") return false;
        if (!SAFE_EL_PROPS.has(prop)) return false;
        return Reflect.set(target, prop, value2);
      }
    });
  }
  function bindElement(el, scope, disposers) {
    const elMagics = {
      $el: createSafeElProxy(el),
      $dispatch: (name, detail) => {
        el.dispatchEvent(new CustomEvent(name, {
          bubbles: true,
          composed: true,
          // crosses Shadow DOM boundaries (important for <forma-stage>)
          detail
        }));
      }
    };
    scope = createChildScope(scope, elMagics);
    const known = getDirectives(el);
    const computedAttr = !known || known.has("data-computed") ? el.getAttribute("data-computed") : null;
    if (computedAttr) {
      const parts = computedAttr.split(/;\s*(?=\w+\s*=[^=])/);
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const match = trimmed.match(RE_COMPUTED);
        if (match) {
          const name = match[1];
          const expr = match[2];
          const prevGetter = scope.getters[name];
          delete scope.getters[name];
          const evaluate = buildEvaluator(`{${expr}}`, scope);
          const getter = createComputed(evaluate);
          scope.getters[name] = getter;
          if (!prevGetter) {
            delete scope.setters[name];
          }
        }
      }
    }
    const textExpr = !known || known.has("data-text") ? el.getAttribute("data-text") : null;
    if (textExpr) {
      const evaluate = buildEvaluator(textExpr, scope);
      const dispose = internalEffect(() => {
        setElementTextFast(el, toTextValue(evaluate()));
      });
      disposers.push(dispose);
    }
    const showExpr = !known || known.has("data-show") ? el.getAttribute("data-show") : null;
    if (showExpr) {
      const evaluate = buildEvaluator(showExpr, scope);
      const transition = parseTransitionSpec(el);
      if (_debug) {
        const tag = el.tagName.toLowerCase();
        const cls = el.className ? `.${String(el.className).split(" ")[0]}` : "";
        dbg(`bindElement: data-show="${showExpr}" on <${tag}${cls}>`);
      }
      let initialized = false;
      const dispose = internalEffect(() => {
        const visible = !!evaluate();
        if (_debug) dbg(`data-show effect: "${showExpr}" \u2192 ${visible}`);
        applyShowVisibility(el, visible, transition, !initialized);
        initialized = true;
      });
      disposers.push(dispose);
      if (transition) {
        disposers.push(() => clearTransitionState(el));
      }
    }
    const ifExpr = !known || known.has("data-if") ? el.getAttribute("data-if") : null;
    if (ifExpr) {
      const evaluate = buildEvaluator(ifExpr, scope);
      const transition = parseTransitionSpec(el);
      const placeholder = document.createComment("forma-if");
      const parent = el.parentNode;
      let inserted = true;
      let initialized = false;
      const dispose = internalEffect(() => {
        const show = !!evaluate();
        if (show && !inserted) {
          clearTransitionState(el);
          el.removeAttribute("data-forma-leaving");
          if (initialized && transition) {
            transitionInsert(el, parent, placeholder, transition);
          } else {
            parent?.insertBefore(el, placeholder);
          }
          inserted = true;
        } else if (!show && inserted) {
          if (initialized && transition) {
            transitionRemove(el, transition, () => {
              if (el.parentNode) {
                parent?.insertBefore(placeholder, el);
                el.remove();
              }
            });
          } else {
            parent?.insertBefore(placeholder, el);
            el.remove();
          }
          inserted = false;
        }
        initialized = true;
      });
      disposers.push(dispose);
      if (transition) {
        disposers.push(() => clearTransitionState(el));
      }
    }
    const modelExpr = !known || known.has("data-model") ? el.getAttribute("data-model") : null;
    if (modelExpr) {
      const prop = modelExpr.replace(RE_STRIP_BRACES, "").trim();
      const getter = scope.getters[prop];
      const setter = scope.setters[prop];
      if (getter && setter) {
        const input = el;
        const dispose = internalEffect(() => {
          const val = getter();
          if (input.type === "checkbox") {
            input.checked = !!val;
          } else {
            input.value = String(val ?? "");
          }
        });
        disposers.push(dispose);
        const event = input.type === "checkbox" ? "change" : "input";
        const onModelInput = () => {
          if (input.type === "checkbox") {
            setter(input.checked);
          } else if (input.type === "number" || input.type === "range") {
            setter(Number(input.value));
          } else {
            setter(input.value);
          }
        };
        input.addEventListener(event, onModelInput);
        disposers.push(() => {
          input.removeEventListener(event, onModelInput);
        });
      }
    }
    const hasColonDirectives = !known || hasAnyPrefix(known, "data-on:", "data-class:", "data-bind:");
    const attrs = el.attributes;
    if (hasColonDirectives) for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      const name = attr.name;
      if (name.startsWith("data-on:")) {
        const event = name.slice(8);
        const built = buildHandler(attr.value, scope);
        const handler = built.handler;
        if (_debug) {
          const tag = el.tagName.toLowerCase();
          const id = el.id ? `#${el.id}` : "";
          const cls = el.className ? `.${String(el.className).split(" ")[0]}` : "";
          dbg(`bindElement: data-on:${event}="${attr.value}" on <${tag}${id}${cls}>`);
        }
        if (!built.supported) {
          el.setAttribute("data-forma-handler-error", "unsupported");
        } else if (el.hasAttribute("data-forma-handler-error")) {
          el.removeAttribute("data-forma-handler-error");
        }
        if (_debug) {
          const attrVal = attr.value;
          const tracedHandler = (e) => {
            dbg(`HANDLER FIRED: data-on:${event}="${attrVal}"`, "isTrusted:", e.isTrusted);
            handler(e);
          };
          el.addEventListener(event, tracedHandler);
          disposers.push(() => {
            el.removeEventListener(event, tracedHandler);
          });
        } else {
          el.addEventListener(event, handler);
          disposers.push(() => {
            el.removeEventListener(event, handler);
          });
        }
      } else if (name.startsWith("data-class:")) {
        const cls = name.slice(11);
        const evaluate = buildEvaluator(attr.value, scope);
        const dispose = internalEffect(() => {
          el.classList.toggle(cls, !!evaluate());
        });
        disposers.push(dispose);
      } else if (name.startsWith("data-bind:")) {
        const attrName = name.slice(10);
        const evaluate = buildEvaluator(attr.value, scope);
        const dispose = internalEffect(() => {
          const val = evaluate();
          if (val == null || val === false) {
            el.removeAttribute(attrName);
          } else {
            el.setAttribute(attrName, String(val));
          }
        });
        disposers.push(dispose);
      }
    }
    const persistExpr = !known || known.has("data-persist") ? el.getAttribute("data-persist") : null;
    if (persistExpr) {
      const prop = persistExpr.replace(RE_STRIP_BRACES, "").trim();
      const getter = scope.getters[prop];
      const setter = scope.setters[prop];
      if (getter && setter) {
        const key = "forma:" + prop;
        try {
          const saved = localStorage.getItem(key);
          if (saved !== null) setter(JSON.parse(saved));
        } catch {
        }
        const dispose = internalEffect(() => {
          try {
            localStorage.setItem(key, JSON.stringify(getter()));
          } catch {
          }
        });
        disposers.push(dispose);
      }
    }
    const listExpr = !known || known.has("data-list") ? el.getAttribute("data-list") : null;
    if (listExpr) {
      const evaluate = buildEvaluator(listExpr, scope);
      const templateEl = el.children[0];
      if (templateEl) {
        let disposeCloneBindings2 = function(node) {
          const el2 = node;
          if (Array.isArray(el2.__formaDisposers)) {
            for (const d of el2.__formaDisposers) {
              try {
                d();
              } catch {
              }
            }
            delete el2.__formaDisposers;
          }
        }, createBoundClone2 = function(item, index) {
          const clone = cloneWithTemplateData(template, item);
          const childScope = createChildScope(scope, { item, index });
          const itemDisposers = [];
          bindElement(clone, childScope, itemDisposers);
          for (const desc of Array.from(clone.querySelectorAll("*"))) {
            bindElement(desc, childScope, itemDisposers);
          }
          clone.__formaDisposers = itemDisposers;
          return clone;
        }, updateBoundClone2 = function(node, item, index) {
          disposeCloneBindings2(node);
          updateTemplateData(node, item);
          const childScope = createChildScope(scope, { item, index });
          const itemDisposers = [];
          bindElement(node, childScope, itemDisposers);
          for (const desc of Array.from(node.querySelectorAll("*"))) {
            bindElement(desc, childScope, itemDisposers);
          }
          node.__formaDisposers = itemDisposers;
        };
        var disposeCloneBindings = disposeCloneBindings2, createBoundClone = createBoundClone2, updateBoundClone = updateBoundClone2;
        const template = templateEl.cloneNode(true);
        el.removeChild(templateEl);
        const keyAttr = template.getAttribute("data-key");
        const keyProp = keyAttr ? keyAttr.replace(RE_STRIP_ITEM_BRACES, "").trim() : null;
        const listTransition = parseTransitionSpec(el);
        let oldItems = [];
        let oldNodes = [];
        const listHooks = listTransition ? {
          onInsert: (node) => {
            const htmlEl = node;
            if (!htmlEl.setAttribute) return;
            const state = getTransitionState(htmlEl);
            state.token += 1;
            const token = state.token;
            if (state.cancel) state.cancel();
            state.cancel = runTransitionPhase(
              htmlEl,
              {
                base: listTransition.enter,
                from: listTransition.enterFrom,
                to: listTransition.enterTo,
                durationMs: listTransition.enterDurationMs
              },
              () => {
                const current = getTransitionState(htmlEl);
                if (current.token === token) current.cancel = null;
              }
            );
          },
          onBeforeRemove: (node, done) => {
            const htmlEl = node;
            if (!htmlEl.setAttribute) {
              done();
              return;
            }
            disposeCloneBindings2(node);
            transitionRemove(htmlEl, listTransition, () => {
              done();
            });
          }
        } : void 0;
        const dispose = internalEffect(() => {
          const rawItems = evaluate();
          if (!Array.isArray(rawItems)) {
            for (const n of oldNodes) {
              disposeCloneBindings2(n);
              el.removeChild(n);
            }
            oldItems = [];
            oldNodes = [];
            return;
          }
          if (listTransition) {
            const leavingNodes = el.querySelectorAll("[data-forma-leaving]");
            for (const ln of Array.from(leavingNodes)) {
              clearTransitionState(ln);
              ln.removeAttribute("data-forma-leaving");
              if (ln.parentNode) ln.parentNode.removeChild(ln);
            }
          }
          const prevNodes = new Set(oldNodes);
          if (keyProp) {
            const result = reconcileList(
              el,
              oldItems,
              rawItems,
              oldNodes,
              (item) => String(item?.[keyProp] ?? ""),
              (item) => {
                const idx = rawItems.indexOf(item);
                return createBoundClone2(item, idx);
              },
              (node, item) => {
                const idx = rawItems.indexOf(item);
                updateBoundClone2(node, item, idx);
              },
              void 0,
              // beforeNode
              listHooks
            );
            const nextNodes = new Set(result.nodes);
            for (const n of prevNodes) {
              if (!nextNodes.has(n)) {
                if (n.hasAttribute?.("data-forma-leaving")) continue;
                disposeCloneBindings2(n);
              }
            }
            oldItems = result.items;
            oldNodes = result.nodes;
          } else {
            const wrapped = rawItems.map((item, i) => ({ __idx: i, __item: item }));
            const oldWrapped = oldItems;
            const result = reconcileList(
              el,
              oldWrapped,
              wrapped,
              oldNodes,
              (w) => w.__idx,
              (w) => createBoundClone2(w.__item, w.__idx),
              (node, w) => updateBoundClone2(node, w.__item, w.__idx),
              void 0,
              // beforeNode
              listHooks
            );
            const nextNodes = new Set(result.nodes);
            for (const n of prevNodes) {
              if (!nextNodes.has(n)) {
                if (n.hasAttribute?.("data-forma-leaving")) continue;
                disposeCloneBindings2(n);
              }
            }
            oldItems = result.items;
            oldNodes = result.nodes;
          }
        });
        disposers.push(dispose);
      }
    }
    const fetchExpr = !known || known.has("data-fetch") ? el.getAttribute("data-fetch") : null;
    if (fetchExpr) {
      const arrowMatch = fetchExpr.match(RE_FETCH);
      if (arrowMatch) {
        const urlPart = arrowMatch[1].trim();
        const target = arrowMatch[2].trim();
        const modifiers = arrowMatch[3]?.trim() ?? "";
        let method = "GET";
        let url = urlPart;
        const methodMatch = urlPart.match(RE_FETCH_METHOD);
        if (methodMatch) {
          method = methodMatch[1].toUpperCase();
          url = methodMatch[2].trim();
        }
        let loadingTarget;
        let errorTarget;
        let interval;
        for (const mod of modifiers.split("|").filter(Boolean)) {
          const [k, v] = mod.split(":").map((s) => s.trim());
          if (k === "loading") loadingTarget = v;
          else if (k === "error") errorTarget = v;
          else if (k === "poll") interval = parseInt(v ?? "0", 10);
        }
        const [getTarget, setTarget] = createSignal(null);
        scope.getters[target] = getTarget;
        scope.setters[target] = setTarget;
        if (loadingTarget) {
          const [gl, sl] = createSignal(false);
          scope.getters[loadingTarget] = gl;
          scope.setters[loadingTarget] = sl;
        }
        if (errorTarget) {
          const [ge, se] = createSignal(null);
          scope.getters[errorTarget] = ge;
          scope.setters[errorTarget] = se;
        }
        const doFetch = () => {
          if (loadingTarget) scope.setters[loadingTarget](true);
          fetch(url, { method }).then((r) => r.json()).then((data) => {
            setTarget(data);
            if (loadingTarget) scope.setters[loadingTarget](false);
          }).catch((err) => {
            if (errorTarget) scope.setters[errorTarget](err.message);
            if (loadingTarget) scope.setters[loadingTarget](false);
          });
        };
        const fetchId = el.getAttribute("data-fetch-id");
        if (fetchId) {
          _refetchRegistry.set(fetchId, doFetch);
          disposers.push(() => _refetchRegistry.delete(fetchId));
        }
        doFetch();
        if (interval && interval > 0) {
          const id = setInterval(doFetch, interval);
          disposers.push(() => clearInterval(id));
        }
      }
    }
  }
  var DIRECTIVE_SELECTOR = [
    "[data-text]",
    "[data-show]",
    "[data-if]",
    "[data-model]",
    "[data-computed]",
    "[data-persist]",
    "[data-list]",
    "[data-fetch]",
    "[data-bind\\:*]",
    "[data-class\\:*]",
    "[data-on\\:*]",
    // Catch-all for colon-prefixed data attrs that the escaped selectors miss in some engines
    "[data-transition]"
  ].join(",");
  function hasDirective(el) {
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const name = attrs[i].name;
      if (name.startsWith("data-text") || name.startsWith("data-show") || name.startsWith("data-if") || name.startsWith("data-model") || name.startsWith("data-computed") || name.startsWith("data-persist") || name.startsWith("data-list") || name.startsWith("data-fetch") || name.startsWith("data-on:") || name.startsWith("data-class:") || name.startsWith("data-bind:") || name.startsWith("data-transition")) {
        return true;
      }
    }
    return false;
  }
  var _directiveMap = null;
  function setDirectiveMap(map) {
    if (!map || Object.keys(map).length === 0) {
      _directiveMap = null;
      return;
    }
    _directiveMap = /* @__PURE__ */ new Map();
    for (const id in map) {
      _directiveMap.set(id, new Set(map[id]));
    }
  }
  function buildDirectiveSelector() {
    if (!_directiveMap || _directiveMap.size === 0) return null;
    if (_directiveMap.size > 200) return null;
    const parts = [];
    for (const id of _directiveMap.keys()) {
      parts.push(`[data-forma-id="${id}"]`);
    }
    return parts.join(",");
  }
  function getDirectives(el) {
    if (!_directiveMap) return null;
    const id = el.getAttribute("data-forma-id");
    if (!id) return null;
    return _directiveMap.get(id) ?? null;
  }
  function hasAnyPrefix(set, ...prefixes) {
    for (const entry of set) {
      for (const prefix of prefixes) {
        if (entry.startsWith(prefix)) return true;
      }
    }
    return false;
  }
  function mountScope(root) {
    if (root.__formaDisposers) {
      if (_debug) dbg("mountScope: SKIPPED (already mounted)");
      return;
    }
    const scope = initScope(root);
    const disposers = [];
    const refsMap = /* @__PURE__ */ new Map();
    const refEls = root.querySelectorAll("[data-ref]");
    for (let i = 0; i < refEls.length; i++) {
      const el = refEls[i];
      const name = el.getAttribute("data-ref");
      if (name) refsMap.set(name, el);
    }
    const rootRefName = root.getAttribute("data-ref");
    if (rootRefName) refsMap.set(rootRefName, root);
    scope.getters["$refs"] = () => new Proxy({}, {
      get(_, name) {
        return refsMap.get(name) ?? void 0;
      },
      has(_, name) {
        return refsMap.has(name);
      }
    });
    bindElement(root, scope, disposers);
    let boundCount = 0;
    const selector = buildDirectiveSelector();
    if (selector) {
      const targets = root.querySelectorAll(selector);
      for (let i = 0; i < targets.length; i++) {
        bindElement(targets[i], scope, disposers);
        boundCount++;
      }
    } else {
      const descendants = root.querySelectorAll("*");
      for (let i = 0; i < descendants.length; i++) {
        const el = descendants[i];
        if (hasDirective(el)) {
          bindElement(el, scope, disposers);
          boundCount++;
        }
      }
    }
    root.__formaDisposers = disposers;
    root.__formaScope = scope;
    root.__formaInitialState = root.getAttribute("data-forma-state") ?? "{}";
    if (_debug) dbg("mountScope: DONE \u2014", boundCount, "elements bound,", disposers.length, "disposers", selector ? "(targeted)" : "(full scan)");
  }
  function unmountScope(root) {
    const disposers = root.__formaDisposers;
    if (disposers) {
      for (const d of disposers) {
        try {
          d();
        } catch {
        }
      }
      delete root.__formaDisposers;
      delete root.__formaScope;
      delete root.__formaInitialState;
    }
  }
  var _observer = null;
  var ELEMENT_NODE = 1;
  var MUTATION_CHUNK_SIZE = 40;
  var _pendingMutations = [];
  var _drainingMutations = false;
  function processMutation(mutation) {
    for (let i = 0; i < mutation.removedNodes.length; i++) {
      const node = mutation.removedNodes[i];
      if (node.nodeType !== ELEMENT_NODE) continue;
      const el = node;
      if (el.hasAttribute("data-forma-state")) {
        if (_debug) dbg("MutationObserver: REMOVED scope");
        unmountScope(el);
      }
      const removed = el.querySelectorAll("[data-forma-state]");
      for (let j = 0; j < removed.length; j++) {
        unmountScope(removed[j]);
      }
    }
    for (let i = 0; i < mutation.addedNodes.length; i++) {
      const node = mutation.addedNodes[i];
      if (node.nodeType !== ELEMENT_NODE) continue;
      const el = node;
      if (el.closest("[data-forma-leaving]")) continue;
      if (el.hasAttribute("data-forma-state")) {
        if (_debug) dbg("MutationObserver: ADDED scope via mutation");
        mountScope(el);
      }
      const added = el.querySelectorAll("[data-forma-state]");
      if (_debug && added.length > 0) {
        dbg("MutationObserver: found", added.length, "nested scope(s) in added subtree");
      }
      for (let j = 0; j < added.length; j++) {
        const desc = added[j];
        if (desc.closest("[data-forma-leaving]")) continue;
        mountScope(desc);
      }
    }
    if (mutation.type === "attributes" && mutation.attributeName === "data-forma-state") {
      const target = mutation.target;
      unmountScope(target);
      if (target.hasAttribute("data-forma-state")) {
        mountScope(target);
      }
    }
  }
  async function drainMutationQueue() {
    try {
      while (_pendingMutations.length > 0) {
        const batch2 = _pendingMutations.splice(0, MUTATION_CHUNK_SIZE);
        for (let i = 0; i < batch2.length; i++) {
          processMutation(batch2[i]);
        }
        if (_pendingMutations.length > 0) {
          await yieldToMain();
        }
      }
    } finally {
      _drainingMutations = false;
      if (_pendingMutations.length > 0 && !_drainingMutations) {
        _drainingMutations = true;
        void drainMutationQueue();
      }
    }
  }
  function handleMutations(mutations) {
    if (_debug) dbg("MutationObserver: queued", mutations.length, "mutation(s)");
    _pendingMutations.push(...mutations);
    if (_drainingMutations) return;
    _drainingMutations = true;
    void drainMutationQueue();
  }
  function startObserver() {
    if (_observer) return;
    _observer = new MutationObserver(handleMutations);
    const target = document.body || document.documentElement;
    if (target) {
      _observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-forma-state"]
      });
    }
  }
  function stopObserver() {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }
  }
  function initRuntime() {
    if (_autoContainment) {
      applyContainmentHints(document, { skipIfAlreadySet: true });
    }
    const stateRoots = document.querySelectorAll("[data-forma-state]");
    if (_debug) dbg("initRuntime: found", stateRoots.length, "scope(s)");
    for (const root of Array.from(stateRoots)) {
      mountScope(root);
    }
    startObserver();
    if (_debug) dbg("initRuntime: MutationObserver started");
  }
  function destroyRuntime() {
    stopObserver();
    const stateRoots = document.querySelectorAll("[data-forma-state]");
    for (const root of Array.from(stateRoots)) {
      unmountScope(root);
    }
  }
  function mount(el) {
    if (el.hasAttribute("data-forma-state")) {
      mountScope(el);
    }
    const descendants = el.querySelectorAll("[data-forma-state]");
    for (const desc of Array.from(descendants)) {
      mountScope(desc);
    }
  }
  function unmount(el) {
    if (el.hasAttribute("data-forma-state")) {
      unmountScope(el);
    }
    const descendants = el.querySelectorAll("[data-forma-state]");
    for (const desc of Array.from(descendants)) {
      unmountScope(desc);
    }
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initRuntime);
    } else {
      initRuntime();
    }
  }
  function setDebug(on) {
    _debug = on;
  }
  function setUnsafeEvalMode(mode) {
    if (_unsafeEvalMode === mode) return;
    _unsafeEvalMode = mode;
    if (mode === "locked-off") _allowUnsafeEval = false;
    if (mode === "locked-on") _allowUnsafeEval = true;
    if (mode === "mutable") _allowUnsafeEval = true;
    scopeExpressionCache = /* @__PURE__ */ new WeakMap();
    scopeHandlerCache = /* @__PURE__ */ new WeakMap();
  }
  function setUnsafeEval(on) {
    if (_unsafeEvalMode !== "mutable") {
      dbg(
        `setUnsafeEval ignored (mode=${_unsafeEvalMode}); unsafe fallback is locked`
      );
      return;
    }
    if (_allowUnsafeEval === on) return;
    _allowUnsafeEval = on;
    scopeExpressionCache = /* @__PURE__ */ new WeakMap();
    scopeHandlerCache = /* @__PURE__ */ new WeakMap();
  }
  function getUnsafeEvalMode() {
    return _unsafeEvalMode;
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
    const roots = document.querySelectorAll("[data-forma-state]");
    const result = [];
    for (const root of Array.from(roots)) {
      if (root.closest("[data-forma-leaving]")) continue;
      const scope = root.__formaScope;
      const initialJSON = root.__formaInitialState;
      if (!scope) continue;
      const values = {};
      for (const key of Object.keys(scope.getters)) {
        const val = scope.getters[key]();
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
    const scope = element.__formaScope;
    if (!scope?.setters[key]) return;
    batch(() => {
      scope.setters[key](value2);
    });
  }
  function resetScope(element) {
    const scope = element.__formaScope;
    const initialJSON = element.__formaInitialState;
    if (!scope || !initialJSON) return;
    const initial = parseState(initialJSON);
    batch(() => {
      for (const [key, val] of Object.entries(initial)) {
        scope.setters[key]?.(val);
      }
    });
  }
  var _reconciler = null;
  function getReconciler() {
    if (!_reconciler) {
      _reconciler = createReconciler({
        mountScope,
        unmountScope,
        disconnectObserver() {
          if (_observer) {
            _observer.disconnect();
          }
        },
        reconnectObserver() {
          if (_observer) {
            const target = document.body || document.documentElement;
            if (target) {
              _observer.observe(target, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["data-forma-state"]
              });
            }
          }
        },
        batch
      });
    }
    return _reconciler;
  }
  function reconcile(container, html) {
    getReconciler()(container, html);
  }
  return __toCommonJS(runtime_exports);
})();
//# sourceMappingURL=formajs-runtime.global.js.map
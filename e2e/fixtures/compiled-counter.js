import { createEffect as _$createEffect } from "formajs";
import { template as _$template } from "formajs";
import { h, createSignal } from 'formajs';
const _tmpl$0 = _$template("<div id=\"compiled-counter\"><span id=\"compiled-count\"><!></span><button id=\"compiled-btn\">Compiled +1</button></div>");
export function CompiledCounter() {
  const [count, setCount] = createSignal(0);
  return (() => {
    const _root$0 = _tmpl$0.cloneNode(true);
    const _el$1 = _root$0.firstChild.firstChild;
    const _el$2 = _root$0.firstChild.nextSibling;
    const _t$3 = document.createTextNode("");
    _el$1.replaceWith(_t$3);
    _$createEffect(() => {
      _t$3.textContent = (() => String(count()))();
    });
    _el$2.addEventListener("click", () => setCount(c => c + 1));
    return _root$0;
  })();
}
/**
 * Render an emitted FMIR module to the HTML a server would send, using the
 * slot table's OWN defaults — i.e. `SlotData::new_from_defaults` semantics.
 *
 * ## Why a renderer lives in this test suite
 *
 * Slot names and default bytes are the MECHANISM. The property that matters is
 * the markup: does the page the server sends match the page the client builds?
 * Every defect this file exists to catch was invisible at the slot level — a
 * missing default reads as "no default", which is a perfectly well-formed slot
 * table, and only becomes a blank text node, a missing class or the wrong
 * `SHOW_IF` branch once something renders it.
 *
 * ## What this is NOT
 *
 * It is not a second implementation the emitter is checked against — that would
 * share the emitter's blind spots by construction, which is the whole reason
 * the cross-implementation corpus exists. The AUTHORITY on how FMIR renders is
 * `forma/crates/forma-ir/src/walker.rs`, exercised over these same fixtures by
 * `crates/forma-ir/tests/js_emitter_contract.rs` (its `@page defaults` section
 * is this same render, produced by the real consumer, pinned to a committed
 * golden). This renderer only lets a compiler-side test state its expectation
 * in markup instead of in slot indices, and it deliberately covers ONLY the
 * opcodes it can render exactly — anything else throws rather than approximates.
 */

import { getSlots, readSections, readStringTable, readU16LE, readU32LE, type Slot } from './fmir';

const OP_OPEN_TAG     = 0x01;
const OP_CLOSE_TAG    = 0x02;
const OP_VOID_TAG     = 0x03;
const OP_TEXT         = 0x04;
const OP_DYN_TEXT     = 0x05;
const OP_DYN_ATTR     = 0x06;
const OP_SHOW_IF      = 0x07;
const OP_SHOW_ELSE    = 0x08;

const TYPE_BOOL = 0x02;

/** U+200B, written as an escape so it survives any editor that strips
 *  invisible characters. The walkers emit it for an empty DYN_TEXT so the
 *  browser creates a Text node for the client to bind its effect to. */
export const ZWSP = '\u200B';

/** The value a slot holds when nothing has been injected: its own default. */
type SlotValue = { kind: 'null' } | { kind: 'bool'; value: boolean } | { kind: 'text'; value: string };

function defaultValue(slot: Slot): SlotValue {
  // Empty default bytes mean "no default": the reader leaves the slot Null.
  if (slot.default === '') return { kind: 'null' };
  if (slot.typeHint === TYPE_BOOL) {
    if (slot.default === 'true') return { kind: 'bool', value: true };
    if (slot.default === 'false') return { kind: 'bool', value: false };
    return { kind: 'null' };
  }
  return { kind: 'text', value: slot.default };
}

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface RenderOptions {
  /** Drop the `<!--f:tN-->` / `<!--f:sN-->` hydration markers from the output.
   *  They are wire contract, not content; a test about WHAT the page shows
   *  reads better without them. */
  stripMarkers?: boolean;
}

/**
 * Render `binary` under its own slot defaults.
 *
 * Throws on any opcode outside the subset this renders exactly (LIST, PROP,
 * islands), so a fixture that grows one fails loudly instead of being rendered
 * approximately.
 */
export function renderDefaults(binary: Uint8Array, options: RenderOptions = {}): string {
  const sections = readSections(binary);
  const strings = readStringTable(binary, sections.stringTableOffset);
  const values = new Map<number, SlotValue>(
    getSlots(binary).map((s) => [s.id, defaultValue(s)] as const),
  );
  const code = binary.slice(sections.opcodeOffset, sections.opcodeOffset + sections.opcodeSize);

  let out = '';
  let pendingTagClose = false;

  const str = (idx: number): string => {
    const value = strings[idx];
    if (value === undefined) throw new Error(`string index ${idx} out of range`);
    return value;
  };
  const slotValue = (id: number): SlotValue => values.get(id) ?? { kind: 'null' };
  const marker = (text: string): void => {
    if (!options.stripMarkers) out += text;
  };

  function region(start: number, end: number): void {
    let pos = start;
    while (pos < end) {
      const op = code[pos]!;
      pos += 1;

      // The tag stays open until something other than DYN_ATTR arrives.
      if (pendingTagClose && op !== OP_DYN_ATTR) {
        out += '>';
        pendingTagClose = false;
      }

      switch (op) {
        case OP_OPEN_TAG:
        case OP_VOID_TAG: {
          const tag = str(readU32LE(code, pos));
          const attrCount = readU16LE(code, pos + 4);
          let p = pos + 6;
          out += `<${tag}`;
          for (let i = 0; i < attrCount; i++) {
            const key = str(readU32LE(code, p));
            const val = str(readU32LE(code, p + 4));
            // A static attribute with an empty value keeps the bare name.
            out += val === '' ? ` ${key}` : ` ${key}="${escapeAttr(val)}"`;
            p += 8;
          }
          pendingTagClose = true;
          pos = p;
          break;
        }
        case OP_CLOSE_TAG:
          out += `</${str(readU32LE(code, pos))}>`;
          pos += 4;
          break;
        case OP_TEXT:
          out += escapeText(str(readU32LE(code, pos)));
          pos += 4;
          break;
        case OP_DYN_TEXT: {
          const value = slotValue(readU16LE(code, pos));
          const markerId = readU16LE(code, pos + 2);
          pos += 4;
          const text = value.kind === 'null' ? '' : String(value.value);
          marker(`<!--f:t${markerId}-->`);
          out += text === '' ? ZWSP : escapeText(text);
          marker(`<!--/f:t${markerId}-->`);
          break;
        }
        case OP_DYN_ATTR: {
          const key = str(readU32LE(code, pos));
          const value = slotValue(readU16LE(code, pos + 4));
          pos += 6;
          if (!pendingTagClose) break;
          // An HTML boolean attribute is ON whenever it is present: absent for
          // false/null, bare for true. An empty string is a VALUE (`value=""`),
          // not an absence.
          if (value.kind === 'null') break;
          if (value.kind === 'bool') {
            if (value.value) out += ` ${key}`;
            break;
          }
          out += ` ${key}="${escapeAttr(value.value)}"`;
          break;
        }
        case OP_SHOW_IF: {
          const slotId = readU16LE(code, pos);
          const thenLen = readU32LE(code, pos + 2);
          const elseLen = readU32LE(code, pos + 6);
          pos += 10;
          const value = slotValue(slotId);
          // Null is false: a slot with no default renders the ELSE branch.
          const condition = value.kind === 'bool' ? value.value
            : value.kind === 'text' ? value.value !== ''
            : false;

          const thenStart = pos;
          const thenEnd = thenStart + thenLen;
          if (code[thenEnd] !== OP_SHOW_ELSE) {
            throw new Error(`SHOW_IF then_len=${thenLen} does not end at SHOW_ELSE`);
          }
          const elseStart = thenEnd + 1;
          const elseEnd = elseStart + elseLen;

          marker(`<!--f:s${slotId}-->`);
          if (condition) region(thenStart, thenEnd);
          else region(elseStart, elseEnd);
          // The closing marker is written WITHOUT flushing a pending tag, the
          // same as walker.rs — a branch ending in a void element leaves its
          // `>` for the next opcode on both sides.
          marker(`<!--/f:s${slotId}-->`);
          pos = elseEnd;
          break;
        }
        default:
          throw new Error(
            `renderDefaults does not render opcode 0x${op.toString(16).padStart(2, '0')} — `
            + 'add it here (matching forma-ir/src/walker.rs) or keep it out of this fixture',
          );
      }
    }
    if (pos !== end) throw new Error(`opcode region [${start}, ${end}) ended mid-instruction at ${pos}`);
  }

  region(0, code.length);
  if (pendingTagClose) out += '>';
  return out;
}

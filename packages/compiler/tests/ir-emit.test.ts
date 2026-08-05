/**
 * IrEmitContext tests — the FMIR binary buffer itself.
 *
 * AST → opcode translation is covered by ir-walk.test.ts against the live
 * walker. This file covers only what IrEmitContext owns: string interning,
 * slot and island registration, the slot-id capture stack, and the binary
 * layout it serializes.
 */
import { describe, it, expect } from 'vitest';
import { IrEmitContext } from '../src/ir-emit';
import {
  assertBinaryInvariants,
  getIslands,
  getSlots,
  getStrings,
  parseOpcodeList,
  readSections,
  readU16LE,
} from './helpers/fmir';

/** Emit a minimal well-formed `<div></div>` so toBinary() has a bytecode section. */
function emitDiv(ctx: IrEmitContext): void {
  const divIdx = ctx.addString('div');
  ctx.emit(0x01); // OPEN_TAG
  ctx.emitU32(divIdx);
  ctx.emitU16(0);
  ctx.emit(0x02); // CLOSE_TAG
  ctx.emitU32(divIdx);
}

describe('IrEmitContext string interning', () => {
  it('returns the same index for a repeated string and stores it once', () => {
    const ctx = new IrEmitContext();

    expect(ctx.addString('div')).toBe(0);
    expect(ctx.addString('class')).toBe(1);
    expect(ctx.addString('div')).toBe(0);
    expect(ctx.addString('class')).toBe(1);
    expect(ctx.addString('')).toBe(2);

    ctx.emit(0x04); // TEXT
    ctx.emitU32(0);

    expect(getStrings(ctx.toBinary())).toEqual(['div', 'class', '']);
  });

  it('round-trips non-ASCII strings through the UTF-8 table', () => {
    const ctx = new IrEmitContext();
    ctx.addString('café ☕');
    ctx.emit(0x04);
    ctx.emitU32(0);

    const binary = ctx.toBinary();
    expect(getStrings(binary)).toEqual(['café ☕']);
    // The u16 length prefix counts BYTES, not code points.
    const strOffset = readSections(binary).stringTableOffset;
    expect(readU16LE(binary, strOffset + 4)).toBe(new TextEncoder().encode('café ☕').length);
  });
});

describe('IrEmitContext binary layout', () => {
  it('emits the v2 header', () => {
    const ctx = new IrEmitContext();
    emitDiv(ctx);
    const binary = ctx.toBinary();

    expect(Array.from(binary.slice(0, 4))).toEqual([0x46, 0x4d, 0x49, 0x52]); // 'FMIR'
    expect(readU16LE(binary, 4)).toBe(2); // version
    expect(readU16LE(binary, 6)).toBe(0); // flags
  });

  it('writes little-endian integers and back-patches in place', () => {
    const ctx = new IrEmitContext();
    ctx.emitU16(0x1234);
    const patchPos = ctx.opcodeLen();
    ctx.emitU32(0);
    ctx.emitU32(0xdeadbeef);
    expect(ctx.opcodeLen()).toBe(2 + 4 + 4);

    ctx.patchU32(patchPos, 0x01020304);

    const binary = ctx.toBinary();
    const { opcodeOffset } = readSections(binary);
    expect(Array.from(binary.slice(opcodeOffset, opcodeOffset + 10))).toEqual([
      0x34, 0x12,
      0x04, 0x03, 0x02, 0x01,
      0xef, 0xbe, 0xad, 0xde,
    ]);
  });

  it('hands out marker and island ids without gaps', () => {
    const ctx = new IrEmitContext();

    expect([ctx.nextMarker(), ctx.nextMarker(), ctx.nextMarker()]).toEqual([0, 1, 2]);

    expect(ctx.peekNextIslandId()).toBe(0);
    expect(ctx.addIsland('First', 0x01, 0x01, [], 0)).toBe(0);
    // peek must NOT consume — emitIsland relies on it for fallback naming.
    expect(ctx.peekNextIslandId()).toBe(1);
    expect(ctx.peekNextIslandId()).toBe(1);
    expect(ctx.addIsland('Second', 0x01, 0x01, [], 3)).toBe(1);
  });
});

describe('IrEmitContext slot table', () => {
  it('encodes id, name, type hint, source and default bytes', () => {
    const ctx = new IrEmitContext();
    expect(ctx.addSlot('submitting', 0x02, 0x01, new TextEncoder().encode('false'))).toBe(0);
    expect(ctx.addSlot('list:rows:array', 0x04, 0x00)).toBe(1);
    emitDiv(ctx);

    expect(getSlots(ctx.toBinary())).toMatchObject([
      { id: 0, name: 'submitting', typeHint: 0x02, source: 0x01, default: 'false' },
      { id: 1, name: 'list:rows:array', typeHint: 0x04, source: 0x00, default: '' },
    ]);
  });

  it('defaults source to client (0x01) and the default bytes to empty', () => {
    const ctx = new IrEmitContext();
    ctx.addSlot('myslot', 0x01);
    emitDiv(ctx);

    expect(getSlots(ctx.toBinary())).toMatchObject([
      { id: 0, name: 'myslot', typeHint: 0x01, source: 0x01, default: '' },
    ]);
  });

  it('interns slot names into the string table when serializing', () => {
    const ctx = new IrEmitContext();
    ctx.addSlot('attr:class', 0x01);
    emitDiv(ctx);
    const binary = ctx.toBinary();

    // Slot names are interned during encodeSlotTable, after the walk, so they
    // land at the END of the table — and exactly once each.
    expect(getStrings(binary)).toEqual(['div', 'attr:class']);
    expect(getSlots(binary)[0]!.nameIdx).toBe(1);
  });
});

describe('IrEmitContext island slot capture', () => {
  it('captures slots created inside a capture window, sorted ascending', () => {
    const ctx = new IrEmitContext();
    ctx.addSlot('outside-before', 0x01);
    ctx.beginSlotCapture();
    const inner = ctx.addSlot('inside', 0x01);
    ctx.beginSlotCapture();
    const deepest = ctx.addSlot('deeper', 0x01);
    const nested = ctx.endSlotCapture();
    const outer = ctx.endSlotCapture();
    ctx.addSlot('outside-after', 0x01);

    expect(nested).toEqual([deepest]);
    // An outer island's span also owns the slots of islands nested inside it.
    expect(outer).toEqual([inner, deepest]);
  });

  it('records a reused pre-existing slot into every open capture', () => {
    const ctx = new IrEmitContext();
    const preRegistered = ctx.addSlot('count', 0x01);

    ctx.beginSlotCapture();
    ctx.recordSlotRef(preRegistered); // what DYN_TEXT does for a signal slot
    expect(ctx.endSlotCapture()).toEqual([preRegistered]);
  });

  it('returns an empty capture when the stack is empty', () => {
    expect(new IrEmitContext().endSlotCapture()).toEqual([]);
  });

  it('drops per-item list scratch slots from an island entry', () => {
    const ctx = new IrEmitContext();
    const arraySlot = ctx.addSlot('list:rows:array', 0x04, 0x00);
    const itemSlot = ctx.addSlot('list:rows:item', 0x05, 0x00);
    const propSlot = ctx.addSlot('list:rows:name', 0x01, 0x00);
    const attrSlot = ctx.addSlot('attr:class', 0x01);
    const id = ctx.addIsland('RowsIsland', 0x01, 0x01, [], 0);
    emitDiv(ctx);

    ctx.setIslandSlotIds(id, [arraySlot, itemSlot, propSlot, attrSlot]);

    // `list:rows:item` holds the LAST rendered row after SSR — serializing it
    // into data-forma-props would leak that row into the page.
    expect(getIslands(ctx.toBinary())[0]!.slotIds).toEqual([arraySlot, propSlot, attrSlot]);
  });

  it('drops the scratch slot of a name-deduped list too', () => {
    // The second list over the same source is based `todos#2`, so its scratch
    // slot is `list:todos#2:item`. The exclusion pattern must still match it —
    // `#` is not a `:`, but a pattern anchored on the wrong segment would miss.
    const ctx = new IrEmitContext();
    const arraySlot = ctx.addSlot('list:todos#2:array', 0x04, 0x00);
    const itemSlot = ctx.addSlot('list:todos#2:item', 0x05, 0x00);
    const id = ctx.addIsland('TodosIsland', 0x01, 0x01, [], 0);
    emitDiv(ctx);

    ctx.setIslandSlotIds(id, [arraySlot, itemSlot]);

    expect(getIslands(ctx.toBinary())[0]!.slotIds).toEqual([arraySlot]);
  });

  it('ignores setIslandSlotIds for an unregistered island id', () => {
    const ctx = new IrEmitContext();
    const id = ctx.addIsland('Only', 0x01, 0x01, [7], 0);
    emitDiv(ctx);

    ctx.setIslandSlotIds(id + 1, [1, 2, 3]);

    expect(getIslands(ctx.toBinary())).toMatchObject([{ id, name: 'Only', slotIds: [7] }]);
  });
});

describe('IrEmitContext island table', () => {
  it('encodes trigger, props mode, byte offset and slot ids', () => {
    const ctx = new IrEmitContext();
    ctx.emit(0x0b); // ISLAND_START
    ctx.emitU16(0);
    const divIdx = ctx.addString('div');
    ctx.emit(0x01); ctx.emitU32(divIdx); ctx.emitU16(0);
    ctx.emit(0x02); ctx.emitU32(divIdx);
    ctx.emit(0x0c); // ISLAND_END
    ctx.emitU16(0);
    ctx.addIsland('FormIsland', 0x01, 0x01, [4, 9], 0);

    const binary = ctx.toBinary();

    expect(getIslands(binary)).toEqual([{
      id: 0,
      name: 'FormIsland',
      nameIdx: 1,
      trigger: 0x01,
      propsMode: 0x01,
      byteOffset: 0,
      slotIds: [4, 9],
    }]);
    expect(parseOpcodeList(binary)).toEqual([
      'ISLAND_START FormIsland#0',
      'OPEN_TAG div',
      'CLOSE_TAG div',
      'ISLAND_END FormIsland#0',
    ]);
  });

  it('exposes the same island metadata through getIslands() as the binary table', () => {
    const ctx = new IrEmitContext();
    ctx.addIsland('Alpha', 0x01, 0x01, [0], 0);
    ctx.addIsland('Beta', 0x02, 0x01, [], 7);
    emitDiv(ctx);

    const binary = ctx.toBinary();
    expect(ctx.getIslands()).toEqual(
      getIslands(binary).map(({ id, name, trigger, propsMode, slotIds }) =>
        ({ id, name, trigger, propsMode, slotIds })),
    );
  });
});

// ---------------------------------------------------------------------------
// u16 length guards — string table and slot defaults
// ---------------------------------------------------------------------------
// Both tables prefix variable-length payloads with a u16. Without a guard,
// setUint16 silently wraps for payloads over 65535 bytes and desynchronizes
// the whole table for the Rust parser — corrupt output must be impossible.

describe('u16 length guards', () => {
  it('toBinary throws a descriptive error for a string over 65535 UTF-8 bytes', () => {
    const ctx = new IrEmitContext();
    ctx.addString('x'.repeat(0x10000));
    expect(() => ctx.toBinary()).toThrow(/65535-byte u16 length limit/);
  });

  it('counts UTF-8 bytes, not code units, against the string limit', () => {
    const ctx = new IrEmitContext();
    // 33000 three-byte characters = 99000 bytes from a 33000-unit string.
    ctx.addString('☕'.repeat(33000));
    expect(() => ctx.toBinary()).toThrow(/65535-byte u16 length limit/);
  });

  it('toBinary throws a descriptive error for a slot default over 65535 bytes', () => {
    const ctx = new IrEmitContext();
    ctx.addSlot('attr:d', 0x01, 0x01, new Uint8Array(0x10000));
    expect(() => ctx.toBinary()).toThrow(/slot 'attr:d'/);
  });

  it('accepts a string of exactly 65535 bytes', () => {
    const ctx = new IrEmitContext();
    const longest = 'x'.repeat(0xffff);
    ctx.addString(longest);
    ctx.emit(0x04); // TEXT
    ctx.emitU32(0);

    const binary = ctx.toBinary();
    expect(getStrings(binary)).toEqual([longest]);
    assertBinaryInvariants(binary);
  });
});

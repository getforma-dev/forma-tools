/**
 * Shared FMIR binary decoding helpers for the compiler test suite.
 *
 * One decoder, used by every test file that inspects an emitted binary, so a
 * gap closed here closes everywhere. The disassembler is OPERAND-AWARE: it
 * renders every operand of every opcode, resolving string indices through the
 * string table and slot ids through the slot table. Assertions written against
 * it therefore see attribute key/value order, DYN_ATTR slot bindings,
 * SHOW_IF/LIST branch lengths, DYN_TEXT markers and island identity — all of
 * which an opcode-byte list is blind to.
 */
import { expect } from 'vitest';

// ---------------------------------------------------------------------------
// Opcodes (must match src/ir-walk.ts)
// ---------------------------------------------------------------------------

export const OP_OPEN_TAG     = 0x01;
export const OP_CLOSE_TAG    = 0x02;
export const OP_VOID_TAG     = 0x03;
export const OP_TEXT         = 0x04;
export const OP_DYN_TEXT     = 0x05;
export const OP_DYN_ATTR     = 0x06;
export const OP_SHOW_IF      = 0x07;
export const OP_SHOW_ELSE    = 0x08;
export const OP_LIST         = 0x0a;
export const OP_ISLAND_START = 0x0b;
export const OP_ISLAND_END   = 0x0c;
export const OP_PROP         = 0x12;

// ---------------------------------------------------------------------------
// Primitive readers
// ---------------------------------------------------------------------------

export function readU16LE(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

export function readU32LE(data: Uint8Array, offset: number): number {
  return (
    data[offset]!
    | (data[offset + 1]! << 8)
    | (data[offset + 2]! << 16)
    | (data[offset + 3]! << 24)
  ) >>> 0;
}

/** Section table layout: 0=Bytecode(@16), 1=Strings(@24), 2=Slots(@32), 3=Islands(@40). */
export function readSections(data: Uint8Array) {
  return {
    opcodeOffset: readU32LE(data, 16),
    opcodeSize: readU32LE(data, 20),
    stringTableOffset: readU32LE(data, 24),
    stringTableSize: readU32LE(data, 28),
    slotTableOffset: readU32LE(data, 32),
    slotTableSize: readU32LE(data, 36),
    islandTableOffset: readU32LE(data, 40),
    islandTableSize: readU32LE(data, 44),
  };
}

export function readStringTable(data: Uint8Array, offset: number): string[] {
  const count = readU32LE(data, offset);
  const strings: string[] = [];
  let pos = offset + 4;
  for (let i = 0; i < count; i++) {
    const len = readU16LE(data, pos);
    pos += 2;
    strings.push(new TextDecoder().decode(data.slice(pos, pos + len)));
    pos += len;
  }
  return strings;
}

/** The whole string table, in interning order. */
export function getStrings(binary: Uint8Array): string[] {
  return readStringTable(binary, readSections(binary).stringTableOffset);
}

export interface Slot {
  id: number;
  name: string;
  /** String-table index the name is stored under. */
  nameIdx: number;
  typeHint: number;
  source: number;
  /** UTF-8 decoded default bytes ('' when the slot has no SSR default). */
  default: string;
}

/**
 * Decode the slot table.
 * Entry layout: slot_id(u16) + name_str_idx(u32) + type_hint(u8) + source(u8) +
 * default_len(u16) + default_bytes.
 */
export function getSlots(binary: Uint8Array): Slot[] {
  const sections = readSections(binary);
  const strings = readStringTable(binary, sections.stringTableOffset);
  const slots: Slot[] = [];
  let pos = sections.slotTableOffset;
  const count = readU16LE(binary, pos);
  pos += 2;
  for (let i = 0; i < count; i++) {
    const id = readU16LE(binary, pos); pos += 2;
    const nameIdx = readU32LE(binary, pos); pos += 4;
    const typeHint = binary[pos]!; pos += 1;
    const source = binary[pos]!; pos += 1;
    const defaultLen = readU16LE(binary, pos); pos += 2;
    const def = new TextDecoder().decode(binary.slice(pos, pos + defaultLen));
    pos += defaultLen;
    slots.push({ id, name: strings[nameIdx]!, nameIdx, typeHint, source, default: def });
  }
  return slots;
}

/** Slot names in declaration order. */
export function getSlotNames(binary: Uint8Array): string[] {
  return getSlots(binary).map(s => s.name);
}

export interface Island {
  id: number;
  name: string;
  /** String-table index the name is stored under. */
  nameIdx: number;
  trigger: number;
  propsMode: number;
  byteOffset: number;
  slotIds: number[];
}

/**
 * Decode the island table.
 * Entry layout: id(u16) + trigger(u8) + props_mode(u8) + name_str_idx(u32) +
 * byte_offset(u32) + slot_count(u16) + slot_id(u16) * slot_count.
 */
export function getIslands(binary: Uint8Array): Island[] {
  const sections = readSections(binary);
  const strings = readStringTable(binary, sections.stringTableOffset);
  const islands: Island[] = [];
  let pos = sections.islandTableOffset;
  const count = readU16LE(binary, pos);
  pos += 2;
  for (let i = 0; i < count; i++) {
    const id = readU16LE(binary, pos); pos += 2;
    const trigger = binary[pos]!; pos += 1;
    const propsMode = binary[pos]!; pos += 1;
    const nameIdx = readU32LE(binary, pos); pos += 4;
    const byteOffset = readU32LE(binary, pos); pos += 4;
    const slotCount = readU16LE(binary, pos); pos += 2;
    const slotIds: number[] = [];
    for (let s = 0; s < slotCount; s++) {
      slotIds.push(readU16LE(binary, pos));
      pos += 2;
    }
    islands.push({ id, name: strings[nameIdx]!, nameIdx, trigger, propsMode, byteOffset, slotIds });
  }
  return islands;
}

// ---------------------------------------------------------------------------
// Operand-aware disassembler
// ---------------------------------------------------------------------------

interface Disassembly {
  /** One operand-complete line per opcode, in stream order. */
  lines: string[];
  /** Island id → byte offset of its ISLAND_START opcode in the bytecode section. */
  islandStarts: Map<number, number>;
  /** String-table indices referenced by the bytecode. */
  referencedStrings: Set<number>;
}

/**
 * Disassemble the bytecode section of an FMIR binary.
 *
 * Structure is VALIDATED while decoding: SHOW_IF's then_len/else_len and
 * LIST's body_len must each bound a whole number of instructions exactly, and
 * the stream must consume its section exactly. A stale, swapped or truncated
 * length is therefore a hard decode failure, not silent noise.
 */
function disassemble(binary: Uint8Array): Disassembly {
  const sections = readSections(binary);
  const strings = readStringTable(binary, sections.stringTableOffset);
  const slotNameById = new Map(getSlots(binary).map(s => [s.id, s.name]));
  const islandNameById = new Map(getIslands(binary).map(i => [i.id, i.name]));

  const code = binary.slice(
    sections.opcodeOffset,
    sections.opcodeOffset + sections.opcodeSize,
  );

  const lines: string[] = [];
  const islandStarts = new Map<number, number>();
  const referencedStrings = new Set<number>();

  const str = (idx: number): string => {
    referencedStrings.add(idx);
    if (idx >= strings.length) throw new Error(`string index ${idx} out of range`);
    return strings[idx]!;
  };
  const slot = (id: number): string => slotNameById.get(id) ?? `<unregistered slot ${id}>`;
  const island = (id: number): string => `${islandNameById.get(id) ?? '<unregistered>'}#${id}`;

  /** Decode [start, end), requiring the region to end on an instruction boundary. */
  function region(start: number, end: number): void {
    let pos = start;
    while (pos < end) {
      const op = code[pos]!;
      switch (op) {
        case OP_OPEN_TAG:
        case OP_VOID_TAG: {
          const tag = str(readU32LE(code, pos + 1));
          const attrCount = readU16LE(code, pos + 5);
          let p = pos + 7;
          const attrs: string[] = [];
          for (let i = 0; i < attrCount; i++) {
            const key = str(readU32LE(code, p));
            const val = str(readU32LE(code, p + 4));
            attrs.push(`${key}=${JSON.stringify(val)}`);
            p += 8;
          }
          const name = op === OP_OPEN_TAG ? 'OPEN_TAG' : 'VOID_TAG';
          lines.push([name, tag, ...attrs].join(' '));
          pos = p;
          break;
        }
        case OP_CLOSE_TAG:
          lines.push(`CLOSE_TAG ${str(readU32LE(code, pos + 1))}`);
          pos += 5;
          break;
        case OP_TEXT:
          lines.push(`TEXT ${JSON.stringify(str(readU32LE(code, pos + 1)))}`);
          pos += 5;
          break;
        case OP_DYN_TEXT:
          lines.push(
            `DYN_TEXT ${slot(readU16LE(code, pos + 1))} marker=${readU16LE(code, pos + 3)}`,
          );
          pos += 5;
          break;
        case OP_DYN_ATTR:
          lines.push(
            `DYN_ATTR ${str(readU32LE(code, pos + 1))} -> ${slot(readU16LE(code, pos + 5))}`,
          );
          pos += 7;
          break;
        case OP_SHOW_IF: {
          const slotId = readU16LE(code, pos + 1);
          const thenLen = readU32LE(code, pos + 3);
          const elseLen = readU32LE(code, pos + 7);
          lines.push(`SHOW_IF ${slot(slotId)} then=${thenLen} else=${elseLen}`);
          const thenStart = pos + 11;
          region(thenStart, thenStart + thenLen);
          const elsePos = thenStart + thenLen;
          if (code[elsePos] !== OP_SHOW_ELSE) {
            throw new Error(
              `SHOW_IF then_len=${thenLen} does not end at SHOW_ELSE (found 0x${(code[elsePos] ?? -1).toString(16)} at ${elsePos})`,
            );
          }
          lines.push('SHOW_ELSE');
          region(elsePos + 1, elsePos + 1 + elseLen);
          pos = elsePos + 1 + elseLen;
          break;
        }
        case OP_SHOW_ELSE:
          throw new Error(`unbalanced SHOW_ELSE at ${pos} (no enclosing SHOW_IF)`);
        case OP_LIST: {
          const arraySlot = readU16LE(code, pos + 1);
          const itemSlot = readU16LE(code, pos + 3);
          const bodyLen = readU32LE(code, pos + 5);
          lines.push(
            `LIST array=${slot(arraySlot)} item=${slot(itemSlot)} body=${bodyLen}`,
          );
          region(pos + 9, pos + 9 + bodyLen);
          pos = pos + 9 + bodyLen;
          break;
        }
        case OP_PROP: {
          const src = readU16LE(code, pos + 1);
          const propName = str(readU32LE(code, pos + 3));
          const target = readU16LE(code, pos + 7);
          lines.push(`PROP ${slot(src)}.${propName} -> ${slot(target)}`);
          pos += 9;
          break;
        }
        case OP_ISLAND_START: {
          const id = readU16LE(code, pos + 1);
          islandStarts.set(id, pos);
          lines.push(`ISLAND_START ${island(id)}`);
          pos += 3;
          break;
        }
        case OP_ISLAND_END:
          lines.push(`ISLAND_END ${island(readU16LE(code, pos + 1))}`);
          pos += 3;
          break;
        default:
          throw new Error(`unknown opcode 0x${op.toString(16).padStart(2, '0')} at ${pos}`);
      }
    }
    if (pos !== end) {
      throw new Error(`opcode region [${start}, ${end}) ended mid-instruction at ${pos}`);
    }
  }

  region(0, code.length);
  return { lines, islandStarts, referencedStrings };
}

/**
 * Disassemble an FMIR binary into one operand-complete line per opcode.
 *
 * Line formats:
 *   OPEN_TAG div class="hero"      VOID_TAG input type="email"
 *   CLOSE_TAG div                  TEXT "Hello"
 *   DYN_TEXT attr:name marker=0    DYN_ATTR class -> attr:class
 *   SHOW_IF show:visible then=12 else=6                SHOW_ELSE
 *   LIST array=list:todos:array item=list:todos:item body=42
 *   PROP list:todos:item.title -> list:todos:title
 *   ISLAND_START Alert#0           ISLAND_END Alert#0
 */
export function parseOpcodeList(binary: Uint8Array): string[] {
  return disassemble(binary).lines;
}

// ---------------------------------------------------------------------------
// Universal binary invariants
// ---------------------------------------------------------------------------

/**
 * Assert the properties that must hold for EVERY page the compiler emits,
 * whatever it contains. Called from the shared walk helpers, so every test
 * that emits a binary enforces them for free.
 *
 *   1. Slot names are pairwise unique. The Rust loader builds one
 *      HashMap<String, u16> from them (forma/crates/forma-ir/src/slot.rs), so a
 *      duplicate silently makes the earlier slot unreachable for server-side
 *      SlotData injection.
 *   2. Slot ids are pairwise unique and dense from 0 — they are the wire
 *      handles DYN_ATTR/DYN_TEXT/SHOW_IF/LIST/PROP bind to.
 *   3. The string table is interned: no value appears twice.
 *   4. No orphan strings: every entry is reachable from the bytecode, the slot
 *      table or the island table. An unreferenced entry is dead weight in every
 *      response and means an emitter interned something it never used.
 *   5. Each island's recorded byte_offset points exactly at its ISLAND_START —
 *      the Rust walker seeks there to render the island subtree.
 *   6. The bytecode decodes exactly (enforced by disassemble()).
 */
export function assertBinaryInvariants(binary: Uint8Array): void {
  const { islandStarts, referencedStrings } = disassemble(binary);
  const strings = getStrings(binary);
  const slots = getSlots(binary);
  const islands = getIslands(binary);

  const names = slots.map(s => s.name);
  expect(new Set(names).size, `duplicate slot name in [${names.join(', ')}]`).toBe(names.length);

  const ids = slots.map(s => s.id);
  expect(new Set(ids).size, `duplicate slot id in [${ids.join(', ')}]`).toBe(ids.length);
  expect(ids, 'slot ids must be dense and ascending from 0').toEqual(ids.map((_, i) => i));

  expect(new Set(strings).size, `string table is not interned: [${strings.join(', ')}]`)
    .toBe(strings.length);

  // Slot and island names are stored as string indices in their own tables.
  const referenced = new Set(referencedStrings);
  for (const slot of slots) referenced.add(slot.nameIdx);
  for (const island of islands) referenced.add(island.nameIdx);
  const orphans = strings.filter((_, i) => !referenced.has(i));
  expect(orphans, 'string table has entries nothing references').toEqual([]);

  for (const island of islands) {
    expect(
      island.byteOffset,
      `island '${island.name}' byte_offset must point at its own ISLAND_START`,
    ).toBe(islandStarts.get(island.id));
  }
}

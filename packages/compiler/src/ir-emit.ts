/**
 * Forma Compiler - FMIR Binary Emitter
 *
 * Compiles h() call expression subtrees into binary FMIR format (.ir files).
 * The FMIR binary is consumed by the Rust-side walker to produce HTML.
 *
 * Only handles Static and Dynamic subtrees -- Island subtrees stay as
 * client-side JS and are NOT emitted to IR.
 */

import * as t from '@babel/types';
import { VOID_TAGS, isEventProp, isStaticLiteral, isUndefinedIdentifier } from './utils.js';

// ---------------------------------------------------------------------------
// Opcodes
// ---------------------------------------------------------------------------

const OP_OPEN_TAG  = 0x01;
const OP_CLOSE_TAG = 0x02;
const OP_VOID_TAG  = 0x03;
const OP_TEXT      = 0x04;
const OP_DYN_TEXT  = 0x05;
const OP_DYN_ATTR  = 0x06;

// ---------------------------------------------------------------------------
// Slot Type Hints
// ---------------------------------------------------------------------------

const TYPE_TEXT   = 0x01;
// const TYPE_BOOL   = 0x02;
// const TYPE_NUMBER = 0x03;
// const TYPE_ARRAY  = 0x04;
// const TYPE_OBJECT = 0x05;

/** Convert a static literal to its string representation for an attribute value. */
function staticLiteralToAttrString(expr: t.Expression): string | null {
  if (t.isStringLiteral(expr)) return expr.value;
  if (t.isNumericLiteral(expr)) return String(expr.value);
  if (t.isBooleanLiteral(expr)) return expr.value ? '' : null;
  if (t.isNullLiteral(expr)) return null;
  return null;
}

// ---------------------------------------------------------------------------
// IrEmitContext
// ---------------------------------------------------------------------------

export class IrEmitContext {
  /** String interning map: string -> index */
  private stringMap: Map<string, number> = new Map();
  /** Interned strings in order */
  private strings: string[] = [];

  /** Slot tracking */
  private slots: Array<{ id: number; name: string; typeHint: number; source: number; defaultBytes: Uint8Array }> = [];
  private nextSlotId: number = 0;

  /** Opcode buffer */
  private opcodes: number[] = [];

  /** Island tracking */
  private islands: Array<{
    id: number;
    trigger: number;
    propsMode: number;
    nameStrIdx: number;
    slotIds: number[];
    byteOffset: number;
  }> = [];

  /** DYN_TEXT marker counter */
  private nextMarkerId: number = 0;

  /** Island ID counter */
  private nextIslandCounter: number = 0;

  /** Intern a string, return its index. Deduplicates. */
  addString(s: string): number {
    const existing = this.stringMap.get(s);
    if (existing !== undefined) return existing;
    const idx = this.strings.length;
    this.strings.push(s);
    this.stringMap.set(s, idx);
    return idx;
  }

  /** Register a new slot, return its id. */
  addSlot(name: string, typeHint: number, source: number = 0x01, defaultBytes: Uint8Array = new Uint8Array(0)): number {
    const id = this.nextSlotId++;
    this.slots.push({ id, name, typeHint, source, defaultBytes });
    return id;
  }

  /** Get a fresh marker id for DYN_TEXT. */
  nextMarker(): number {
    return this.nextMarkerId++;
  }

  /** Peek at the next island id without incrementing the counter. */
  peekNextIslandId(): number {
    return this.nextIslandCounter;
  }

  /** Register a new island entry. */
  addIsland(name: string, trigger: number, propsMode: number, slotIds: number[], byteOffset: number): number {
    const id = this.nextIslandCounter++;
    const nameStrIdx = this.addString(name);
    this.islands.push({ id, trigger, propsMode, nameStrIdx, slotIds, byteOffset });
    return id;
  }

  /** Emit a raw byte. */
  emit(byte: number): void {
    this.opcodes.push(byte & 0xff);
  }

  /** Emit u16 little-endian. */
  emitU16(val: number): void {
    this.opcodes.push(val & 0xff);
    this.opcodes.push((val >>> 8) & 0xff);
  }

  /** Emit u32 little-endian. */
  emitU32(val: number): void {
    this.opcodes.push(val & 0xff);
    this.opcodes.push((val >>> 8) & 0xff);
    this.opcodes.push((val >>> 16) & 0xff);
    this.opcodes.push((val >>> 24) & 0xff);
  }

  /** Get current opcode buffer length (for offset calculations). */
  opcodeLen(): number {
    return this.opcodes.length;
  }

  /** Patch a u32 at a previous position (for back-patching body lengths). */
  patchU32(pos: number, val: number): void {
    this.opcodes[pos] = val & 0xff;
    this.opcodes[pos + 1] = (val >>> 8) & 0xff;
    this.opcodes[pos + 2] = (val >>> 16) & 0xff;
    this.opcodes[pos + 3] = (val >>> 24) & 0xff;
  }

  /** Build the complete FMIR binary. */
  toBinary(): Uint8Array {
    // Encode slot table FIRST — it may intern slot name strings via addString(),
    // so the string table must be encoded after all strings are registered.
    const slotTableBytes = this.encodeSlotTable();
    // Encode string table (now includes any strings added by slot encoding)
    const stringTableBytes = this.encodeStringTable();
    // Opcode stream
    const opcodeBytes = new Uint8Array(this.opcodes);
    // Island table
    const islandTableBytes = this.encodeIslandTable();

    // Data start offset = header (16) + section table (32)
    const dataStart = 48;

    // Data layout: [bytecode][strings][slots][islands]
    // Section table order must match Rust parser: 0=Bytecode, 1=Strings, 2=Slots, 3=Islands
    const opcodeOffset = dataStart;
    const opcodeSize = opcodeBytes.length;

    const stringTableOffset = opcodeOffset + opcodeSize;
    const stringTableSize = stringTableBytes.length;

    const slotTableOffset = stringTableOffset + stringTableSize;
    const slotTableSize = slotTableBytes.length;

    const islandTableOffset = slotTableOffset + slotTableSize;
    const islandTableSize = islandTableBytes.length;

    const totalSize = islandTableOffset + islandTableSize;
    const buf = new Uint8Array(totalSize);
    const view = new DataView(buf.buffer);

    // --- Header (16 bytes) ---
    // Magic: "FMIR"
    buf[0] = 0x46; // 'F'
    buf[1] = 0x4d; // 'M'
    buf[2] = 0x49; // 'I'
    buf[3] = 0x52; // 'R'
    // Version: 2 (u16 LE)
    view.setUint16(4, 2, true);
    // Flags: 0 (u16 LE)
    view.setUint16(6, 0, true);
    // Source hash: 0 (u64 LE) -- 8 bytes at offset 8
    // Already zeroed

    // --- Section Table (32 bytes, starting at offset 16) ---
    // Section 0: Bytecode (offset 16)
    view.setUint32(16, opcodeOffset, true);
    view.setUint32(20, opcodeSize, true);
    // Section 1: Strings (offset 24)
    view.setUint32(24, stringTableOffset, true);
    view.setUint32(28, stringTableSize, true);
    // Section 2: Slots (offset 32)
    view.setUint32(32, slotTableOffset, true);
    view.setUint32(36, slotTableSize, true);
    // Section 3: Islands (offset 40)
    view.setUint32(40, islandTableOffset, true);
    view.setUint32(44, islandTableSize, true);

    // --- Data sections ---
    buf.set(opcodeBytes, opcodeOffset);
    buf.set(stringTableBytes, stringTableOffset);
    buf.set(slotTableBytes, slotTableOffset);
    buf.set(islandTableBytes, islandTableOffset);

    return buf;
  }

  /** Encode the string table section. */
  private encodeStringTable(): Uint8Array {
    const encoder = new TextEncoder();

    // Calculate total size: 4 (count) + sum of (2 + len) per string
    let totalSize = 4; // count u32
    const encodedStrings: Uint8Array[] = [];
    for (const s of this.strings) {
      const encoded = encoder.encode(s);
      encodedStrings.push(encoded);
      totalSize += 2 + encoded.length; // u16 len + bytes
    }

    const buf = new Uint8Array(totalSize);
    const view = new DataView(buf.buffer);

    // Count (u32 LE)
    view.setUint32(0, this.strings.length, true);

    let pos = 4;
    for (const encoded of encodedStrings) {
      // Length (u16 LE)
      view.setUint16(pos, encoded.length, true);
      pos += 2;
      // UTF-8 bytes
      buf.set(encoded, pos);
      pos += encoded.length;
    }

    return buf;
  }

  /** Encode the slot table section (v2 format). */
  private encodeSlotTable(): Uint8Array {
    // v2: count(u16) + variable-length entries
    // Each entry: slot_id(u16) + name_str_idx(u32) + type_hint(u8) + source(u8) + default_len(u16) + default_bytes
    let totalSize = 2; // count
    for (const slot of this.slots) {
      totalSize += 2 + 4 + 1 + 1 + 2 + slot.defaultBytes.length; // 10 + default_bytes.length
    }

    const buf = new Uint8Array(totalSize);
    const view = new DataView(buf.buffer);
    view.setUint16(0, this.slots.length, true);

    let pos = 2;
    for (const slot of this.slots) {
      view.setUint16(pos, slot.id, true); pos += 2;
      const nameIdx = this.addString(slot.name);
      view.setUint32(pos, nameIdx, true); pos += 4;
      buf[pos] = slot.typeHint; pos += 1;
      buf[pos] = slot.source; pos += 1;
      view.setUint16(pos, slot.defaultBytes.length, true); pos += 2;
      buf.set(slot.defaultBytes, pos);
      pos += slot.defaultBytes.length;
    }

    return buf;
  }

  /** Get registered island entries (for build.ts to generate client registry). */
  getIslands(): Array<{ id: number; name: string; trigger: number; propsMode: number; slotIds: number[] }> {
    return this.islands.map(i => ({
      id: i.id,
      name: this.strings[i.nameStrIdx] || `island_${i.id}`,
      trigger: i.trigger,
      propsMode: i.propsMode,
      slotIds: i.slotIds,
    }));
  }

  /** Encode the island table section (with slot_ids). */
  private encodeIslandTable(): Uint8Array {
    // count(u16) + entries
    // Per entry: id(u16) + trigger(u8) + props_mode(u8) + name_str_idx(u32) + byte_offset(u32) + slot_count(u16) + [slot_id(u16)]
    let totalSize = 2; // count
    for (const island of this.islands) {
      totalSize += 2 + 1 + 1 + 4 + 4 + 2 + (island.slotIds?.length ?? 0) * 2;
    }

    const buf = new Uint8Array(totalSize);
    const view = new DataView(buf.buffer);
    view.setUint16(0, this.islands.length, true);

    let pos = 2;
    for (const island of this.islands) {
      view.setUint16(pos, island.id, true); pos += 2;
      buf[pos] = island.trigger; pos += 1;
      buf[pos] = island.propsMode; pos += 1;
      view.setUint32(pos, island.nameStrIdx, true); pos += 4;
      view.setUint32(pos, island.byteOffset, true); pos += 4;
      const slotIds = island.slotIds ?? [];
      view.setUint16(pos, slotIds.length, true); pos += 2;
      for (const slotId of slotIds) {
        view.setUint16(pos, slotId, true); pos += 2;
      }
    }

    return buf;
  }
}

// ---------------------------------------------------------------------------
// AST -> Opcode Emission
// ---------------------------------------------------------------------------

/**
 * Emit opcodes for a single h() call node (recursively handles children).
 */
function emitNode(
  node: t.CallExpression,
  hName: string,
  ctx: IrEmitContext,
): void {
  const args = node.arguments;
  if (args.length === 0) return;

  // First arg must be a string literal tag name
  const tagArg = args[0];
  if (!tagArg || !t.isStringLiteral(tagArg)) return;
  const tag = tagArg.value;
  const tagStrIdx = ctx.addString(tag);

  // Process props (second arg)
  const staticAttrs: Array<{ keyIdx: number; valIdx: number }> = [];
  const dynAttrs: Array<{ keyIdx: number; slotId: number }> = [];

  const propsArg = args.length > 1 ? args[1] : undefined;
  if (
    propsArg
    && !t.isNullLiteral(propsArg)
    && !isUndefinedIdentifier(propsArg)
    && !t.isSpreadElement(propsArg)
    && t.isObjectExpression(propsArg)
  ) {
    for (const prop of propsArg.properties) {
      if (t.isSpreadElement(prop) || !t.isObjectProperty(prop)) continue;
      if (prop.computed) continue;

      const key = t.isIdentifier(prop.key)
        ? prop.key.name
        : t.isStringLiteral(prop.key)
          ? prop.key.value
          : null;
      if (key === null) continue;

      const val = prop.value as t.Expression;

      // Skip event handlers (island territory)
      if (isEventProp(key)) continue;

      // Skip ref and dangerouslySetInnerHTML
      if (key === 'ref' || key === 'dangerouslySetInnerHTML') continue;

      // Static literal value -> static attribute pair
      if (isStaticLiteral(val)) {
        const strVal = staticLiteralToAttrString(val);
        if (strVal !== null) {
          const keyIdx = ctx.addString(key);
          const valIdx = ctx.addString(strVal);
          staticAttrs.push({ keyIdx, valIdx });
        }
        // If null (e.g. false boolean), omit the attribute entirely
        continue;
      }

      // Function/arrow expression or any other expression -> dynamic attribute
      const keyIdx = ctx.addString(key);
      const slotName = `attr:${key}`;
      const slotId = ctx.addSlot(slotName, TYPE_TEXT);
      dynAttrs.push({ keyIdx, slotId });
    }
  }

  const isVoid = VOID_TAGS.has(tag);

  if (isVoid) {
    // VOID_TAG: opcode(1) + str_idx(4) + attr_count(2) + [key(4) + val(4)] * count
    ctx.emit(OP_VOID_TAG);
    ctx.emitU32(tagStrIdx);
    ctx.emitU16(staticAttrs.length);
    for (const attr of staticAttrs) {
      ctx.emitU32(attr.keyIdx);
      ctx.emitU32(attr.valIdx);
    }
  } else {
    // OPEN_TAG: opcode(1) + str_idx(4) + attr_count(2) + [key(4) + val(4)] * count
    ctx.emit(OP_OPEN_TAG);
    ctx.emitU32(tagStrIdx);
    ctx.emitU16(staticAttrs.length);
    for (const attr of staticAttrs) {
      ctx.emitU32(attr.keyIdx);
      ctx.emitU32(attr.valIdx);
    }
  }

  // Emit DYN_ATTR for each dynamic attribute
  for (const dyn of dynAttrs) {
    ctx.emit(OP_DYN_ATTR);
    ctx.emitU32(dyn.keyIdx);
    ctx.emitU16(dyn.slotId);
  }

  // Process children (3rd+ args) -- only for non-void tags
  if (!isVoid) {
    for (let i = 2; i < args.length; i++) {
      const childArg = args[i];
      if (!childArg || t.isSpreadElement(childArg)) continue;

      const child = childArg as t.Expression;

      // String literal -> TEXT
      if (t.isStringLiteral(child)) {
        ctx.emit(OP_TEXT);
        ctx.emitU32(ctx.addString(child.value));
        continue;
      }

      // Numeric literal -> TEXT
      if (t.isNumericLiteral(child)) {
        ctx.emit(OP_TEXT);
        ctx.emitU32(ctx.addString(String(child.value)));
        continue;
      }

      // Another h() call -> recursive
      if (
        t.isCallExpression(child)
        && t.isIdentifier(child.callee)
        && child.callee.name === hName
      ) {
        emitNode(child, hName, ctx);
        continue;
      }

      // Function/arrow expression -> DYN_TEXT
      if (t.isArrowFunctionExpression(child) || t.isFunctionExpression(child)) {
        const slotName = `text:${i - 2}`;
        const slotId = ctx.addSlot(slotName, TYPE_TEXT);
        const markerId = ctx.nextMarker();
        ctx.emit(OP_DYN_TEXT);
        ctx.emitU16(slotId);
        ctx.emitU16(markerId);
        continue;
      }

      // Any other expression -> DYN_TEXT
      const slotName = `text:${i - 2}`;
      const slotId = ctx.addSlot(slotName, TYPE_TEXT);
      const markerId = ctx.nextMarker();
      ctx.emit(OP_DYN_TEXT);
      ctx.emitU16(slotId);
      ctx.emitU16(markerId);
    }

    // CLOSE_TAG: opcode(1) + str_idx(4)
    ctx.emit(OP_CLOSE_TAG);
    ctx.emitU32(tagStrIdx);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile an h() call expression subtree into FMIR binary format.
 * Only handles static and dynamic subtrees (not islands -- those stay as client JS).
 */
export function emitIr(
  node: t.CallExpression,
  hBindingName: string,
): Uint8Array {
  const ctx = new IrEmitContext();
  emitNode(node, hBindingName, ctx);
  return ctx.toBinary();
}

/**
 * Forma Compiler - FMIR Binary Buffer
 *
 * IrEmitContext accumulates the four FMIR sections — bytecode, interned
 * strings, slots and islands — and serializes them into the binary format the
 * Rust-side walker reads to produce HTML.
 *
 * It is a buffer, not a compiler: the AST → opcode translation lives entirely
 * in ir-walk.ts (walkHTree / walkCallExpression), which is what the SSR plugin
 * drives. Only Static and Dynamic subtrees reach the bytecode — Island
 * subtrees stay as client-side JS behind ISLAND_START/ISLAND_END markers.
 */

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

  /** Stack of slot-id capture sets for island subtree walks.
   *  Every set on the stack records each referenced slot, so an outer
   *  island's span also captures slots of islands nested inside it. */
  private slotCaptureStack: Set<number>[] = [];

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
    this.recordSlotRef(id);
    return id;
  }

  /** Begin capturing slot ids referenced while walking an island subtree. */
  beginSlotCapture(): void {
    this.slotCaptureStack.push(new Set<number>());
  }

  /** End the innermost capture; returns the captured slot ids sorted ascending. */
  endSlotCapture(): number[] {
    const captured = this.slotCaptureStack.pop();
    return captured ? Array.from(captured).sort((a, b) => a - b) : [];
  }

  /** Record a slot-id reference into every active capture set.
   *  Called automatically by addSlot; call it directly when an opcode reuses
   *  a pre-existing slot (signalSlots / listItemBindings) without addSlot. */
  recordSlotRef(id: number): void {
    for (const set of this.slotCaptureStack) set.add(id);
  }

  /** Matches per-item list scratch slots (`list:<base>:item`). These are
   *  TYPE_OBJECT working storage the LIST opcode overwrites per row, so after
   *  SSR they hold the LAST rendered row — serializing them into an island's
   *  data-forma-props would leak that row into the page. They are excluded
   *  from island slot ids; everything else (attr:*, text:*, show:*,
   *  list:*:array, list:*:<prop>, named signal slots) is kept. */
  private static readonly LIST_ITEM_SCRATCH_RE = /^list:[^:]+:item$/;

  /** Replace the slot ids of a registered island entry (back-filled after
   *  the island's component subtree has been walked). Filters out per-item
   *  list scratch slots — see LIST_ITEM_SCRATCH_RE. */
  setIslandSlotIds(islandId: number, slotIds: number[]): void {
    const island = this.islands.find(i => i.id === islandId);
    if (!island) return;
    island.slotIds = slotIds.filter(id => {
      const slot = this.slots.find(s => s.id === id);
      return !slot || !IrEmitContext.LIST_ITEM_SCRATCH_RE.test(slot.name);
    });
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
      // The per-string length prefix is a u16 — a longer string would
      // silently wrap via setUint16 and desynchronize the whole table for
      // the Rust parser. Fail hard instead of emitting a corrupt binary
      // (generateRealIr catches this and falls back to placeholder IR).
      if (encoded.length > 0xffff) {
        throw new Error(
          `FMIR string table entry is ${encoded.length} UTF-8 bytes — exceeds the 65535-byte u16 length limit (string starts with ${JSON.stringify(s.slice(0, 40))}...)`,
        );
      }
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
      // default_len is a u16 — larger defaults would silently wrap and
      // corrupt the slot table (see the matching guard in encodeStringTable).
      if (slot.defaultBytes.length > 0xffff) {
        throw new Error(
          `FMIR slot '${slot.name}' has a ${slot.defaultBytes.length}-byte default — exceeds the 65535-byte u16 length limit`,
        );
      }
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

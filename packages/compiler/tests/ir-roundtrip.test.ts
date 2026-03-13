/**
 * IR Roundtrip Validation Tests
 *
 * These tests validate the structural integrity of FMIR binaries produced by
 * the TypeScript emitter. They complement the Rust-side walker roundtrip tests
 * (walker.rs::roundtrip_*) which verify that programmatically-built IR walks
 * to correct HTML.
 *
 * Together, the two test suites ensure the binary contract between the TS
 * emitter and the Rust walker is correct without needing a cross-language
 * execution bridge (that comes in Phase 2 with WASM).
 */

import { describe, it, expect } from 'vitest';
import { emitIr, IrEmitContext } from '../src/ir-emit';

// ---------------------------------------------------------------------------
// Binary reading helpers
// ---------------------------------------------------------------------------

function readU16LE(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

function readU32LE(data: Uint8Array, offset: number): number {
  return (
    data[offset]!
    | (data[offset + 1]! << 8)
    | (data[offset + 2]! << 16)
    | (data[offset + 3]! << 24)
  ) >>> 0;
}

function readStringTable(data: Uint8Array, offset: number): string[] {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IR roundtrip validation', () => {
  it('emitted IR has valid section bounds', () => {
    // Build a simple IR via IrEmitContext, verify all section offsets + sizes
    // are within file bounds.
    const ctx = new IrEmitContext();
    const divIdx = ctx.addString('div');
    ctx.emit(0x01); // OPEN_TAG
    ctx.emitU32(divIdx);
    ctx.emitU16(0); // 0 attrs
    ctx.emit(0x02); // CLOSE_TAG
    ctx.emitU32(divIdx);
    const binary = ctx.toBinary();

    // Section table starts at byte 16 (after header).
    // Section order: 0=Bytecode(@16), 1=Strings(@24), 2=Slots(@32), 3=Islands(@40)
    const opOffset = readU32LE(binary, 16);
    const opSize = readU32LE(binary, 20);
    const strOffset = readU32LE(binary, 24);
    const strSize = readU32LE(binary, 28);
    const slotOffset = readU32LE(binary, 32);
    const slotSize = readU32LE(binary, 36);
    const islandOffset = readU32LE(binary, 40);
    const islandSize = readU32LE(binary, 44);

    // All sections must end within file bounds
    expect(strOffset + strSize).toBeLessThanOrEqual(binary.length);
    expect(slotOffset + slotSize).toBeLessThanOrEqual(binary.length);
    expect(opOffset + opSize).toBeLessThanOrEqual(binary.length);
    expect(islandOffset + islandSize).toBeLessThanOrEqual(binary.length);

    // Sections must not overlap and must start at or after byte 48 (header + table)
    expect(strOffset).toBeGreaterThanOrEqual(48);
    expect(slotOffset).toBeGreaterThanOrEqual(48);
    expect(opOffset).toBeGreaterThanOrEqual(48);
    expect(islandOffset).toBeGreaterThanOrEqual(48);

    // Total size must match file length
    const maxEnd = Math.max(
      strOffset + strSize,
      slotOffset + slotSize,
      opOffset + opSize,
      islandOffset + islandSize,
    );
    expect(maxEnd).toBe(binary.length);
  });

  it('string table is readable and contains expected entries', () => {
    const ctx = new IrEmitContext();
    ctx.addString('hello');
    ctx.addString('world');
    // Need at least one opcode for a valid file
    ctx.emit(0x04); // TEXT
    ctx.emitU32(0);
    const binary = ctx.toBinary();

    // Section 1 (Strings) is at offset 24
    const strOffset = readU32LE(binary, 24);
    const strings = readStringTable(binary, strOffset);
    expect(strings).toEqual(['hello', 'world']);
  });

  it('opcode stream contains expected opcodes for a div with text', () => {
    const ctx = new IrEmitContext();
    const divIdx = ctx.addString('div');
    const textIdx = ctx.addString('Hello');

    ctx.emit(0x01); // OPEN_TAG
    ctx.emitU32(divIdx);
    ctx.emitU16(0);
    ctx.emit(0x04); // TEXT
    ctx.emitU32(textIdx);
    ctx.emit(0x02); // CLOSE_TAG
    ctx.emitU32(divIdx);

    const binary = ctx.toBinary();
    // Section 0 (Bytecode) is at offset 16
    const opOffset = readU32LE(binary, 16);
    const opSize = readU32LE(binary, 20);

    // Extract and verify opcodes
    const opcodes = binary.slice(opOffset, opOffset + opSize);

    // Walk the opcode stream to extract just the opcode bytes
    const foundOpcodes: number[] = [];
    let pos = 0;
    while (pos < opcodes.length) {
      const op = opcodes[pos]!;
      foundOpcodes.push(op);
      if (op === 0x01 || op === 0x03) {
        // OPEN_TAG / VOID_TAG: opcode(1) + str_idx(4) + attr_count(2) + attrs
        pos += 1 + 4;
        const attrCount = readU16LE(opcodes, pos);
        pos += 2 + attrCount * 8;
      } else if (op === 0x02 || op === 0x04) {
        // CLOSE_TAG / TEXT: opcode(1) + str_idx(4)
        pos += 1 + 4;
      } else if (op === 0x05) {
        // DYN_TEXT: opcode(1) + slot_id(2) + marker_id(2)
        pos += 1 + 2 + 2;
      } else if (op === 0x06) {
        // DYN_ATTR: opcode(1) + attr_str_idx(4) + slot_id(2)
        pos += 1 + 4 + 2;
      } else {
        pos += 1;
      }
    }

    expect(foundOpcodes).toEqual([0x01, 0x04, 0x02]); // OPEN_TAG, TEXT, CLOSE_TAG
  });

  it('emitted IR for h() call has correct string table', () => {
    const { parse } = require('@babel/parser');
    const _traverse = require('@babel/traverse');
    const traverse = typeof _traverse === 'function' ? _traverse : _traverse.default;

    const ast = parse(`const x = h('div', { class: 'card' }, 'Hello')`, {
      sourceType: 'module',
      plugins: ['typescript'],
    });
    let expr: any;
    traverse(ast, {
      VariableDeclarator(path: any) { expr = path.node.init; path.stop(); },
    });

    const binary = emitIr(expr, 'h');
    // Section 1 (Strings) is at offset 24
    const strOffset = readU32LE(binary, 24);
    const strings = readStringTable(binary, strOffset);

    expect(strings).toContain('div');
    expect(strings).toContain('class');
    expect(strings).toContain('card');
    expect(strings).toContain('Hello');
  });

  it('real compiler-emitted onboarding IR has valid v2 format', () => {
    const fs = require('fs');
    const path = require('path');

    const irPath = path.resolve(
      __dirname,
      '../../../../../auth-module-poc/admin/dist/platform-onboarding.ir',
    );
    if (!fs.existsSync(irPath)) {
      console.warn('Skipping: run `npx tsx build.ts --ssr` in admin/ first');
      return;
    }

    const data = new Uint8Array(fs.readFileSync(irPath));
    const view = new DataView(data.buffer);

    // --- Header validation ---
    // Magic: "FMIR"
    expect(String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!)).toBe('FMIR');
    // Version: 2
    expect(view.getUint16(4, true)).toBe(2);
    // Flags: 0
    expect(view.getUint16(6, true)).toBe(0);

    // File must be non-trivial (real content, not a 136-byte placeholder)
    expect(data.length).toBeGreaterThan(200);

    // --- Section table validation ---
    // 4 sections: Bytecode(@16), Strings(@24), Slots(@32), Islands(@40)
    const sections: Array<{ name: string; offset: number; size: number }> = [];
    const sectionNames = ['Bytecode', 'Strings', 'Slots', 'Islands'];
    for (let i = 0; i < 4; i++) {
      const offset = view.getUint32(16 + i * 8, true);
      const size = view.getUint32(20 + i * 8, true);
      sections.push({ name: sectionNames[i]!, offset, size });

      // All sections must start at or after header+table (48 bytes)
      expect(offset).toBeGreaterThanOrEqual(48);
      // All sections must end within file bounds
      expect(offset + size).toBeLessThanOrEqual(data.length);
    }

    // --- Bytecode section ---
    const opcodeOffset = sections[0]!.offset;
    const opcodeSize = sections[0]!.size;
    expect(opcodeSize).toBeGreaterThan(10);

    // Walk the opcode stream and verify it parses cleanly
    const opcodes = data.slice(opcodeOffset, opcodeOffset + opcodeSize);
    let pos = 0;
    let opcodeCount = 0;
    let openCount = 0;
    let closeCount = 0;
    let voidCount = 0;
    while (pos < opcodes.length) {
      const op = opcodes[pos]!;
      opcodeCount++;

      if (op === 0x01 || op === 0x03) {
        // OPEN_TAG / VOID_TAG
        if (op === 0x01) openCount++;
        if (op === 0x03) voidCount++;
        pos += 1 + 4; // opcode + tag string index
        const attrCount = readU16LE(opcodes, pos);
        pos += 2 + attrCount * 8; // attr_count + attrs (key_idx(4) + val_idx(4) each)
      } else if (op === 0x02) {
        // CLOSE_TAG
        closeCount++;
        pos += 1 + 4;
      } else if (op === 0x04) {
        // TEXT
        pos += 1 + 4;
      } else if (op === 0x05) {
        // DYN_TEXT
        pos += 1 + 2 + 2; // opcode + slot_id + marker_id
      } else if (op === 0x06) {
        // DYN_ATTR
        pos += 1 + 4 + 2; // opcode + attr_str_idx + slot_id
      } else if (op === 0x07) {
        // SHOW_IF: opcode + slot_id(2) + then_len(4) + else_len(4)
        pos += 1 + 2 + 4 + 4;
      } else if (op === 0x08) {
        // SHOW_ELSE: opcode only
        pos += 1;
      } else if (op === 0x0B) {
        // ISLAND_START: opcode + island_id(2)
        pos += 1 + 2;
      } else if (op === 0x0C) {
        // ISLAND_END: opcode + island_id(2)
        pos += 1 + 2;
      } else {
        // Unknown opcode — fail
        throw new Error(`Unknown opcode 0x${op.toString(16).padStart(2, '0')} at position ${pos}`);
      }
    }

    // Opcode stream must consume all bytes exactly
    expect(pos).toBe(opcodes.length);
    // Must have a reasonable number of opcodes for the onboarding page
    expect(opcodeCount).toBeGreaterThan(20);
    // Every OPEN_TAG must have a matching CLOSE_TAG
    expect(openCount).toBe(closeCount);

    // --- String table section ---
    const strOffset = sections[1]!.offset;
    const strSize = sections[1]!.size;
    expect(strSize).toBeGreaterThan(10);

    const strings = readStringTable(data, strOffset);
    expect(strings.length).toBeGreaterThan(5);
    // Must contain common HTML tags from the onboarding page
    expect(strings).toContain('div');
    expect(strings).toContain('section');
    expect(strings).toContain('h1');
    expect(strings).toContain('form');
    expect(strings).toContain('class');

    // --- Slot table section ---
    const slotOffset = sections[2]!.offset;
    const slotSize = sections[2]!.size;
    // Onboarding page has signals → slot table should have entries
    const slotCount = view.getUint16(slotOffset, true);
    expect(slotCount).toBeGreaterThan(0);

    // Validate slot entries parse cleanly
    let slotPos = slotOffset + 2;
    for (let i = 0; i < slotCount; i++) {
      const slotId = view.getUint16(slotPos, true); slotPos += 2;
      const nameStrIdx = view.getUint32(slotPos, true); slotPos += 4;
      const typeHint = data[slotPos]!; slotPos += 1;
      const source = data[slotPos]!; slotPos += 1;
      const defaultLen = view.getUint16(slotPos, true); slotPos += 2;
      slotPos += defaultLen; // skip default bytes

      // Slot IDs should be sequential starting from 0
      expect(slotId).toBe(i);
      // Name string index must be valid
      expect(nameStrIdx).toBeLessThan(strings.length);
      // Type hint must be valid (text=1, bool=2, number=3)
      expect([0x01, 0x02, 0x03]).toContain(typeHint);
      // Source must be client (0x01)
      expect(source).toBe(0x01);
    }
    // Slot table consumed exactly its declared size
    expect(slotPos - slotOffset).toBe(slotSize);

    // --- Islands section ---
    const islandOffset = sections[3]!.offset;
    const islandCount = view.getUint16(islandOffset, true);
    // Onboarding page has islands (subtrees with event handlers, dynamic attrs, etc.)
    expect(islandCount).toBeGreaterThan(0);

    console.log(
      `E2E verification passed: ${data.length} bytes, ` +
      `${opcodeCount} opcodes (${openCount} open, ${closeCount} close, ${voidCount} void), ` +
      `${strings.length} strings, ${slotCount} slots, ${islandCount} islands`,
    );
  });

  it('all 7 page IR files have valid FMIR v2 headers', () => {
    const fs = require('fs');
    const path = require('path');

    const distDir = path.resolve(__dirname, '../../../../../auth-module-poc/admin/dist');
    const pageNames = [
      'platform-login',
      'platform-onboarding',
      'platform-console',
      'admin-dashboard',
      'tenant-login',
      'tenant-dashboard',
      'tenant-admin',
    ];

    let checkedCount = 0;
    for (const page of pageNames) {
      const irPath = path.join(distDir, `${page}.ir`);
      if (!fs.existsSync(irPath)) continue;

      const data = new Uint8Array(fs.readFileSync(irPath));
      const view = new DataView(data.buffer);

      // Magic
      expect(String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!)).toBe('FMIR');
      // Version
      expect(view.getUint16(4, true)).toBe(2);
      // All sections within bounds
      for (let i = 0; i < 4; i++) {
        const offset = view.getUint32(16 + i * 8, true);
        const size = view.getUint32(20 + i * 8, true);
        expect(offset + size).toBeLessThanOrEqual(data.length);
      }

      checkedCount++;
    }

    // At least some IR files must exist (build must have run)
    if (checkedCount === 0) {
      console.warn('Skipping: run `npx tsx build.ts --ssr` in admin/ first');
      return;
    }

    expect(checkedCount).toBe(7);
    console.log(`All ${checkedCount} page IR files have valid FMIR v2 headers`);
  });

  it('placeholder IR from SSR plugin has valid structure', () => {
    // Build a placeholder IR like the SSR plugin does:
    // <div id="app" data-forma-page="test-page"></div>
    const ctx = new IrEmitContext();
    const divIdx = ctx.addString('div');
    const idKey = ctx.addString('id');
    const idVal = ctx.addString('app');
    const pageKey = ctx.addString('data-forma-page');
    const pageVal = ctx.addString('test-page');

    ctx.emit(0x01); // OPEN_TAG
    ctx.emitU32(divIdx);
    ctx.emitU16(2); // 2 attrs
    ctx.emitU32(idKey);
    ctx.emitU32(idVal);
    ctx.emitU32(pageKey);
    ctx.emitU32(pageVal);
    ctx.emit(0x02); // CLOSE_TAG
    ctx.emitU32(divIdx);

    const binary = ctx.toBinary();

    // Valid FMIR magic
    expect(binary[0]).toBe(0x46); // 'F'
    expect(binary[1]).toBe(0x4d); // 'M'
    expect(binary[2]).toBe(0x49); // 'I'
    expect(binary[3]).toBe(0x52); // 'R'
    expect(readU16LE(binary, 4)).toBe(2); // version

    // String table should contain all 5 strings (section 1 at offset 24)
    const strOffset = readU32LE(binary, 24);
    const strings = readStringTable(binary, strOffset);
    expect(strings).toHaveLength(5);
    expect(strings).toEqual(['div', 'id', 'app', 'data-forma-page', 'test-page']);

    // Opcode section should have OPEN_TAG + CLOSE_TAG (section 0 at offset 16)
    const opOffset = readU32LE(binary, 16);
    const opSize = readU32LE(binary, 20);
    const opcodes = binary.slice(opOffset, opOffset + opSize);

    // OPEN_TAG: 1 + 4 + 2 + 2*(4+4) = 23 bytes
    // CLOSE_TAG: 1 + 4 = 5 bytes
    expect(opSize).toBe(23 + 5);
    expect(opcodes[0]).toBe(0x01); // OPEN_TAG
    expect(opcodes[23]).toBe(0x02); // CLOSE_TAG
  });
});

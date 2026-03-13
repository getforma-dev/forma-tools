import { describe, it, expect } from 'vitest';
import { emitIr, IrEmitContext } from '../src/ir-emit';
import { parse } from '@babel/parser';
import type * as T from '@babel/types';
import _traverse from '@babel/traverse';

const traverse = typeof _traverse === 'function' ? _traverse : (_traverse as any).default;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JS expression string into a Babel AST Expression node.
 * Wraps the expression in `const x = <expr>` and extracts the init.
 */
function parseExpr(code: string): T.Expression {
  const ast = parse(`const x = ${code}`, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  let expr: T.Expression | undefined;
  traverse(ast, {
    VariableDeclarator(path: any) {
      expr = path.node.init;
      path.stop();
    },
  });
  if (!expr) throw new Error(`Failed to parse expression: ${code}`);
  return expr;
}

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

function readStringTable(data: Uint8Array, offset: number, _size: number): string[] {
  const count = readU32LE(data, offset);
  const strings: string[] = [];
  let pos = offset + 4;
  for (let i = 0; i < count; i++) {
    const len = readU16LE(data, pos);
    pos += 2;
    const bytes = data.slice(pos, pos + len);
    strings.push(new TextDecoder().decode(bytes));
    pos += len;
  }
  return strings;
}

/** Read the section table from the binary. Returns offsets and sizes. */
function readSections(data: Uint8Array) {
  // Section table order: 0=Bytecode(@16), 1=Strings(@24), 2=Slots(@32), 3=Islands(@40)
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

/** Extract the opcode stream from the binary. */
function getOpcodes(data: Uint8Array): Uint8Array {
  const sections = readSections(data);
  return data.slice(sections.opcodeOffset, sections.opcodeOffset + sections.opcodeSize);
}

/** Extract the string table from the binary. */
function getStrings(data: Uint8Array): string[] {
  const sections = readSections(data);
  return readStringTable(data, sections.stringTableOffset, sections.stringTableSize);
}

// Opcode constants
const OP_OPEN_TAG  = 0x01;
const OP_CLOSE_TAG = 0x02;
const OP_VOID_TAG  = 0x03;
const OP_TEXT      = 0x04;
const OP_DYN_TEXT  = 0x05;
const OP_DYN_ATTR  = 0x06;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitIr', () => {
  it('emits valid FMIR header', () => {
    const node = parseExpr(`h('div', null, 'Hello')`);
    const ir = emitIr(node as T.CallExpression, 'h');

    // Magic bytes: "FMIR"
    expect(ir[0]).toBe(0x46); // 'F'
    expect(ir[1]).toBe(0x4d); // 'M'
    expect(ir[2]).toBe(0x49); // 'I'
    expect(ir[3]).toBe(0x52); // 'R'

    // Version: 2 (u16 LE)
    expect(ir[4]).toBe(0x02);
    expect(ir[5]).toBe(0x00);
  });

  it('emits static div with text', () => {
    const node = parseExpr(`h('div', null, 'Hello')`);
    const ir = emitIr(node as T.CallExpression, 'h');

    const strings = getStrings(ir);
    expect(strings).toContain('div');
    expect(strings).toContain('Hello');

    // Opcode stream should contain OPEN_TAG, TEXT, CLOSE_TAG
    const opcodes = getOpcodes(ir);

    // Find opcodes by scanning: OPEN_TAG(0x01), TEXT(0x04), CLOSE_TAG(0x02)
    const opcodeList: number[] = [];
    let pos = 0;
    while (pos < opcodes.length) {
      const op = opcodes[pos]!;
      opcodeList.push(op);
      if (op === OP_OPEN_TAG || op === OP_VOID_TAG) {
        // opcode(1) + str_idx(4) + attr_count(2)
        pos += 1 + 4;
        const attrCount = readU16LE(opcodes, pos);
        pos += 2;
        // Skip attrs: (key(4) + val(4)) * count
        pos += attrCount * 8;
      } else if (op === OP_CLOSE_TAG) {
        // opcode(1) + str_idx(4)
        pos += 1 + 4;
      } else if (op === OP_TEXT) {
        // opcode(1) + str_idx(4)
        pos += 1 + 4;
      } else if (op === OP_DYN_TEXT) {
        // opcode(1) + slot_id(2) + marker_id(2)
        pos += 1 + 2 + 2;
      } else if (op === OP_DYN_ATTR) {
        // opcode(1) + attr_str_idx(4) + slot_id(2)
        pos += 1 + 4 + 2;
      } else {
        pos += 1;
      }
    }

    expect(opcodeList).toEqual([OP_OPEN_TAG, OP_TEXT, OP_CLOSE_TAG]);
  });

  it('emits void tag', () => {
    const node = parseExpr(`h('input', { type: 'email' })`);
    const ir = emitIr(node as T.CallExpression, 'h');

    const opcodes = getOpcodes(ir);

    // First opcode should be VOID_TAG (0x03), NOT OPEN_TAG
    expect(opcodes[0]).toBe(OP_VOID_TAG);

    // Should NOT contain CLOSE_TAG
    const opcodeList: number[] = [];
    let pos = 0;
    while (pos < opcodes.length) {
      const op = opcodes[pos]!;
      opcodeList.push(op);
      if (op === OP_VOID_TAG || op === OP_OPEN_TAG) {
        pos += 1 + 4;
        const attrCount = readU16LE(opcodes, pos);
        pos += 2;
        pos += attrCount * 8;
      } else if (op === OP_CLOSE_TAG) {
        pos += 1 + 4;
      } else if (op === OP_TEXT) {
        pos += 1 + 4;
      } else if (op === OP_DYN_TEXT) {
        pos += 1 + 2 + 2;
      } else if (op === OP_DYN_ATTR) {
        pos += 1 + 4 + 2;
      } else {
        pos += 1;
      }
    }

    expect(opcodeList).not.toContain(OP_CLOSE_TAG);
  });

  it('emits attributes', () => {
    const node = parseExpr(`h('div', { class: 'card', id: 'main' })`);
    const ir = emitIr(node as T.CallExpression, 'h');

    const strings = getStrings(ir);
    expect(strings).toContain('class');
    expect(strings).toContain('card');
    expect(strings).toContain('id');
    expect(strings).toContain('main');
  });

  it('emits nested elements', () => {
    const node = parseExpr(`h('div', null, h('span', null, 'Hi'))`);
    const ir = emitIr(node as T.CallExpression, 'h');

    const strings = getStrings(ir);
    expect(strings).toContain('div');
    expect(strings).toContain('span');
    expect(strings).toContain('Hi');

    const opcodes = getOpcodes(ir);
    const opcodeList: number[] = [];
    let pos = 0;
    while (pos < opcodes.length) {
      const op = opcodes[pos]!;
      opcodeList.push(op);
      if (op === OP_OPEN_TAG || op === OP_VOID_TAG) {
        pos += 1 + 4;
        const attrCount = readU16LE(opcodes, pos);
        pos += 2;
        pos += attrCount * 8;
      } else if (op === OP_CLOSE_TAG) {
        pos += 1 + 4;
      } else if (op === OP_TEXT) {
        pos += 1 + 4;
      } else if (op === OP_DYN_TEXT) {
        pos += 1 + 2 + 2;
      } else if (op === OP_DYN_ATTR) {
        pos += 1 + 4 + 2;
      } else {
        pos += 1;
      }
    }

    // OPEN_TAG "div", OPEN_TAG "span", TEXT "Hi", CLOSE_TAG "span", CLOSE_TAG "div"
    expect(opcodeList).toEqual([
      OP_OPEN_TAG,   // div
      OP_OPEN_TAG,   // span
      OP_TEXT,       // "Hi"
      OP_CLOSE_TAG,  // span
      OP_CLOSE_TAG,  // div
    ]);
  });

  it('emits DYN_TEXT for function child', () => {
    const node = parseExpr(`h('div', null, () => name())`);
    const ir = emitIr(node as T.CallExpression, 'h');

    const opcodes = getOpcodes(ir);
    const opcodeList: number[] = [];
    let dynTextSlotId: number | undefined;
    let pos = 0;
    while (pos < opcodes.length) {
      const op = opcodes[pos]!;
      opcodeList.push(op);
      if (op === OP_OPEN_TAG || op === OP_VOID_TAG) {
        pos += 1 + 4;
        const attrCount = readU16LE(opcodes, pos);
        pos += 2;
        pos += attrCount * 8;
      } else if (op === OP_CLOSE_TAG) {
        pos += 1 + 4;
      } else if (op === OP_TEXT) {
        pos += 1 + 4;
      } else if (op === OP_DYN_TEXT) {
        dynTextSlotId = readU16LE(opcodes, pos + 1);
        pos += 1 + 2 + 2;
      } else if (op === OP_DYN_ATTR) {
        pos += 1 + 4 + 2;
      } else {
        pos += 1;
      }
    }

    expect(opcodeList).toContain(OP_DYN_TEXT);
    expect(dynTextSlotId).toBeDefined();
    expect(typeof dynTextSlotId).toBe('number');
  });

  it('deduplicates strings', () => {
    const node = parseExpr(`h('div', { class: 'x' }, h('div', { class: 'y' }))`);
    const ir = emitIr(node as T.CallExpression, 'h');

    const strings = getStrings(ir);

    // "div" should appear only once in the string table
    const divOccurrences = strings.filter(s => s === 'div');
    expect(divOccurrences).toHaveLength(1);

    // "class" should appear only once too
    const classOccurrences = strings.filter(s => s === 'class');
    expect(classOccurrences).toHaveLength(1);

    // "x" and "y" should each appear once
    expect(strings).toContain('x');
    expect(strings).toContain('y');
  });

  it('emits DYN_ATTR for dynamic prop', () => {
    const node = parseExpr(`h('div', { class: () => cls() })`);
    const ir = emitIr(node as T.CallExpression, 'h');

    const opcodes = getOpcodes(ir);
    const opcodeList: number[] = [];
    let pos = 0;
    while (pos < opcodes.length) {
      const op = opcodes[pos]!;
      opcodeList.push(op);
      if (op === OP_OPEN_TAG || op === OP_VOID_TAG) {
        pos += 1 + 4;
        const attrCount = readU16LE(opcodes, pos);
        pos += 2;
        pos += attrCount * 8;
      } else if (op === OP_CLOSE_TAG) {
        pos += 1 + 4;
      } else if (op === OP_TEXT) {
        pos += 1 + 4;
      } else if (op === OP_DYN_TEXT) {
        pos += 1 + 2 + 2;
      } else if (op === OP_DYN_ATTR) {
        pos += 1 + 4 + 2;
      } else {
        pos += 1;
      }
    }

    expect(opcodeList).toContain(OP_DYN_ATTR);
  });

  it('handles boolean attributes', () => {
    const node = parseExpr(`h('input', { disabled: true })`);
    const ir = emitIr(node as T.CallExpression, 'h');

    const strings = getStrings(ir);

    // "disabled" should be in the string table
    expect(strings).toContain('disabled');

    // Empty string value should be in the string table (boolean true -> '')
    expect(strings).toContain('');
  });

  it('handles null props', () => {
    const node = parseExpr(`h('div', null, 'text')`);
    const ir = emitIr(node as T.CallExpression, 'h');

    const opcodes = getOpcodes(ir);
    const opcodeList: number[] = [];
    let pos = 0;
    while (pos < opcodes.length) {
      const op = opcodes[pos]!;
      opcodeList.push(op);
      if (op === OP_OPEN_TAG || op === OP_VOID_TAG) {
        pos += 1 + 4;
        const attrCount = readU16LE(opcodes, pos);
        pos += 2;
        pos += attrCount * 8;
      } else if (op === OP_CLOSE_TAG) {
        pos += 1 + 4;
      } else if (op === OP_TEXT) {
        pos += 1 + 4;
      } else if (op === OP_DYN_TEXT) {
        pos += 1 + 2 + 2;
      } else if (op === OP_DYN_ATTR) {
        pos += 1 + 4 + 2;
      } else {
        pos += 1;
      }
    }

    // Should work correctly: OPEN_TAG + TEXT + CLOSE_TAG with no attributes
    expect(opcodeList).toEqual([OP_OPEN_TAG, OP_TEXT, OP_CLOSE_TAG]);

    // Verify OPEN_TAG has attr_count = 0
    // OPEN_TAG is at pos 0: opcode(1) + str_idx(4) + attr_count(2)
    const attrCount = readU16LE(opcodes, 5); // offset 1 + 4 = 5
    expect(attrCount).toBe(0);
  });

  it('emits v2 header (version 2)', () => {
    const ctx = new IrEmitContext();
    ctx.addString('div');
    ctx.emit(0x01); // OPEN_TAG
    ctx.emitU32(0);
    ctx.emitU16(0);
    ctx.emit(0x02); // CLOSE_TAG
    ctx.emitU32(0);
    const binary = ctx.toBinary();
    const version = binary[4]! | (binary[5]! << 8);
    expect(version).toBe(2);
  });

  it('emits v2 slot table with source and defaults', () => {
    const ctx = new IrEmitContext();
    const encoder = new TextEncoder();
    const defaultBytes = encoder.encode('false');
    const slotId = ctx.addSlot('submitting', 0x02, 0x01, defaultBytes);
    expect(slotId).toBe(0);

    // Emit minimal opcodes so toBinary works
    ctx.addString('div');
    ctx.emit(0x01);
    ctx.emitU32(0);
    ctx.emitU16(0);
    ctx.emit(0x02);
    ctx.emitU32(0);

    const binary = ctx.toBinary();
    // Verify the binary is valid and larger than just header+sections
    expect(binary.length).toBeGreaterThan(48);

    // Read slot table and verify v2 fields (section 2 at offset 32)
    const slotTableOffset = readU32LE(binary, 32);
    const slotCount = readU16LE(binary, slotTableOffset);
    expect(slotCount).toBe(1);

    // Parse v2 slot entry: slot_id(u16) + name_str_idx(u32) + type_hint(u8) + source(u8) + default_len(u16) + default_bytes
    let pos = slotTableOffset + 2;
    const sid = readU16LE(binary, pos); pos += 2;
    expect(sid).toBe(0);
    pos += 4; // skip name_str_idx
    const typeHint = binary[pos]!; pos += 1;
    expect(typeHint).toBe(0x02);
    const source = binary[pos]!; pos += 1;
    expect(source).toBe(0x01);
    const defaultLen = readU16LE(binary, pos); pos += 2;
    expect(defaultLen).toBe(5); // "false" is 5 bytes
    const defaultBytesRead = binary.slice(pos, pos + defaultLen);
    expect(new TextDecoder().decode(defaultBytesRead)).toBe('false');
  });

  it('addSlot defaults source to 0x01 and defaultBytes to empty', () => {
    const ctx = new IrEmitContext();
    const slotId = ctx.addSlot('myslot', 0x01);
    expect(slotId).toBe(0);

    // Emit minimal opcodes
    ctx.addString('div');
    ctx.emit(0x01);
    ctx.emitU32(0);
    ctx.emitU16(0);
    ctx.emit(0x02);
    ctx.emitU32(0);

    const binary = ctx.toBinary();

    // Read slot table (section 2 at offset 32)
    const slotTableOffset = readU32LE(binary, 32);
    let pos = slotTableOffset + 2; // skip count
    pos += 2; // skip slot_id
    pos += 4; // skip name_str_idx
    const typeHint = binary[pos]!; pos += 1;
    expect(typeHint).toBe(0x01);
    const source = binary[pos]!; pos += 1;
    expect(source).toBe(0x01); // default source
    const defaultLen = readU16LE(binary, pos);
    expect(defaultLen).toBe(0); // empty default bytes
  });
});

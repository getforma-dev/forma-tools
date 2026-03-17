import { describe, it, expect } from 'vitest';
import { IrEmitContext } from '../src/ir-emit';
import { walkHTree, walkCallExpression, type WalkContext } from '../src/ir-walk';
import { parse } from '@babel/parser';
import type * as T from '@babel/types';
import * as t from '@babel/types';
import _traverse from '@babel/traverse';

const traverse = typeof _traverse === 'function' ? _traverse : (_traverse as any).default;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseExpr(code: string): T.Expression {
  const ast = parse(`const __x = ${code}`, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  const decl = ast.program.body[0] as T.VariableDeclaration;
  return decl.declarations[0]!.init!;
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

function readStringTable(data: Uint8Array, offset: number): string[] {
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

function extractOpcodeSection(binary: Uint8Array): Uint8Array {
  const view = new DataView(binary.buffer);
  // Section 0 (Bytecode) is at offset 16 in the section table
  const opcodeOffset = view.getUint32(16, true);
  const opcodeSize = view.getUint32(20, true);
  return binary.slice(opcodeOffset, opcodeOffset + opcodeSize);
}

function getStrings(data: Uint8Array): string[] {
  const sections = readSections(data);
  return readStringTable(data, sections.stringTableOffset);
}

// Opcode constants
const OP_OPEN_TAG    = 0x01;
const OP_CLOSE_TAG   = 0x02;
const OP_VOID_TAG    = 0x03;
const OP_TEXT        = 0x04;
const OP_DYN_TEXT    = 0x05;
const OP_DYN_ATTR    = 0x06;
const OP_SHOW_IF     = 0x07;
const OP_SHOW_ELSE   = 0x08;
const OP_ISLAND_START = 0x0B;
const OP_ISLAND_END   = 0x0C;

/**
 * Parse the opcode stream into a flat list of opcode bytes (skipping payloads).
 */
function parseOpcodeList(opcodes: Uint8Array): number[] {
  const list: number[] = [];
  let pos = 0;
  while (pos < opcodes.length) {
    const op = opcodes[pos]!;
    list.push(op);
    if (op === OP_OPEN_TAG || op === OP_VOID_TAG) {
      pos += 1 + 4; // opcode + str_idx
      const attrCount = readU16LE(opcodes, pos);
      pos += 2;
      pos += attrCount * 8; // (key + val) pairs
    } else if (op === OP_CLOSE_TAG) {
      pos += 1 + 4;
    } else if (op === OP_TEXT) {
      pos += 1 + 4;
    } else if (op === OP_DYN_TEXT) {
      pos += 1 + 2 + 2; // opcode + slot_id + marker_id
    } else if (op === OP_DYN_ATTR) {
      pos += 1 + 4 + 2; // opcode + attr_str_idx + slot_id
    } else if (op === OP_SHOW_IF) {
      pos += 1 + 2 + 4 + 4; // opcode + slot_id + then_len + else_len
    } else if (op === OP_SHOW_ELSE) {
      pos += 1;
    } else if (op === OP_ISLAND_START) {
      pos += 1 + 2; // opcode + island_id
    } else if (op === OP_ISLAND_END) {
      pos += 1 + 2; // opcode + island_id
    } else {
      pos += 1;
    }
  }
  return list;
}

/**
 * Helper: emit an h() expression through walkHTree and return the binary.
 */
function walkAndEmit(code: string, walkCtx: WalkContext = {}): Uint8Array {
  const expr = parseExpr(code);
  const ctx = new IrEmitContext();
  if (t.isCallExpression(expr)) {
    walkHTree(expr, 'h', ctx, walkCtx);
  }
  return ctx.toBinary();
}

/**
 * Helper: emit a non-h() call expression through walkCallExpression and return the binary.
 */
function walkCallAndEmit(code: string, walkCtx: WalkContext = {}): Uint8Array {
  const expr = parseExpr(code);
  const ctx = new IrEmitContext();
  if (t.isCallExpression(expr)) {
    walkCallExpression(expr, 'h', ctx, walkCtx);
  }
  return ctx.toBinary();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IR Walk Engine', () => {
  // -------------------------------------------------------------------------
  // Rule 1: Static h() calls → OPEN_TAG + CLOSE_TAG
  // -------------------------------------------------------------------------

  describe('Rule 1: Static h() calls', () => {
    it('emits OPEN_TAG and CLOSE_TAG for static div', () => {
      const binary = walkAndEmit(`h('div', { class: 'hero-section' }, 'Hello')`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_OPEN_TAG);
      expect(opList).toContain(OP_CLOSE_TAG);
    });

    it('includes static attributes in string table', () => {
      const binary = walkAndEmit(`h('div', { class: 'hero-section', id: 'main' })`);
      const strings = getStrings(binary);

      expect(strings).toContain('div');
      expect(strings).toContain('class');
      expect(strings).toContain('hero-section');
      expect(strings).toContain('id');
      expect(strings).toContain('main');
    });

    it('emits nested elements correctly', () => {
      const binary = walkAndEmit(`h('div', null, h('span', null, 'Hi'))`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      // div open, span open, text, span close, div close
      expect(opList).toEqual([
        OP_OPEN_TAG,  // div
        OP_OPEN_TAG,  // span
        OP_TEXT,      // 'Hi'
        OP_CLOSE_TAG, // span
        OP_CLOSE_TAG, // div
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 2: String literal children → TEXT
  // -------------------------------------------------------------------------

  describe('Rule 2: String literal children', () => {
    it('emits TEXT for string child', () => {
      const binary = walkAndEmit(`h('h1', null, 'Auth infrastructure for modern SaaS')`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_TEXT);

      const strings = getStrings(binary);
      expect(strings).toContain('Auth infrastructure for modern SaaS');
    });

    it('emits TEXT for numeric child', () => {
      const binary = walkAndEmit(`h('span', null, 42)`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_TEXT);

      const strings = getStrings(binary);
      expect(strings).toContain('42');
    });
  });

  // -------------------------------------------------------------------------
  // Rule 3: Void elements → VOID_TAG
  // -------------------------------------------------------------------------

  describe('Rule 3: Void elements', () => {
    it('emits VOID_TAG for input', () => {
      const binary = walkAndEmit(`h('input', { id: 'reg-email', type: 'email', placeholder: 'you@company.com' })`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_VOID_TAG);
      expect(opList).not.toContain(OP_CLOSE_TAG);
    });

    it('emits VOID_TAG for br', () => {
      const binary = walkAndEmit(`h('br', null)`);
      const opcodes = extractOpcodeSection(binary);
      expect(opcodes[0]).toBe(OP_VOID_TAG);
    });

    it('emits VOID_TAG for img with attributes', () => {
      const binary = walkAndEmit(`h('img', { src: '/logo.png', alt: 'Logo' })`);
      const opcodes = extractOpcodeSection(binary);
      expect(opcodes[0]).toBe(OP_VOID_TAG);

      const strings = getStrings(binary);
      expect(strings).toContain('src');
      expect(strings).toContain('/logo.png');
      expect(strings).toContain('alt');
      expect(strings).toContain('Logo');
    });

    it('emits DYN_ATTR for function-valued attribute on void element', () => {
      const binary = walkAndEmit(`h('input', { type: () => showPassword() ? 'text' : 'password' })`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_VOID_TAG);
      expect(opList).toContain(OP_DYN_ATTR);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 4: Ternary arrow → SHOW_IF
  // -------------------------------------------------------------------------

  describe('Rule 4: Ternary arrow children', () => {
    it('emits SHOW_IF and SHOW_ELSE for ternary arrow', () => {
      const binary = walkAndEmit(
        `h('button', null, () => submitting() ? 'Creating account...' : 'Create Account')`,
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_SHOW_IF);
      expect(opList).toContain(OP_SHOW_ELSE);
    });

    it('emits TEXT in both branches of ternary', () => {
      const binary = walkAndEmit(
        `h('span', null, () => active() ? 'Active' : 'Inactive')`,
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      // SHOW_IF, TEXT (then), SHOW_ELSE, TEXT (else)
      expect(opList).toContain(OP_SHOW_IF);
      expect(opList).toContain(OP_SHOW_ELSE);

      // Count TEXT opcodes — should be 2 (one in each branch)
      const textCount = opList.filter(op => op === OP_TEXT).length;
      expect(textCount).toBe(2);

      const strings = getStrings(binary);
      expect(strings).toContain('Active');
      expect(strings).toContain('Inactive');
    });

    it('emits h() call tree in ternary branches', () => {
      const binary = walkAndEmit(
        `h('div', null, () => loading() ? h('span', null, 'Loading...') : h('p', null, 'Done'))`,
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_SHOW_IF);
      expect(opList).toContain(OP_SHOW_ELSE);

      // Both branches should have OPEN_TAG + TEXT + CLOSE_TAG
      const openCount = opList.filter(op => op === OP_OPEN_TAG).length;
      // Outer div + 2 branch elements = 3
      expect(openCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 5: Non-ternary arrow → DYN_TEXT
  // -------------------------------------------------------------------------

  describe('Rule 5: Non-ternary arrow children', () => {
    it('emits DYN_TEXT for non-ternary arrow', () => {
      const binary = walkAndEmit(`h('span', null, () => email())`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_DYN_TEXT);
    });

    it('emits DYN_TEXT for arrow calling a signal', () => {
      const binary = walkAndEmit(`h('div', null, () => count())`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_DYN_TEXT);
      // Should NOT be SHOW_IF since it's not a ternary
      expect(opList).not.toContain(OP_SHOW_IF);
    });

    it('reuses pre-registered signal slot from signalSlots', () => {
      const ctx = new IrEmitContext();
      // Pre-register 'email' signal as slot 0
      const preSlotId = ctx.addSlot('email', 0x01, 0x01, new TextEncoder().encode(''));
      expect(preSlotId).toBe(0);

      const signalSlots = new Map<string, number>();
      signalSlots.set('email', preSlotId);

      const expr = parseExpr(`h('div', null, () => email())`);
      if (t.isCallExpression(expr)) {
        walkHTree(expr, 'h', ctx, { signalSlots });
      }
      const binary = ctx.toBinary();
      const opcodes = extractOpcodeSection(binary);

      // Find the DYN_TEXT opcode and read its slot_id
      let pos = 0;
      let dynSlotId = -1;
      while (pos < opcodes.length) {
        const op = opcodes[pos]!;
        if (op === OP_DYN_TEXT) {
          dynSlotId = readU16LE(opcodes, pos + 1);
          break;
        }
        if (op === OP_OPEN_TAG || op === OP_VOID_TAG) {
          pos += 1 + 4;
          const attrCount = readU16LE(opcodes, pos);
          pos += 2 + attrCount * 8;
        } else if (op === OP_CLOSE_TAG || op === OP_TEXT) {
          pos += 1 + 4;
        } else if (op === OP_DYN_ATTR) {
          pos += 1 + 4 + 2;
        } else {
          pos += 1;
        }
      }

      // The DYN_TEXT should reuse slot 0 (the pre-registered email slot)
      expect(dynSlotId).toBe(preSlotId);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 6: Function-valued props → DYN_ATTR
  // -------------------------------------------------------------------------

  describe('Rule 6: Function-valued props', () => {
    it('emits DYN_ATTR for function-valued prop', () => {
      const binary = walkAndEmit(
        `h('input', { type: () => showPassword() ? 'text' : 'password' })`,
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_DYN_ATTR);
    });

    it('includes dynamic attr key in string table', () => {
      const binary = walkAndEmit(
        `h('div', { class: () => isActive() ? 'active' : 'inactive' })`,
      );
      const strings = getStrings(binary);
      expect(strings).toContain('class');
    });
  });

  // -------------------------------------------------------------------------
  // Rule 7: on* event handlers → skip
  // -------------------------------------------------------------------------

  describe('Rule 7: Event handlers skipped', () => {
    it('skips onClick handler', () => {
      const binary = walkAndEmit(
        `h('button', { onClick: () => startOAuth('google'), class: 'btn' }, 'Sign in')`,
      );
      const strings = getStrings(binary);

      // 'onClick' should NOT be in the string table
      expect(strings).not.toContain('onClick');

      // 'class' and 'btn' should be present
      expect(strings).toContain('class');
      expect(strings).toContain('btn');
    });

    it('skips onSubmit handler', () => {
      const binary = walkAndEmit(
        `h('form', { onSubmit: handleRegister, id: 'reg-form' })`,
      );
      const strings = getStrings(binary);
      expect(strings).not.toContain('onSubmit');
      expect(strings).toContain('id');
      expect(strings).toContain('reg-form');
    });

    it('does not skip "on" or "one" props (must be on + uppercase)', () => {
      const binary = walkAndEmit(
        `h('div', { one: 'val', on: 'test' })`,
      );
      const strings = getStrings(binary);
      // These are NOT event handlers (no uppercase after "on")
      expect(strings).toContain('one');
      expect(strings).toContain('on');
    });
  });

  // -------------------------------------------------------------------------
  // Rule 8: createShow() → SHOW_IF
  // -------------------------------------------------------------------------

  describe('Rule 8: createShow', () => {
    it('emits SHOW_IF for createShow call', () => {
      const binary = walkCallAndEmit(
        `createShow(() => hasOAuth, () => h('div', { class: 'oauth-actions' }, 'OAuth'))`,
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_SHOW_IF);
      expect(opList).toContain(OP_SHOW_ELSE);
    });

    it('emits then-branch content for createShow', () => {
      const binary = walkCallAndEmit(
        `createShow(() => visible, () => h('span', null, 'Visible'))`,
      );
      const strings = getStrings(binary);
      expect(strings).toContain('span');
      expect(strings).toContain('Visible');
    });

    it('emits else-branch content when provided', () => {
      const binary = walkCallAndEmit(
        `createShow(() => loggedIn, () => h('div', null, 'Welcome'), () => h('div', null, 'Please login'))`,
      );
      const strings = getStrings(binary);
      expect(strings).toContain('Welcome');
      expect(strings).toContain('Please login');
    });
  });

  // -------------------------------------------------------------------------
  // Rule 9: Spread .map() unroll
  // -------------------------------------------------------------------------

  describe('Rule 9: Spread .map() unroll', () => {
    it('unrolls static .map() with fileConstants', () => {
      const fileConstants = new Map<string, any[]>();
      fileConstants.set('CAPABILITIES', [
        { title: 'Multi-Tenant Auth', description: 'Isolated tenants' },
        { title: 'JWT Tokens', description: 'EdDSA signed' },
      ]);

      const binary = walkAndEmit(
        `h('div', null, ...CAPABILITIES.map((cap) => h('div', { class: 'cap-card' }, h('h3', null, cap.title))))`,
        { fileConstants },
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      const strings = getStrings(binary);

      // Should have unrolled: each item's title appears as TEXT
      expect(strings).toContain('Multi-Tenant Auth');
      expect(strings).toContain('JWT Tokens');

      // Count TEXT opcodes — should be 2 (one per item)
      const textCount = opList.filter(op => op === OP_TEXT).length;
      expect(textCount).toBe(2);

      // Should NOT contain ISLAND markers
      expect(opList).not.toContain(OP_ISLAND_START);
    });

    it('emits island for .map() without fileConstants', () => {
      const binary = walkAndEmit(
        `h('div', null, ...items.map((item) => h('div', null, item.name)))`,
        { fileConstants: new Map() },
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_ISLAND_START);
      expect(opList).toContain(OP_ISLAND_END);
    });

    it('emits island for spread without .map()', () => {
      const binary = walkAndEmit(
        `h('div', null, ...children)`,
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_ISLAND_START);
      expect(opList).toContain(OP_ISLAND_END);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 10: Sub-component calls
  // -------------------------------------------------------------------------

  describe('Rule 10: Sub-component calls', () => {
    it('follows sub-component with resolveComponent', () => {
      const resolveComponent = (name: string) => {
        if (name === 'Alert') {
          return {
            source: `export function Alert() { return h('div', { class: 'alert' }, 'Alert message'); }`,
            functionName: 'Alert',
          };
        }
        return null;
      };

      const binary = walkAndEmit(
        `h('div', null, Alert({ variant: 'error' }))`,
        { resolveComponent },
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      // Should have the inner Alert content
      const strings = getStrings(binary);
      expect(strings).toContain('alert');
      expect(strings).toContain('Alert message');

      // The inner div should be OPEN_TAG + TEXT + CLOSE_TAG
      // Plus the outer div
      const openCount = opList.filter(op => op === OP_OPEN_TAG).length;
      expect(openCount).toBe(2); // outer div + alert div
    });

    it('emits island when resolveComponent returns null', () => {
      const resolveComponent = (_name: string) => null;

      const binary = walkAndEmit(
        `h('div', null, UnknownComponent())`,
        { resolveComponent },
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_ISLAND_START);
      expect(opList).toContain(OP_ISLAND_END);
    });

    it('emits island when no resolveComponent provided', () => {
      const binary = walkAndEmit(`h('div', null, SomeComponent())`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_ISLAND_START);
      expect(opList).toContain(OP_ISLAND_END);
    });

    it('emits island when depth exceeded', () => {
      const resolveComponent = (name: string) => {
        if (name === 'Deep') {
          return {
            source: `export function Deep() { return h('span', null, 'deep'); }`,
            functionName: 'Deep',
          };
        }
        return null;
      };

      const binary = walkAndEmit(
        `h('div', null, Deep())`,
        { resolveComponent, depth: 3 }, // already at max depth
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_ISLAND_START);
      expect(opList).toContain(OP_ISLAND_END);
    });

    it('detects cycles and emits island', () => {
      const resolveComponent = (name: string) => {
        if (name === 'Recursive') {
          return {
            source: `export function Recursive() { return h('div', null, Recursive()); }`,
            functionName: 'Recursive',
          };
        }
        return null;
      };

      const binary = walkAndEmit(
        `h('div', null, Recursive())`,
        { resolveComponent, visited: new Set(['Recursive']) },
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_ISLAND_START);
    });

    it('emits island when sub-component props contain non-static values', () => {
      const resolveComponent = (name: string) => {
        if (name === 'Alert') {
          return {
            source: `export function Alert(props) { return h('div', { class: 'alert' }, 'msg'); }`,
            functionName: 'Alert',
          };
        }
        return null;
      };

      // 'error' is an identifier (signal reference), not a string literal
      const binary = walkAndEmit(
        `h('div', null, Alert({ message: error, variant: 'error' }))`,
        { resolveComponent },
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      // Should bail to island because 'message: error' is a non-static prop
      expect(opList).toContain(OP_ISLAND_START);
      expect(opList).toContain(OP_ISLAND_END);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 11: Unknown → ISLAND_START / ISLAND_END
  // -------------------------------------------------------------------------

  describe('Rule 11: Unknown expressions', () => {
    it('emits ISLAND for computed tag name', () => {
      const expr = parseExpr(`h(tagName, null, 'text')`);
      const ctx = new IrEmitContext();
      if (t.isCallExpression(expr)) {
        walkHTree(expr, 'h', ctx, {});
      }
      const binary = ctx.toBinary();
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_ISLAND_START);
      expect(opList).toContain(OP_ISLAND_END);
    });

    it('emits ISLAND for unknown call in child position', () => {
      const binary = walkAndEmit(`h('div', null, someFunction())`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      // The outer div emits, but the child is an island
      expect(opList).toContain(OP_ISLAND_START);
      expect(opList).toContain(OP_ISLAND_END);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 12: Null/undefined/false → skip
  // -------------------------------------------------------------------------

  describe('Rule 12: Null/undefined/false skip', () => {
    it('skips null children', () => {
      const binary = walkAndEmit(`h('div', null, null, 'text')`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      // Should be: OPEN_TAG, TEXT, CLOSE_TAG — no output for null
      expect(opList).toEqual([OP_OPEN_TAG, OP_TEXT, OP_CLOSE_TAG]);
    });

    it('skips undefined children', () => {
      const binary = walkAndEmit(`h('div', null, undefined, 'text')`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toEqual([OP_OPEN_TAG, OP_TEXT, OP_CLOSE_TAG]);
    });

    it('skips false children', () => {
      const binary = walkAndEmit(`h('div', null, false, 'text')`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toEqual([OP_OPEN_TAG, OP_TEXT, OP_CLOSE_TAG]);
    });

    it('does not skip true children (emits as island/dyn)', () => {
      const binary = walkAndEmit(`h('div', null, true)`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      // true is not nullish, so it should produce something (island for unknown literal)
      expect(opList.length).toBeGreaterThan(2); // more than just OPEN+CLOSE
    });
  });

  // -------------------------------------------------------------------------
  // walkCallExpression
  // -------------------------------------------------------------------------

  describe('walkCallExpression', () => {
    it('handles h() calls by delegating to walkHTree', () => {
      const binary = walkCallAndEmit(`h('div', { class: 'test' }, 'Hello')`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toEqual([OP_OPEN_TAG, OP_TEXT, OP_CLOSE_TAG]);
    });

    it('handles unknown function as island', () => {
      const binary = walkCallAndEmit(`unknownFunc()`);
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_ISLAND_START);
      expect(opList).toContain(OP_ISLAND_END);
    });
  });

  // -------------------------------------------------------------------------
  // Integration / combined rules
  // -------------------------------------------------------------------------

  describe('Combined rules', () => {
    it('handles a realistic component structure', () => {
      const binary = walkAndEmit(
        `h('div', { class: 'card' },
          h('h1', null, 'Title'),
          h('input', { type: 'email', placeholder: 'Enter email' }),
          h('p', null, () => message()),
          h('button', { onClick: handleClick, class: 'btn' }, 'Submit')
        )`,
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      // Should contain various opcode types
      expect(opList).toContain(OP_OPEN_TAG);   // div, h1, p, button
      expect(opList).toContain(OP_TEXT);        // 'Title', 'Submit'
      expect(opList).toContain(OP_VOID_TAG);   // input
      expect(opList).toContain(OP_DYN_TEXT);   // () => message()
      expect(opList).toContain(OP_CLOSE_TAG);  // closing tags

      const strings = getStrings(binary);
      // onClick should NOT be in string table
      expect(strings).not.toContain('onClick');
      // But 'class' and 'btn' from button should be
      expect(strings).toContain('class');
      expect(strings).toContain('btn');
    });

    it('handles mixed static and dynamic attributes', () => {
      const binary = walkAndEmit(
        `h('div', { class: 'static', style: () => dynamicStyle() }, 'Content')`,
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      expect(opList).toContain(OP_OPEN_TAG);
      expect(opList).toContain(OP_DYN_ATTR);
      expect(opList).toContain(OP_TEXT);

      const strings = getStrings(binary);
      expect(strings).toContain('class');
      expect(strings).toContain('static');
      expect(strings).toContain('style');
    });

    it('handles deeply nested structure', () => {
      const binary = walkAndEmit(
        `h('div', null,
          h('section', null,
            h('article', null,
              h('p', null, 'Deep content')
            )
          )
        )`,
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      // 4 open tags + 1 text + 4 close tags = 9 opcodes
      expect(opList).toEqual([
        OP_OPEN_TAG,  // div
        OP_OPEN_TAG,  // section
        OP_OPEN_TAG,  // article
        OP_OPEN_TAG,  // p
        OP_TEXT,      // 'Deep content'
        OP_CLOSE_TAG, // p
        OP_CLOSE_TAG, // article
        OP_CLOSE_TAG, // section
        OP_CLOSE_TAG, // div
      ]);
    });
  });

  // =========================================================================
  // DYN_ATTR SSR defaults — evaluating expressions with signal defaults
  // =========================================================================

  describe('DYN_ATTR SSR defaults', () => {
    const TYPE_TEXT = 0x01;
    const SOURCE_CLIENT = 0x01;

    function extractSlotDefaults(binary: Uint8Array): Array<{ name: string; default: string }> {
      // Parse string table
      const stringsOffset = readU32LE(binary, 24); // Section 1 (Strings) offset
      const strData = binary.slice(stringsOffset);
      const strCount = readU32LE(strData, 0); // string count is u32
      const strings: string[] = [];
      let spos = 4; // skip u32 count
      for (let i = 0; i < strCount; i++) {
        const slen = readU16LE(strData, spos);
        spos += 2;
        strings.push(new TextDecoder().decode(strData.slice(spos, spos + slen)));
        spos += slen;
      }

      // Parse slot table
      const slotsOffset = readU32LE(binary, 32); // Section 2 (Slots) offset
      const slotData = binary.slice(slotsOffset);
      const slotCount = readU16LE(slotData, 0);
      const results: Array<{ name: string; default: string }> = [];
      let pos = 2;
      for (let i = 0; i < slotCount; i++) {
        const slotId = readU16LE(slotData, pos);
        const nameStrIdx = readU32LE(slotData, pos + 2);
        const typeHint = slotData[pos + 6]!;
        const source = slotData[pos + 7]!;
        const defaultLen = readU16LE(slotData, pos + 8);
        const defaultBytes = slotData.slice(pos + 10, pos + 10 + defaultLen);
        const name = strings[nameStrIdx] || `?${nameStrIdx}`;
        const defaultStr = new TextDecoder().decode(defaultBytes);
        results.push({ name, default: defaultStr });
        pos += 10 + defaultLen;
      }
      return results;
    }

    it('computes default for ternary: showPassword() ? text : password', () => {
      const ctx = new IrEmitContext();
      const signalDefaults = new Map([
        ['showPassword', { type: 'bool', default: false as boolean | string | number | null }],
      ]);
      const signalSlots = new Map<string, number>();
      signalSlots.set('showPassword', ctx.addSlot('showPassword', 0x02, SOURCE_CLIENT, new TextEncoder().encode('false')));

      const expr = parseExpr(`h('input', { type: () => showPassword() ? 'text' : 'password' })`);
      if (t.isCallExpression(expr)) {
        walkHTree(expr, 'h', ctx, { signalSlots, signalDefaults });
      }
      const binary = ctx.toBinary();
      const slots = extractSlotDefaults(binary);

      const typeSlot = slots.find(s => s.name === 'attr:type');
      expect(typeSlot).toBeDefined();
      expect(typeSlot!.default).toBe('password');
    });

    it('computes default for concatenation: mfa-panel + hidden', () => {
      const ctx = new IrEmitContext();
      const signalDefaults = new Map([
        ['showMfa', { type: 'bool', default: false as boolean | string | number | null }],
      ]);
      const signalSlots = new Map<string, number>();
      signalSlots.set('showMfa', ctx.addSlot('showMfa', 0x02, SOURCE_CLIENT, new TextEncoder().encode('false')));

      const expr = parseExpr(`h('section', { class: () => 'mfa-panel' + (showMfa() ? '' : ' hidden') })`);
      if (t.isCallExpression(expr)) {
        walkHTree(expr, 'h', ctx, { signalSlots, signalDefaults });
      }
      const binary = ctx.toBinary();
      const slots = extractSlotDefaults(binary);

      const classSlot = slots.find(s => s.name === 'attr:class');
      expect(classSlot).toBeDefined();
      expect(classSlot!.default).toBe('mfa-panel hidden');
    });

    it('computes default for caps lock warning class', () => {
      const ctx = new IrEmitContext();
      const signalDefaults = new Map([
        ['capsLock', { type: 'bool', default: false as boolean | string | number | null }],
      ]);
      const signalSlots = new Map<string, number>();
      signalSlots.set('capsLock', ctx.addSlot('capsLock', 0x02, SOURCE_CLIENT, new TextEncoder().encode('false')));

      const expr = parseExpr(`h('div', { class: () => 'field-hint field-hint--danger' + (capsLock() ? '' : ' hidden') })`);
      if (t.isCallExpression(expr)) {
        walkHTree(expr, 'h', ctx, { signalSlots, signalDefaults });
      }
      const binary = ctx.toBinary();
      const slots = extractSlotDefaults(binary);

      const classSlot = slots.find(s => s.name === 'attr:class');
      expect(classSlot).toBeDefined();
      expect(classSlot!.default).toBe('field-hint field-hint--danger hidden');
    });

    it('stores empty default when expression cannot be evaluated', () => {
      const ctx = new IrEmitContext();
      const signalDefaults = new Map<string, { type: string; default: boolean | string | number | null }>();

      const expr = parseExpr(`h('div', { class: () => computeClass(a, b) })`);
      if (t.isCallExpression(expr)) {
        walkHTree(expr, 'h', ctx, { signalSlots: new Map(), signalDefaults });
      }
      const binary = ctx.toBinary();
      const slots = extractSlotDefaults(binary);

      const classSlot = slots.find(s => s.name === 'attr:class');
      expect(classSlot).toBeDefined();
      expect(classSlot!.default).toBe('');
    });

    it('computes default for aria-label ternary', () => {
      const ctx = new IrEmitContext();
      const signalDefaults = new Map([
        ['showPassword', { type: 'bool', default: false as boolean | string | number | null }],
      ]);
      const signalSlots = new Map<string, number>();
      signalSlots.set('showPassword', ctx.addSlot('showPassword', 0x02, SOURCE_CLIENT, new TextEncoder().encode('false')));

      const expr = parseExpr(`h('button', { 'aria-label': () => showPassword() ? 'Hide password' : 'Show password' })`);
      if (t.isCallExpression(expr)) {
        walkHTree(expr, 'h', ctx, { signalSlots, signalDefaults });
      }
      const binary = ctx.toBinary();
      const slots = extractSlotDefaults(binary);

      const ariaSlot = slots.find(s => s.name === 'attr:aria-label');
      expect(ariaSlot).toBeDefined();
      expect(ariaSlot!.default).toBe('Show password');
    });
  });

  // -------------------------------------------------------------------------
  // Fragment handling
  // -------------------------------------------------------------------------

  describe('Fragment handling', () => {
    it('emits children inline at root level without wrapper', () => {
      const binary = walkAndEmit(
        `h(Fragment, null, h('div', null, 'A'), h('span', null, 'B'))`,
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      // Should emit: OPEN_TAG div, TEXT A, CLOSE_TAG, OPEN_TAG span, TEXT B, CLOSE_TAG
      // No Fragment wrapper
      expect(opList).toEqual([
        OP_OPEN_TAG,  // div
        OP_TEXT,      // 'A'
        OP_CLOSE_TAG, // div
        OP_OPEN_TAG,  // span
        OP_TEXT,      // 'B'
        OP_CLOSE_TAG, // span
      ]);

      const strings = getStrings(binary);
      expect(strings).toContain('div');
      expect(strings).toContain('span');
      expect(strings).toContain('A');
      expect(strings).toContain('B');
    });

    it('emits Fragment children nested inside h() tree', () => {
      const binary = walkAndEmit(
        `h('main', null, h(Fragment, null, h('p', null, 'X'), h('p', null, 'Y')))`,
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      // main contains both p elements directly (Fragment is transparent)
      expect(opList).toEqual([
        OP_OPEN_TAG,  // main
        OP_OPEN_TAG,  // p
        OP_TEXT,      // 'X'
        OP_CLOSE_TAG, // p
        OP_OPEN_TAG,  // p
        OP_TEXT,      // 'Y'
        OP_CLOSE_TAG, // p
        OP_CLOSE_TAG, // main
      ]);

      const strings = getStrings(binary);
      expect(strings).toContain('main');
      expect(strings).toContain('p');
      expect(strings).toContain('X');
      expect(strings).toContain('Y');
    });
  });

  // -------------------------------------------------------------------------
  // Depth limit
  // -------------------------------------------------------------------------

  describe('depth limit', () => {
    it('inlines component at depth 2', () => {
      const resolveComponent = (name: string) => {
        if (name === 'B') {
          return {
            source: `export function B() { return h('div', { class: 'inner' }, 'from-B'); }`,
            functionName: 'B',
          };
        }
        return null;
      };

      // Start at depth 2 — max is 3, so this should still inline
      const binary = walkAndEmit(
        `h('div', null, B())`,
        { resolveComponent, depth: 2 },
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);
      const strings = getStrings(binary);

      // The inner div from B should be inlined
      expect(strings).toContain('inner');
      expect(strings).toContain('from-B');

      // Two OPEN_TAGs: outer div + inner div from B
      const openCount = opList.filter(op => op === OP_OPEN_TAG).length;
      expect(openCount).toBe(2);

      // Should NOT contain island markers
      expect(opList).not.toContain(OP_ISLAND_START);
    });

    it('detects circular reference and emits island without infinite loop', () => {
      const resolveComponent = (name: string) => {
        if (name === 'A') {
          return {
            source: `export function A() { return h('div', null, B()); }`,
            functionName: 'A',
          };
        }
        if (name === 'B') {
          return {
            source: `export function B() { return h('div', null, A()); }`,
            functionName: 'B',
          };
        }
        return null;
      };

      // A calls B, B calls A — cycle should be detected
      const binary = walkAndEmit(
        `h('div', null, A())`,
        { resolveComponent },
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);

      // Should contain island markers (for the cycled component)
      expect(opList).toContain(OP_ISLAND_START);
      expect(opList).toContain(OP_ISLAND_END);
    });
  });

  // -------------------------------------------------------------------------
  // Block-body component (createEffect + return)
  // -------------------------------------------------------------------------

  describe('Block-body component resolution', () => {
    it('only walks the return h() tree, ignoring createEffect', () => {
      const resolveComponent = (name: string) => {
        if (name === 'Counter') {
          return {
            source: `export function Counter() {
              createEffect(() => { console.log('effect'); });
              return h('div', { class: 'counter' }, 'Count');
            }`,
            functionName: 'Counter',
          };
        }
        return null;
      };

      const binary = walkAndEmit(
        `h('main', null, Counter())`,
        { resolveComponent },
      );
      const opcodes = extractOpcodeSection(binary);
      const opList = parseOpcodeList(opcodes);
      const strings = getStrings(binary);

      // The return's h() tree should be walked
      expect(strings).toContain('counter');
      expect(strings).toContain('Count');

      // Two OPEN_TAGs: outer main + inner div from Counter
      const openCount = opList.filter(op => op === OP_OPEN_TAG).length;
      expect(openCount).toBe(2);

      // Should NOT contain island markers — the component is fully static
      expect(opList).not.toContain(OP_ISLAND_START);
    });
  });
});

/**
 * Island Registry Tests
 *
 * Verifies that:
 * 1. emitIsland() registers islands in the island table (non-empty binary)
 * 2. IrEmitContext.getIslands() returns correct island metadata
 * 3. Named islands use the given name; unnamed islands get generated names
 * 4. Island table binary format is correct and parseable
 * 5. generateRealIr returns island info alongside binary
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IrEmitContext } from '../src/ir-emit';
import { walkHTree, walkCallExpression, type WalkContext } from '../src/ir-walk';
import { generateRealIr } from '../src/esbuild-ssr-plugin';
import { parse } from '@babel/parser';
import type * as T from '@babel/types';
import * as t from '@babel/types';

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

/** Parse island table from binary, given access to the string table. */
function readIslandTable(data: Uint8Array, offset: number, strings: string[]): Array<{
  id: number;
  trigger: number;
  propsMode: number;
  name: string;
  byteOffset: number;
  slotIds: number[];
}> {
  const count = readU16LE(data, offset);
  const islands: Array<{ id: number; trigger: number; propsMode: number; name: string; byteOffset: number; slotIds: number[] }> = [];
  let pos = offset + 2;
  for (let i = 0; i < count; i++) {
    const id = readU16LE(data, pos); pos += 2;
    const trigger = data[pos]!; pos += 1;
    const propsMode = data[pos]!; pos += 1;
    const nameStrIdx = readU32LE(data, pos); pos += 4;
    const byteOffset = readU32LE(data, pos); pos += 4;
    const slotCount = readU16LE(data, pos); pos += 2;
    const slotIds: number[] = [];
    for (let j = 0; j < slotCount; j++) {
      slotIds.push(readU16LE(data, pos)); pos += 2;
    }
    islands.push({
      id,
      trigger,
      propsMode,
      name: strings[nameStrIdx] || `island_${id}`,
      byteOffset,
      slotIds,
    });
  }
  return islands;
}

/** Parse the slot table (v2) from binary, given access to the string table. */
function readSlotTable(data: Uint8Array, offset: number, strings: string[]): Array<{ id: number; name: string; typeHint: number; default: string }> {
  const count = readU16LE(data, offset);
  const slots: Array<{ id: number; name: string; typeHint: number; default: string }> = [];
  let pos = offset + 2;
  for (let i = 0; i < count; i++) {
    const id = readU16LE(data, pos); pos += 2;
    const nameStrIdx = readU32LE(data, pos); pos += 4;
    const typeHint = data[pos]!; pos += 1;
    pos += 1; // source(u8)
    const defaultLen = readU16LE(data, pos); pos += 2;
    const defaultStr = new TextDecoder().decode(data.slice(pos, pos + defaultLen));
    pos += defaultLen;
    slots.push({ id, name: strings[nameStrIdx] || '', typeHint, default: defaultStr });
  }
  return slots;
}

function walkAndEmit(code: string, walkCtx: WalkContext = {}): Uint8Array {
  const expr = parseExpr(code);
  const ctx = new IrEmitContext();
  if (t.isCallExpression(expr)) {
    walkHTree(expr, 'h', ctx, walkCtx);
  }
  return ctx.toBinary();
}

function walkAndEmitWithContext(code: string, walkCtx: WalkContext = {}): { binary: Uint8Array; ctx: IrEmitContext } {
  const expr = parseExpr(code);
  const ctx = new IrEmitContext();
  if (t.isCallExpression(expr)) {
    walkHTree(expr, 'h', ctx, walkCtx);
  }
  return { binary: ctx.toBinary(), ctx };
}

function walkCallAndEmitWithContext(code: string, walkCtx: WalkContext = {}): { binary: Uint8Array; ctx: IrEmitContext } {
  const expr = parseExpr(code);
  const ctx = new IrEmitContext();
  if (t.isCallExpression(expr)) {
    walkCallExpression(expr, 'h', ctx, walkCtx);
  }
  return { binary: ctx.toBinary(), ctx };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Island Registry', () => {
  // -------------------------------------------------------------------------
  // Part 1: emitIsland() registers islands in the table
  // -------------------------------------------------------------------------

  describe('emitIsland registers islands in island table', () => {
    it('unknown expression child produces non-empty island table', () => {
      const binary = walkAndEmit(`h('div', null, someFunction())`);
      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);
      const islands = readIslandTable(binary, sections.islandTableOffset, strings);

      expect(islands.length).toBe(1);
      expect(islands[0]!.id).toBe(0);
      expect(islands[0]!.trigger).toBe(1); // Load (0x01)
      expect(islands[0]!.propsMode).toBe(1); // Inline (0x01)
    });

    it('multiple islands produce multiple entries in island table', () => {
      // two unknown function calls -> two islands
      const binary = walkAndEmit(`h('div', null, funcA(), funcB())`);
      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);
      const islands = readIslandTable(binary, sections.islandTableOffset, strings);

      expect(islands.length).toBe(2);
      expect(islands[0]!.id).toBe(0);
      expect(islands[1]!.id).toBe(1);
    });

    it('computed tag name produces island in table', () => {
      const expr = parseExpr(`h(tagName, null, 'text')`);
      const ctx = new IrEmitContext();
      if (t.isCallExpression(expr)) {
        walkHTree(expr, 'h', ctx, {});
      }
      const binary = ctx.toBinary();
      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);
      const islands = readIslandTable(binary, sections.islandTableOffset, strings);

      expect(islands.length).toBe(1);
    });

    it('spread without .map() produces island in table', () => {
      const binary = walkAndEmit(`h('div', null, ...children)`);
      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);
      const islands = readIslandTable(binary, sections.islandTableOffset, strings);

      expect(islands.length).toBe(1);
    });

    it('static content produces empty island table', () => {
      const binary = walkAndEmit(`h('div', { class: 'hero' }, 'Hello')`);
      const sections = readSections(binary);
      const islandCount = readU16LE(binary, sections.islandTableOffset);

      expect(islandCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Part 2: Named islands for sub-components (Rule 10)
  // -------------------------------------------------------------------------

  describe('named islands for sub-components', () => {
    it('unresolved component uses component name as island name', () => {
      const { ctx } = walkAndEmitWithContext(
        `h('div', null, MyComponent())`,
      );
      const islands = ctx.getIslands();

      expect(islands.length).toBe(1);
      expect(islands[0]!.name).toBe('MyComponent');
    });

    it('component with non-static props uses component name', () => {
      const resolveComponent = (name: string) => {
        if (name === 'Alert') {
          return {
            source: `export function Alert(props) { return h('div', null, 'msg'); }`,
            functionName: 'Alert',
          };
        }
        return null;
      };

      const { ctx } = walkAndEmitWithContext(
        `h('div', null, Alert({ message: error, variant: 'error' }))`,
        { resolveComponent },
      );
      const islands = ctx.getIslands();

      expect(islands.length).toBe(1);
      expect(islands[0]!.name).toBe('Alert');
    });

    it('cycle-detected component uses component name', () => {
      const resolveComponent = (name: string) => {
        if (name === 'Recursive') {
          return {
            source: `export function Recursive() { return h('div', null, Recursive()); }`,
            functionName: 'Recursive',
          };
        }
        return null;
      };

      const { ctx } = walkAndEmitWithContext(
        `h('div', null, Recursive())`,
        { resolveComponent, visited: new Set(['Recursive']) },
      );
      const islands = ctx.getIslands();

      expect(islands.length).toBe(1);
      expect(islands[0]!.name).toBe('Recursive');
    });

    it('depth-exceeded component uses component name', () => {
      const resolveComponent = (name: string) => {
        if (name === 'Deep') {
          return {
            source: `export function Deep() { return h('span', null, 'deep'); }`,
            functionName: 'Deep',
          };
        }
        return null;
      };

      const { ctx } = walkAndEmitWithContext(
        `h('div', null, Deep())`,
        { resolveComponent, depth: 3 },
      );
      const islands = ctx.getIslands();

      expect(islands.length).toBe(1);
      expect(islands[0]!.name).toBe('Deep');
    });

    it('resolution-failed component that returns null uses component name', () => {
      const resolveComponent = (_name: string) => null;

      const { ctx } = walkAndEmitWithContext(
        `h('div', null, UnknownComponent())`,
        { resolveComponent },
      );
      const islands = ctx.getIslands();

      expect(islands.length).toBe(1);
      expect(islands[0]!.name).toBe('UnknownComponent');
    });
  });

  // -------------------------------------------------------------------------
  // Part 3: Generated names for unknown expressions
  // -------------------------------------------------------------------------

  describe('generated names for unknown expressions', () => {
    it('identifier call expression uses function name as island name', () => {
      // When callee is an identifier, Rule 10 applies and uses the identifier name
      const { ctx } = walkCallAndEmitWithContext(`unknownFunc()`);
      const islands = ctx.getIslands();

      expect(islands.length).toBe(1);
      expect(islands[0]!.name).toBe('unknownFunc');
    });

    it('computed tag name gets generated island name', () => {
      // Non-string first arg to h() — no identifier name available
      const expr = parseExpr(`h(tagName, null, 'text')`);
      const ctx = new IrEmitContext();
      if (t.isCallExpression(expr)) {
        walkHTree(expr, 'h', ctx, {});
      }
      const islands = ctx.getIslands();

      expect(islands.length).toBe(1);
      expect(islands[0]!.name).toMatch(/^island_\d+$/);
    });

    it('multiple identifier calls use their function names', () => {
      // All identifier call expressions get their function name
      const { ctx } = walkAndEmitWithContext(`h('div', null, funcA(), funcB(), funcC())`);
      const islands = ctx.getIslands();

      expect(islands.length).toBe(3);
      expect(islands[0]!.name).toBe('funcA');
      expect(islands[1]!.name).toBe('funcB');
      expect(islands[2]!.name).toBe('funcC');
    });

    it('boolean literal child (true) gets generated island name', () => {
      // `true` is not caught by isNullish (only `false` is) and falls through
      // emitChild's catch-all to unnamed emitIsland()
      const { ctx } = walkAndEmitWithContext(`h('div', null, true)`);
      const islands = ctx.getIslands();
      expect(islands.length).toBe(1);
      expect(islands[0]!.name).toMatch(/^island_\d+$/);
    });
  });

  // -------------------------------------------------------------------------
  // Part 4: getIslands() API
  // -------------------------------------------------------------------------

  describe('getIslands() API', () => {
    it('returns empty array when no islands', () => {
      const ctx = new IrEmitContext();
      ctx.addString('div');
      ctx.emit(0x01);
      ctx.emitU32(0);
      ctx.emitU16(0);
      ctx.emit(0x02);
      ctx.emitU32(0);

      expect(ctx.getIslands()).toEqual([]);
    });

    it('returns correct metadata for manually added island', () => {
      const ctx = new IrEmitContext();
      const id = ctx.addIsland('TestComponent', 0x01, 0x01, [], 0);

      const islands = ctx.getIslands();
      expect(islands).toHaveLength(1);
      expect(islands[0]).toEqual({
        id: 0,
        name: 'TestComponent',
        trigger: 1,
        propsMode: 1,
        slotIds: [],
      });
      expect(id).toBe(0);
    });

    it('returns correct metadata for island with slot ids', () => {
      const ctx = new IrEmitContext();
      ctx.addIsland('WithSlots', 0x01, 0x01, [1, 2, 3], 0);

      const islands = ctx.getIslands();
      expect(islands[0]!.slotIds).toEqual([1, 2, 3]);
    });

    it('returns islands discovered during walk', () => {
      const { ctx } = walkAndEmitWithContext(`h('div', null, MyWidget(), someFunc())`);
      const islands = ctx.getIslands();

      expect(islands.length).toBe(2);
      // Both are identifier calls, so both get their function names
      expect(islands[0]!.name).toBe('MyWidget');
      expect(islands[1]!.name).toBe('someFunc');
    });

    it('peekNextIslandId does not increment counter', () => {
      const ctx = new IrEmitContext();

      expect(ctx.peekNextIslandId()).toBe(0);
      expect(ctx.peekNextIslandId()).toBe(0); // still 0

      ctx.addIsland('first', 0x01, 0x01, [], 0);
      expect(ctx.peekNextIslandId()).toBe(1);
      expect(ctx.peekNextIslandId()).toBe(1); // still 1

      ctx.addIsland('second', 0x01, 0x01, [], 0);
      expect(ctx.peekNextIslandId()).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Part 5: Island table binary format correctness
  // -------------------------------------------------------------------------

  describe('island table binary format', () => {
    it('island table encodes correctly in FMIR binary', () => {
      const ctx = new IrEmitContext();
      ctx.addIsland('MyIsland', 0x01, 0x01, [], 0);

      // Emit minimal opcodes
      ctx.addString('div');
      ctx.emit(0x01);
      ctx.emitU32(0);
      ctx.emitU16(0);
      ctx.emit(0x02);
      ctx.emitU32(0);

      const binary = ctx.toBinary();
      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);
      const islands = readIslandTable(binary, sections.islandTableOffset, strings);

      expect(islands.length).toBe(1);
      expect(islands[0]!.id).toBe(0);
      expect(islands[0]!.name).toBe('MyIsland');
      expect(islands[0]!.trigger).toBe(1); // Load (0x01)
      expect(islands[0]!.propsMode).toBe(1); // Inline (0x01)
      expect(islands[0]!.slotIds).toEqual([]);
    });

    it('island table with slot ids encodes correctly', () => {
      const ctx = new IrEmitContext();
      const slotId1 = ctx.addSlot('email', 0x01);
      const slotId2 = ctx.addSlot('password', 0x01);
      ctx.addIsland('FormIsland', 0x01, 0x01, [slotId1, slotId2], 0);

      // Emit minimal opcodes
      const divIdx = ctx.addString('div');
      ctx.emit(0x01);
      ctx.emitU32(divIdx);
      ctx.emitU16(0);
      ctx.emit(0x02);
      ctx.emitU32(divIdx);

      const binary = ctx.toBinary();
      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);
      const islands = readIslandTable(binary, sections.islandTableOffset, strings);

      expect(islands.length).toBe(1);
      expect(islands[0]!.name).toBe('FormIsland');
      expect(islands[0]!.slotIds).toEqual([slotId1, slotId2]);
    });

    it('island name appears in string table', () => {
      const binary = walkAndEmit(`h('div', null, SomeComponent())`);
      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);

      expect(strings).toContain('SomeComponent');
    });

    it('function name appears in string table for identifier calls', () => {
      const binary = walkAndEmit(`h('div', null, someFunc())`);
      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);

      // Identifier call uses its function name
      expect(strings).toContain('someFunc');
    });

    it('all section bounds are valid when islands are present', () => {
      const binary = walkAndEmit(`h('div', null, funcA(), MyComp())`);
      const sections = readSections(binary);

      // All sections must start at or after header+table (48 bytes)
      expect(sections.opcodeOffset).toBeGreaterThanOrEqual(48);
      expect(sections.stringTableOffset).toBeGreaterThanOrEqual(48);
      expect(sections.slotTableOffset).toBeGreaterThanOrEqual(48);
      expect(sections.islandTableOffset).toBeGreaterThanOrEqual(48);

      // All sections must end within file bounds
      expect(sections.opcodeOffset + sections.opcodeSize).toBeLessThanOrEqual(binary.length);
      expect(sections.stringTableOffset + sections.stringTableSize).toBeLessThanOrEqual(binary.length);
      expect(sections.slotTableOffset + sections.slotTableSize).toBeLessThanOrEqual(binary.length);
      expect(sections.islandTableOffset + sections.islandTableSize).toBeLessThanOrEqual(binary.length);

      // Island table should be non-trivial (more than just the count u16)
      expect(sections.islandTableSize).toBeGreaterThan(2);
    });
  });

  // -------------------------------------------------------------------------
  // Part 6: Full island content walk (SSR content inside islands)
  // -------------------------------------------------------------------------

  describe('island content walk — full component subtree in IR', () => {
    /** Simple opcode scanner: extract opcode bytes from the bytecode section. */
    function readOpcodes(binary: Uint8Array): number[] {
      const sections = readSections(binary);
      const start = sections.opcodeOffset;
      const end = start + sections.opcodeSize;
      const opcodes: number[] = [];
      let pos = start;

      while (pos < end) {
        const op = binary[pos]!;
        opcodes.push(op);
        pos += 1;

        // Skip payloads based on opcode
        switch (op) {
          case 0x01: { // OPEN_TAG: tag_str_idx(4) + attr_count(2) + attrs
            pos += 4;
            const attrCount = readU16LE(binary, pos); pos += 2;
            pos += attrCount * 8; // key(4) + val(4) per attr
            break;
          }
          case 0x02: pos += 4; break; // CLOSE_TAG: tag_str_idx(4)
          case 0x03: { // VOID_TAG: tag_str_idx(4) + attr_count(2) + attrs
            pos += 4;
            const ac = readU16LE(binary, pos); pos += 2;
            pos += ac * 8;
            break;
          }
          case 0x04: pos += 4; break; // TEXT: str_idx(4)
          case 0x05: pos += 4; break; // DYN_TEXT: slot_id(2) + marker_id(2)
          case 0x06: pos += 6; break; // DYN_ATTR: key_str_idx(4) + slot_id(2)
          case 0x07: pos += 10; break; // SHOW_IF: slot_id(2) + then_len(4) + else_len(4)
          case 0x08: break; // SHOW_ELSE: no payload
          case 0x0A: pos += 8; break; // LIST: array_slot(2) + item_slot(2) + body_len(4)
          case 0x0B: pos += 2; break; // ISLAND_START: island_id(2)
          case 0x0C: pos += 2; break; // ISLAND_END: island_id(2)
          case 0x12: pos += 8; break; // PROP: src_slot(2) + prop_str_idx(4) + target_slot(2)
          default: break; // unknown, advance 1
        }
      }
      return opcodes;
    }

    const OP = {
      OPEN_TAG: 0x01, CLOSE_TAG: 0x02, VOID_TAG: 0x03,
      TEXT: 0x04, DYN_TEXT: 0x05, DYN_ATTR: 0x06,
      SHOW_IF: 0x07, ISLAND_START: 0x0B, ISLAND_END: 0x0C,
    };

    it('resolved island emits full component subtree (not empty shell)', () => {
      const resolveComponent = (name: string) => {
        if (name === 'FilterBar') {
          return {
            source: `export function FilterBar() {
              return h('div', { class: 'filter-bar' },
                h('label', null, 'Filter:'),
                h('input', { type: 'text', placeholder: 'Search...' })
              );
            }`,
            functionName: 'FilterBar',
          };
        }
        return null;
      };

      const { binary, ctx } = walkAndEmitWithContext(
        `h('div', null, FilterBar())`,
        { resolveComponent, islandNames: new Set(['FilterBar']) },
      );

      // Island should be registered
      const islands = ctx.getIslands();
      expect(islands).toHaveLength(1);
      expect(islands[0]!.name).toBe('FilterBar');

      // String table should contain strings from inside the component
      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);
      expect(strings).toContain('filter-bar');
      expect(strings).toContain('label');
      expect(strings).toContain('Filter:');
      expect(strings).toContain('input');

      // Bytecode should have ISLAND_START, multiple OPEN_TAG/TEXT/CLOSE_TAG, ISLAND_END
      const opcodes = readOpcodes(binary);
      expect(opcodes).toContain(OP.ISLAND_START);
      expect(opcodes).toContain(OP.ISLAND_END);
      expect(opcodes).toContain(OP.TEXT); // 'Filter:' text node
      expect(opcodes).toContain(OP.VOID_TAG); // <input> is void

      // Count OPEN_TAG ops — should have outer div + filter-bar div + label = 3
      const openTags = opcodes.filter(o => o === OP.OPEN_TAG);
      expect(openTags.length).toBeGreaterThanOrEqual(3);
    });

    it('island root element matches component root tag', () => {
      const resolveComponent = (name: string) => {
        if (name === 'PerfPanel') {
          return {
            source: `export function PerfPanel() {
              return h('section', { class: 'perf-panel' }, h('h3', null, 'Performance'));
            }`,
            functionName: 'PerfPanel',
          };
        }
        return null;
      };

      const { binary } = walkAndEmitWithContext(
        `h('main', null, PerfPanel())`,
        { resolveComponent, islandNames: new Set(['PerfPanel']) },
      );

      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);

      // The island's root element should be 'section' (from component), not 'div'
      expect(strings).toContain('section');
      expect(strings).toContain('perf-panel');
      expect(strings).toContain('Performance');
    });

    it('unresolved island falls back to empty div shell', () => {
      // No resolveComponent → can't walk into component
      const { binary, ctx } = walkAndEmitWithContext(
        `h('div', null, UnknownIsland())`,
        { islandNames: new Set(['UnknownIsland']) },
      );

      const islands = ctx.getIslands();
      expect(islands).toHaveLength(1);
      expect(islands[0]!.name).toBe('UnknownIsland');

      // Bytecode should have ISLAND_START + OPEN_TAG(div) + CLOSE_TAG + ISLAND_END
      const opcodes = readOpcodes(binary);
      const islandStart = opcodes.indexOf(OP.ISLAND_START);
      const islandEnd = opcodes.indexOf(OP.ISLAND_END);
      expect(islandStart).toBeGreaterThan(-1);
      expect(islandEnd).toBeGreaterThan(islandStart);

      // Only one OPEN_TAG + CLOSE_TAG between island markers (empty shell)
      const between = opcodes.slice(islandStart + 1, islandEnd);
      const openTags = between.filter(o => o === OP.OPEN_TAG);
      const closeTags = between.filter(o => o === OP.CLOSE_TAG);
      expect(openTags.length).toBe(1);
      expect(closeTags.length).toBe(1);
      // No TEXT or VOID_TAG (empty shell)
      expect(between).not.toContain(OP.TEXT);
    });

    it('resolved island with dynamic attrs creates slots', () => {
      const resolveComponent = (name: string) => {
        if (name === 'DynIsland') {
          return {
            source: `export function DynIsland() {
              return h('div', { class: () => activeClass() },
                h('span', null, 'content')
              );
            }`,
            functionName: 'DynIsland',
          };
        }
        return null;
      };

      const { binary } = walkAndEmitWithContext(
        `h('div', null, DynIsland())`,
        { resolveComponent, islandNames: new Set(['DynIsland']) },
      );

      const opcodes = readOpcodes(binary);
      // Should have DYN_ATTR for the dynamic class
      expect(opcodes).toContain(OP.DYN_ATTR);
      // Should still have the static content
      expect(opcodes).toContain(OP.TEXT);
    });

    it('resolved island with createShow emits SHOW_IF', () => {
      const resolveComponent = (name: string) => {
        if (name === 'ConditionalIsland') {
          return {
            source: `export function ConditionalIsland() {
              return h('div', { class: 'cond' },
                createShow(() => visible(),
                  () => h('span', null, 'shown')
                )
              );
            }`,
            functionName: 'ConditionalIsland',
          };
        }
        return null;
      };

      const { binary } = walkAndEmitWithContext(
        `h('div', null, ConditionalIsland())`,
        { resolveComponent, islandNames: new Set(['ConditionalIsland']) },
      );

      const opcodes = readOpcodes(binary);
      expect(opcodes).toContain(OP.SHOW_IF);
      expect(opcodes).toContain(OP.ISLAND_START);
      expect(opcodes).toContain(OP.ISLAND_END);
    });

    it('island bytecode is larger than empty shell', () => {
      const resolveComponent = (name: string) => {
        if (name === 'BigIsland') {
          return {
            source: `export function BigIsland() {
              return h('div', { class: 'big' },
                h('h2', null, 'Title'),
                h('p', null, 'Paragraph one'),
                h('p', null, 'Paragraph two'),
                h('ul', null,
                  h('li', null, 'Item 1'),
                  h('li', null, 'Item 2')
                )
              );
            }`,
            functionName: 'BigIsland',
          };
        }
        return null;
      };

      // Full content walk
      const fullResult = walkAndEmitWithContext(
        `h('div', null, BigIsland())`,
        { resolveComponent, islandNames: new Set(['BigIsland']) },
      );
      const fullSections = readSections(fullResult.binary);

      // Empty shell (no resolveComponent)
      const emptyResult = walkAndEmitWithContext(
        `h('div', null, BigIsland())`,
        { islandNames: new Set(['BigIsland']) },
      );
      const emptySections = readSections(emptyResult.binary);

      // Full content should produce significantly more bytecode
      expect(fullSections.opcodeSize).toBeGreaterThan(emptySections.opcodeSize);
      // And more strings
      expect(fullSections.stringTableSize).toBeGreaterThan(emptySections.stringTableSize);
    });

    it('multiple islands in same page each get full content', () => {
      const resolveComponent = (name: string) => {
        if (name === 'Header') {
          return {
            source: `export function Header() { return h('header', null, h('h1', null, 'Welcome')); }`,
            functionName: 'Header',
          };
        }
        if (name === 'Footer') {
          return {
            source: `export function Footer() { return h('footer', null, h('p', null, 'Copyright')); }`,
            functionName: 'Footer',
          };
        }
        return null;
      };

      const { binary, ctx } = walkAndEmitWithContext(
        `h('div', null, Header(), Footer())`,
        { resolveComponent, islandNames: new Set(['Header', 'Footer']) },
      );

      const islands = ctx.getIslands();
      expect(islands).toHaveLength(2);
      expect(islands[0]!.name).toBe('Header');
      expect(islands[1]!.name).toBe('Footer');

      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);
      expect(strings).toContain('header');
      expect(strings).toContain('Welcome');
      expect(strings).toContain('footer');
      expect(strings).toContain('Copyright');
    });

    it('resolved island captures slot ids referenced in its subtree', () => {
      const resolveComponent = (name: string) => {
        if (name === 'StatsIsland') {
          return {
            source: `export function StatsIsland() {
              return h('div', { class: () => panelClass() },
                h('span', null, () => count()),
                createList(() => rows(), (row) => row.id, (row) => h('li', null, row.name))
              );
            }`,
            functionName: 'StatsIsland',
          };
        }
        return null;
      };

      // Outer page has its own dynamic attr slot that must NOT leak into the island
      const { binary, ctx } = walkAndEmitWithContext(
        `h('div', { id: () => outerId() }, StatsIsland())`,
        { resolveComponent, islandNames: new Set(['StatsIsland']) },
      );

      const islands = ctx.getIslands();
      expect(islands).toHaveLength(1);

      const slotIds = islands[0]!.slotIds;
      expect(slotIds.length).toBeGreaterThan(0);
      // Sorted ascending
      expect(slotIds).toEqual([...slotIds].sort((a, b) => a - b));

      // Resolve names via the module's slot table: the captured ids must be
      // exactly the slots referenced inside the island span, MINUS the
      // per-item list scratch slot (`list:rows:item`) — it holds the LAST
      // rendered row after SSR, so serializing it into data-forma-props
      // would leak that row into the page.
      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);
      const slots = readSlotTable(binary, sections.slotTableOffset, strings);
      const idsByName = new Map(slots.map(s => [s.name, s.id]));
      const expected = [
        'attr:class',      // dynamic class on the island root
        'text:0',          // signal-bound text () => count()
        'list:rows:array', // createList array slot
        'list:rows:name',  // createList extracted prop slot
      ].map(n => idsByName.get(n)!).sort((a, b) => a - b);
      expect(slotIds).toEqual(expected);
      // The page-level attr slot stays out of the island's slot ids
      expect(slotIds).not.toContain(idsByName.get('attr:id'));
      // The per-item scratch slot is filtered out of the island props set
      expect(slotIds).not.toContain(idsByName.get('list:rows:item'));

      // And the binary island table round-trips the same slot ids
      const tableIslands = readIslandTable(binary, sections.islandTableOffset, strings);
      expect(tableIslands[0]!.slotIds).toEqual(expected);
    });

    it('island slot ids include reused signal slots registered before the walk', () => {
      const resolveComponent = (name: string) => {
        if (name === 'CounterIsland') {
          return {
            source: `export function CounterIsland() {
              return h('span', null, () => count());
            }`,
            functionName: 'CounterIsland',
          };
        }
        return null;
      };

      const expr = parseExpr(`h('div', null, CounterIsland())`);
      const ctx = new IrEmitContext();
      // Pre-register the signal slot BEFORE the walk (as generateRealIr does),
      // so the island subtree reuses it without a fresh addSlot call.
      const countSlotId = ctx.addSlot('count', 0x01);
      if (t.isCallExpression(expr)) {
        walkHTree(expr, 'h', ctx, {
          resolveComponent,
          islandNames: new Set(['CounterIsland']),
          signalSlots: new Map([['count', countSlotId]]),
        });
      }

      const islands = ctx.getIslands();
      expect(islands).toHaveLength(1);
      expect(islands[0]!.slotIds).toEqual([countSlotId]);
    });

    it('unresolved island fallback keeps empty slot ids', () => {
      const { ctx } = walkAndEmitWithContext(
        `h('div', null, ShellOnly())`,
        { islandNames: new Set(['ShellOnly']) },
      );

      const islands = ctx.getIslands();
      expect(islands).toHaveLength(1);
      // Empty shell references no slots — the Rust walker skips props emission
      expect(islands[0]!.slotIds).toEqual([]);
    });

    it('nested island resolution failure keeps the slot-capture stack balanced', () => {
      // Inner is an island nested inside Outer's SSR span; a component INSIDE
      // Inner throws during resolution, so Inner falls back to the empty
      // shell. Without a balanced capture stack, Inner's leaked set would be
      // popped by Outer's endSlotCapture and Outer would record the wrong
      // (empty) slot ids.
      const resolveComponent = (name: string) => {
        if (name === 'Outer') {
          return {
            source: `export function Outer() {
              return h('div', { class: () => outerClass() },
                h('span', null, () => outerText()),
                Inner()
              );
            }`,
            functionName: 'Outer',
          };
        }
        if (name === 'Inner') {
          return {
            source: `export function Inner() { return h('div', null, Broken()); }`,
            functionName: 'Inner',
          };
        }
        if (name === 'Broken') {
          throw new Error('resolver exploded');
        }
        if (name === 'Tail') {
          return {
            source: `export function Tail() { return h('p', { id: () => tailId() }, 'tail'); }`,
            functionName: 'Tail',
          };
        }
        return null;
      };

      const { binary, ctx } = walkAndEmitWithContext(
        `h('main', null, Outer(), Tail())`,
        { resolveComponent, islandNames: new Set(['Outer', 'Inner', 'Tail']) },
      );

      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);
      const slots = readSlotTable(binary, sections.slotTableOffset, strings);
      const idsByName = new Map(slots.map(s => [s.name, s.id]));

      const islands = ctx.getIslands();
      const outer = islands.find(i => i.name === 'Outer')!;
      const tail = islands.find(i => i.name === 'Tail')!;

      // Outer still captures ITS OWN slots (dyn class + signal text), not
      // the leaked capture set of the failed nested island.
      const outerExpected = [
        idsByName.get('attr:class')!,
        idsByName.get('text:0')!,
      ].sort((a, b) => a - b);
      expect(outer.slotIds).toEqual(outerExpected);

      // The island after the failure captures exactly its own slot.
      expect(tail.slotIds).toEqual([idsByName.get('attr:id')!]);
    });

    it('resolution failure for one island does not affect others', () => {
      const resolveComponent = (name: string) => {
        if (name === 'Good') {
          return {
            source: `export function Good() { return h('div', null, 'works'); }`,
            functionName: 'Good',
          };
        }
        return null; // Bad is unresolvable
      };

      const { binary, ctx } = walkAndEmitWithContext(
        `h('div', null, Good(), Bad())`,
        { resolveComponent, islandNames: new Set(['Good', 'Bad']) },
      );

      const islands = ctx.getIslands();
      expect(islands).toHaveLength(2);

      const sections = readSections(binary);
      const strings = readStringTable(binary, sections.stringTableOffset);
      // Good island's content should be in string table
      expect(strings).toContain('works');
    });
  });
});

// ---------------------------------------------------------------------------
// generateRealIr integration: island signal default extraction (finding 9)
// ---------------------------------------------------------------------------

describe('generateRealIr island signal defaults', () => {
  const TYPE_TEXT = 0x01;
  const TYPE_BOOL = 0x02;

  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'forma-island-signals-'));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write project files into tmpDir and return the entry point path. */
  function writeProject(files: Record<string, string>): string {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(tmpDir, name), content);
    }
    return join(tmpDir, 'app.ts');
  }

  const entrySource = `
    import { activateIslands } from 'formajs';
    import { DashboardPage } from './DashboardPage';
    import { CounterIsland } from './CounterIsland';
    activateIslands({ CounterIsland });
  `;

  it('module-level island signals become named slots with correct defaults', () => {
    const entryPath = writeProject({
      'app.ts': entrySource,
      'DashboardPage.ts': `
        import { h } from 'formajs';
        import { CounterIsland } from './CounterIsland';
        export function DashboardPage() {
          return h('div', { class: 'page' }, CounterIsland());
        }
      `,
      'CounterIsland.ts': `
        import { createSignal, h } from 'formajs';
        const [pillRunning, setPillRunning] = createSignal(false);
        const [statusText, setStatusText] = createSignal('idle');
        export function CounterIsland() {
          return h('section', null, () => statusText());
        }
      `,
    });

    const result = generateRealIr(entryPath);
    expect(result).not.toBeNull();

    const sections = readSections(result!.binary);
    const strings = readStringTable(result!.binary, sections.stringTableOffset);
    const slots = readSlotTable(result!.binary, sections.slotTableOffset, strings);
    const byName = new Map(slots.map(s => [s.name, s]));

    // Slots are NAMED after the island's module-level signals, with defaults
    expect(byName.get('pillRunning')).toMatchObject({ typeHint: TYPE_BOOL, default: 'false' });
    expect(byName.get('statusText')).toMatchObject({ typeHint: TYPE_TEXT, default: 'idle' });

    // The island's dynamic text reuses the named slot — no anonymous text:N slot
    expect(slots.some(s => /^text:\d+$/.test(s.name))).toBe(false);

    // The island metadata captures the reused signal slot
    expect(result!.islands).toHaveLength(1);
    expect(result!.islands[0]!.name).toBe('CounterIsland');
    expect(result!.islands[0]!.slotIds).toContain(byName.get('statusText')!.id);
  });

  it('conflicting twin declaration warns and keeps the root default', () => {
    const entryPath = writeProject({
      'app.ts': entrySource,
      'DashboardPage.ts': `
        import { createSignal, h } from 'formajs';
        import { CounterIsland } from './CounterIsland';
        export function DashboardPage() {
          const [statusText, setStatusText] = createSignal('busy');
          return h('div', null, CounterIsland());
        }
      `,
      'CounterIsland.ts': `
        import { createSignal, h } from 'formajs';
        const [statusText, setStatusText] = createSignal('idle');
        export function CounterIsland() {
          return h('section', null, () => statusText());
        }
      `,
    });

    const result = generateRealIr(entryPath);
    expect(result).not.toBeNull();

    // Conflicting default warned about
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("signal 'statusText'"));

    // Root Page is authoritative — its default wins
    const sections = readSections(result!.binary);
    const strings = readStringTable(result!.binary, sections.stringTableOffset);
    const slots = readSlotTable(result!.binary, sections.slotTableOffset, strings);
    const statusSlots = slots.filter(s => s.name === 'statusText');
    expect(statusSlots).toHaveLength(1);
    expect(statusSlots[0]!.default).toBe('busy');
  });

  it('identical twin declaration merges silently', () => {
    const entryPath = writeProject({
      'app.ts': entrySource,
      'DashboardPage.ts': `
        import { createSignal, h } from 'formajs';
        import { CounterIsland } from './CounterIsland';
        export function DashboardPage() {
          const [statusText, setStatusText] = createSignal('idle');
          return h('div', null, CounterIsland());
        }
      `,
      'CounterIsland.ts': `
        import { createSignal, h } from 'formajs';
        const [statusText, setStatusText] = createSignal('idle');
        export function CounterIsland() {
          return h('section', null, () => statusText());
        }
      `,
    });

    const result = generateRealIr(entryPath);
    expect(result).not.toBeNull();

    // No warning for identical twin declarations (the ksx pattern)
    expect(warnSpy).not.toHaveBeenCalled();

    const sections = readSections(result!.binary);
    const strings = readStringTable(result!.binary, sections.stringTableOffset);
    const slots = readSlotTable(result!.binary, sections.slotTableOffset, strings);
    const statusSlots = slots.filter(s => s.name === 'statusText');
    expect(statusSlots).toHaveLength(1);
    expect(statusSlots[0]!.default).toBe('idle');
  });

  it('conflict between two islands warns naming the earlier island whose default won', () => {
    const entryPath = writeProject({
      'app.ts': `
        import { activateIslands } from 'formajs';
        import { DashboardPage } from './DashboardPage';
        import { AlphaIsland } from './AlphaIsland';
        import { BetaIsland } from './BetaIsland';
        activateIslands({ AlphaIsland, BetaIsland });
      `,
      'DashboardPage.ts': `
        import { h } from 'formajs';
        import { AlphaIsland } from './AlphaIsland';
        import { BetaIsland } from './BetaIsland';
        export function DashboardPage() {
          return h('div', null, AlphaIsland(), BetaIsland());
        }
      `,
      'AlphaIsland.ts': `
        import { createSignal, h } from 'formajs';
        const [shared, setShared] = createSignal('from-alpha');
        export function AlphaIsland() {
          return h('span', null, () => shared());
        }
      `,
      'BetaIsland.ts': `
        import { createSignal, h } from 'formajs';
        const [shared, setShared] = createSignal('from-beta');
        export function BetaIsland() {
          return h('em', null, () => shared());
        }
      `,
    });

    const result = generateRealIr(entryPath);
    expect(result).not.toBeNull();

    // First-wins: AlphaIsland declared 'shared' first, so its default is kept
    const sections = readSections(result!.binary);
    const strings = readStringTable(result!.binary, sections.stringTableOffset);
    const slots = readSlotTable(result!.binary, sections.slotTableOffset, strings);
    const sharedSlots = slots.filter(s => s.name === 'shared');
    expect(sharedSlots).toHaveLength(1);
    expect(sharedSlots[0]!.default).toBe('from-alpha');

    // The warning names the ACTUAL earlier declarer (AlphaIsland), not the root
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("signal 'shared' in island 'BetaIsland'"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("keeping the default from island 'AlphaIsland'"),
    );
  });

  it('inline block-body mount path merges island signal defaults', () => {
    const entryPath = writeProject({
      'app.ts': `
        import { h, mount, activateIslands } from 'formajs';
        import { CounterIsland } from './CounterIsland';
        mount(() => {
          return h('div', { class: 'shell' }, CounterIsland());
        }, '#app');
        activateIslands({ CounterIsland });
      `,
      'CounterIsland.ts': `
        import { createSignal, h } from 'formajs';
        const [statusText, setStatusText] = createSignal('idle');
        export function CounterIsland() {
          return h('section', null, () => statusText());
        }
      `,
    });

    const result = generateRealIr(entryPath);
    expect(result).not.toBeNull();

    const sections = readSections(result!.binary);
    const strings = readStringTable(result!.binary, sections.stringTableOffset);
    const slots = readSlotTable(result!.binary, sections.slotTableOffset, strings);
    const byName = new Map(slots.map(s => [s.name, s]));

    // The island's module-level signal becomes a named slot with its default
    expect(byName.get('statusText')).toMatchObject({ typeHint: TYPE_TEXT, default: 'idle' });

    // The island registers via the inline path and captures the reused slot
    expect(result!.islands).toHaveLength(1);
    expect(result!.islands[0]!.name).toBe('CounterIsland');
    expect(result!.islands[0]!.slotIds).toContain(byName.get('statusText')!.id);
  });

  it('unresolvable island source warns and skips without failing', () => {
    const entryPath = writeProject({
      'app.ts': `
        import { activateIslands } from 'formajs';
        import { DashboardPage } from './DashboardPage';
        import { GhostIsland } from './GhostIsland';
        activateIslands({ GhostIsland });
      `,
      'DashboardPage.ts': `
        import { h } from 'formajs';
        import { GhostIsland } from './GhostIsland';
        export function DashboardPage() {
          return h('div', null, GhostIsland());
        }
      `,
      // GhostIsland.ts intentionally missing
    });

    const result = generateRealIr(entryPath);
    expect(result).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('GhostIsland'));
  });
});

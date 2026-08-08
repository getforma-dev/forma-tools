/**
 * Forma Compiler — Signal Scopes
 *
 * ONE answer to "which signals are visible here, and what slot does each one
 * own?", resolved by the SAME traversal that decides which code is inlined into
 * the page.
 *
 * ## Why this module exists
 *
 * Signal defaults used to be gathered by a PRE-PASS that enumerated scopes by
 * hand — one method per shape: the root page function body, island component
 * files, inline-mount entries — and merged them into one flat
 * `Map<name, default>` before the walk started. The WALK independently decided
 * what got inlined. Every time the walk learned to inline something new, the
 * pre-pass had to be taught the same thing separately, and when it was not the
 * failure was SILENT: the signal kept its binding but lost its name, its slot
 * and its SSR default, so the server rendered a blank (or the wrong `SHOW_IF`
 * branch) where the client renders a value.
 *
 * That produced the same defect twice — "the extractor does not know about
 * island files" (dogfood finding 9) and "the extractor does not know about
 * inlined sub-components" — plus two more of the same shape (the root page
 * file's own module scope, and declarations below a scope's top level).
 *
 * The invariant that replaces the list of shapes:
 *
 *   **If the walk inlined the code, its signals are in scope. If it did not,
 *   there is nothing to name.**
 *
 * There is no second traversal to keep in sync, so a construct the walk learns
 * to inline tomorrow gets its signals for free.
 *
 * ## Scope chain
 *
 * A scope is a frame of bindings plus a parent, and the walk pushes a frame at
 * each point it enters a new lexical scope: a component's FILE (module scope)
 * and then the component FUNCTION's own body. Lookup walks outward, so an
 * inner declaration shadows an outer one — where the old flat map silently
 * resolved first-wins across unrelated files.
 *
 * ## Slot identity
 *
 * One slot per DECLARATION SITE, not per instance: a component inlined (or
 * islanded) twice shares its signals' slots. Their SSR defaults are identical
 * by construction — the default is a literal in the source — and name-addressed
 * injection therefore reaches every instance rather than only the first.
 * Frames are memoized on `<parent key>><file>#<scope>` for exactly that reason.
 */

import type * as T from '@babel/types';
import * as t from '@babel/types';

import {
  IrEmitContext,
  SLOT_SOURCE_CLIENT,
  SLOT_TYPE_BOOL,
  SLOT_TYPE_NUMBER,
  SLOT_TYPE_TEXT,
} from './ir-emit.js';
import {
  readImportBindings,
  resolveExportedSignal,
  type ComponentFunction,
  type SignalExportLookup,
} from './export-resolver.js';
import { dirname } from 'node:path';

import { nestedScopeBindings } from './component-analyzer.js';
import type { ModuleLoader } from './module-loader.js';
import { uniqueName } from './utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The statically evaluated initial value of a `createSignal(...)`. */
export interface SignalDefault {
  type: 'text' | 'bool' | 'number' | 'null';
  default: string | boolean | number | null;
}

/** A signal the walk found in scope, and the slot minted for it. */
export interface SignalBinding {
  /** The getter name in source. */
  name: string;
  /** Page-unique slot name: `count`, then `count#2` for the next scope that
   *  declares a `count` (see the occurrence scheme in utils.uniqueName). */
  slotName: string;
  slotId: number;
  default: SignalDefault;
}

/** One lexical frame in the chain the walk is currently inside. */
export interface SignalScope {
  /** Identity of this frame, including its parent's — the memo key. */
  key: string;
  bindings: Map<string, SignalBinding>;
  parent: SignalScope | null;
}

/**
 * Page-wide state the chain needs: the occurrence counts that keep slot names
 * unique, and the memo that makes re-entering a scope reuse its slots.
 * Created once per page and shared by reference with every nested walk context.
 */
export interface SignalRegistry {
  names: Map<string, number>;
  frames: Map<string, SignalScope>;
}

export function newSignalRegistry(): SignalRegistry {
  return { names: new Map(), frames: new Map() };
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Report a signal the compiler could not turn into a named slot.
 *
 * The consequence is never obvious from the source, so it is spelled out: an
 * unresolved signal is not a missing optimisation, it is a page whose server
 * render disagrees with its client render until the signal changes value.
 * Verified by: packages/compiler/tests/ir-diagnostics.test.ts > "warns that a non-literal signal default gets no named slot"
 */
function warnSignal(filePath: string, message: string): void {
  console.warn(`   IR: ${message} (${filePath})`);
}

// ---------------------------------------------------------------------------
// Declaration collection
// ---------------------------------------------------------------------------

export interface SignalCollectOptions {
  /** File the statements came from — named in every diagnostic. */
  filePath: string;
  /** Module-level string constants of `filePath`, so a default declared once as
   *  a `const` (`createSignal(SEL_TOGGLE_OFF)`) still folds to a literal. */
  constants?: Map<string, string>;
  /** Suppress this collector's warnings. Set by the eager import scan, which
   *  reads modules whose signals may never appear on the page — a warning
   *  about a signal nobody reads is noise, and the USE site still gets its
   *  own degradation diagnostic when an unfoldable signal is actually read. */
  quiet?: boolean;
}

/**
 * Unwrap `export const x = ...` to its inner VariableDeclaration; pass bare
 * VariableDeclarations through. Module scopes hold both forms.
 */
function asVariableDeclaration(node: T.Node): T.VariableDeclaration | null {
  if (t.isVariableDeclaration(node)) return node;
  if (
    t.isExportNamedDeclaration(node)
    && node.declaration
    && t.isVariableDeclaration(node.declaration)
  ) {
    return node.declaration;
  }
  return null;
}

/**
 * Evaluate a `createSignal(...)` initial value to a `SignalDefault`.
 *
 * Literals, expression-less template literals, negative numbers (`-1` parses as
 * a UnaryExpression, not a literal), and identifiers naming a module string
 * constant. Anything else returns null and the caller reports it: a signal with
 * no evaluable default gets no named slot, and every binding to it falls back
 * to an anonymous slot the server cannot address by name.
 */
function evaluateSignalDefault(
  node: T.Expression,
  constants?: Map<string, string>,
): SignalDefault | null {
  if (t.isStringLiteral(node)) return { type: 'text', default: node.value };
  if (t.isNumericLiteral(node)) return { type: 'number', default: node.value };
  if (t.isBooleanLiteral(node)) return { type: 'bool', default: node.value };
  if (t.isNullLiteral(node)) return { type: 'null', default: null };

  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return {
      type: 'text',
      default: node.quasis.map(q => q.value.cooked ?? q.value.raw).join(''),
    };
  }

  // `-1` / `+1`: a signed numeric literal is a UnaryExpression in the AST, so
  // `createSignal(-1)` used to be rejected as "not a literal" and lost its slot.
  if (
    t.isUnaryExpression(node)
    && (node.operator === '-' || node.operator === '+')
    && t.isNumericLiteral(node.argument)
  ) {
    const value = node.operator === '-' ? -node.argument.value : node.argument.value;
    return { type: 'number', default: value };
  }

  // `createSignal(SEL_TOGGLE_OFF)` where SEL_TOGGLE_OFF is a folded module
  // string const. Declaring the default once as a const is the single-sourcing
  // callers are already doing; refusing to follow it cost them the slot.
  if (t.isIdentifier(node)) {
    const folded = constants?.get(node.name);
    if (folded !== undefined) return { type: 'text', default: folded };
  }

  if (t.isParenthesizedExpression(node)) {
    return evaluateSignalDefault(node.expression, constants);
  }

  // `createSignal(null as string | null)` — the way a store widens a signal's
  // type. Casts are erased at runtime, so the literal underneath is the
  // default; refusing to look through one cost the signal its slot.
  // (TSTypeAssertion — old-style `<T>expr` — is unreachable through this
  // compiler's own pipelines: every parse enables Babel's jsx plugin, which
  // reads `<T>` as JSX and errors before evaluation. Kept for callers that
  // parse without jsx.)
  if (
    t.isTSAsExpression(node)
    || t.isTSTypeAssertion(node)
    || t.isTSSatisfiesExpression(node)
    || t.isTSNonNullExpression(node)
  ) {
    return evaluateSignalDefault(node.expression, constants);
  }

  return null;
}

/**
 * Collect every `const [name, setName] = createSignal(<literal>)` a statement
 * list declares, INCLUDING declarations below its top level.
 *
 * Nested statement containers (`if`, `try`, loops, `switch`, bare blocks) are
 * descended into, because the walk inlines the tree those blocks build and a
 * binding inside one is as real as one at the top. Nested FUNCTIONS are not:
 * a function is its own scope and gets its own frame when the walk enters it,
 * which is what keeps two components' `count` declarations apart.
 *
 * Within one frame the FIRST declaration of a name wins; a later one with a
 * different default warns rather than silently replacing it.
 * Verified by: packages/compiler/tests/signal-scope.test.ts > "reads a declaration nested inside an if block"
 * Verified by: packages/compiler/tests/signal-scope.test.ts > "does not read a declaration inside a nested function"
 */
export function collectSignalDeclarations(
  statements: T.Statement[],
  options: SignalCollectOptions,
): Map<string, SignalDefault> {
  const signals = new Map<string, SignalDefault>();

  const record = (name: string, value: SignalDefault): void => {
    const existing = signals.get(name);
    if (!existing) {
      signals.set(name, value);
      return;
    }
    if (existing.type !== value.type || existing.default !== value.default) {
      if (!options.quiet) warnSignal(
        options.filePath,
        `signal '${name}' is declared twice in the same scope with different defaults `
        + `(${JSON.stringify(existing.default)} then ${JSON.stringify(value.default)}) — `
        + `the first declaration owns the slot, so the server renders ${JSON.stringify(existing.default)}`,
      );
    }
  };

  const visitDeclaration = (decl: T.VariableDeclaration): void => {
    for (const varDecl of decl.declarations) {
      // Must be array destructuring: const [name, setName] = ...
      if (!t.isArrayPattern(varDecl.id) || !varDecl.init) continue;
      if (
        !t.isCallExpression(varDecl.init)
        || !t.isIdentifier(varDecl.init.callee)
        || varDecl.init.callee.name !== 'createSignal'
      ) {
        continue;
      }

      const elements = varDecl.id.elements;
      const first = elements[0];
      if (!first || !t.isIdentifier(first)) continue;
      const signalName = first.name;

      const initArg = varDecl.init.arguments[0];
      if (!initArg || t.isSpreadElement(initArg)) {
        // `createSignal()` with no argument is `undefined` on the client, which
        // renders as empty text — the same thing a null default renders as.
        record(signalName, { type: 'null', default: null });
        continue;
      }

      const evaluated = evaluateSignalDefault(initArg as T.Expression, options.constants);
      if (evaluated) {
        record(signalName, evaluated);
      } else if (!options.quiet) {
        warnSignal(
          options.filePath,
          `signal '${signalName}' is initialized with a ${(initArg as T.Expression).type} the compiler `
          + `cannot evaluate — it gets no named slot, so bindings to it land in anonymous `
          + `'text:'/'attr:' slots that cannot be injected by name and render EMPTY server-side; `
          + `initialize it with a string, number, boolean or null literal, or with a module-level string const`,
        );
      }
    }
  };

  const visitStatements = (stmts: Array<T.Statement | null | undefined>): void => {
    for (const stmt of stmts) visitStatement(stmt);
  };

  const visitStatement = (stmt: T.Statement | null | undefined): void => {
    if (!stmt) return;

    const decl = asVariableDeclaration(stmt);
    if (decl) {
      visitDeclaration(decl);
      return;
    }

    if (t.isBlockStatement(stmt)) return visitStatements(stmt.body);
    if (t.isIfStatement(stmt)) {
      visitStatement(stmt.consequent);
      visitStatement(stmt.alternate);
      return;
    }
    if (t.isTryStatement(stmt)) {
      visitStatement(stmt.block);
      if (stmt.handler) visitStatement(stmt.handler.body);
      visitStatement(stmt.finalizer);
      return;
    }
    if (
      t.isForStatement(stmt) || t.isForInStatement(stmt) || t.isForOfStatement(stmt)
      || t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt) || t.isLabeledStatement(stmt)
    ) {
      return visitStatement(stmt.body);
    }
    if (t.isSwitchStatement(stmt)) {
      for (const c of stmt.cases) visitStatements(c.consequent);
    }
    // Function declarations are deliberately NOT descended into — see above.
  };

  visitStatements(statements);
  return signals;
}

// ---------------------------------------------------------------------------
// Slot encoding
// ---------------------------------------------------------------------------

/**
 * The `type_hint` / `default_bytes` pair an FMIR slot carries for one signal.
 *
 * `null` keeps TYPE_TEXT with no default bytes: the Rust walker omits an
 * attribute entirely for an empty default and renders empty text, which is what
 * a null initial value means on the client too.
 */
function encodeSignalDefault(sig: SignalDefault): { typeHint: number; defaultBytes: Uint8Array } {
  const encoder = new TextEncoder();
  if (sig.type === 'text' && typeof sig.default === 'string') {
    return { typeHint: SLOT_TYPE_TEXT, defaultBytes: encoder.encode(sig.default) };
  }
  if (sig.type === 'bool' && typeof sig.default === 'boolean') {
    return { typeHint: SLOT_TYPE_BOOL, defaultBytes: encoder.encode(String(sig.default)) };
  }
  if (sig.type === 'number' && typeof sig.default === 'number') {
    return { typeHint: SLOT_TYPE_NUMBER, defaultBytes: encoder.encode(String(sig.default)) };
  }
  return { typeHint: SLOT_TYPE_TEXT, defaultBytes: new Uint8Array(0) };
}

// ---------------------------------------------------------------------------
// Entering and resolving scopes
// ---------------------------------------------------------------------------

/**
 * Push one frame, minting a slot for every signal it declares.
 *
 * Slots are minted with `reference: false` — declaring a signal is not the same
 * as a binding on the page reading it, and only the latter belongs in an
 * enclosing island's `slot_ids`.
 *
 * Re-entering the same frame (the same scope under the same parent) returns the
 * memoized frame and mints nothing, so a component inlined twice does not
 * duplicate its slot table.
 * Verified by: packages/compiler/tests/signal-scope.test.ts > "reuses one slot when the same component is inlined twice"
 */
export function enterSignalScope(
  parent: SignalScope | null,
  scopeId: string,
  declarations: Map<string, SignalDefault>,
  ctx: IrEmitContext,
  registry: SignalRegistry,
): SignalScope {
  const key = `${parent ? parent.key : ''}>${scopeId}`;
  const memoized = registry.frames.get(key);
  if (memoized) return memoized;

  const bindings = new Map<string, SignalBinding>();
  for (const [name, sigDefault] of declarations) {
    const slotName = uniqueName(registry.names, name);
    if (slotName !== name) {
      // The rename is correct — two scopes declaring `count` are two different
      // signals and must not share a slot — but it is invisible in the source,
      // and a server injecting `count` would fill only the first. Say so.
      warnSignal(
        scopeId.split('#')[0]!,
        `signal '${name}' is also declared in another scope on this page, so this one gets `
        + `the slot name '${slotName}' — inject it under that exact name. If the two are meant `
        + `to be ONE signal, declare it once and import it rather than re-declaring it`,
      );
    }
    const { typeHint, defaultBytes } = encodeSignalDefault(sigDefault);
    const slotId = ctx.addSlot(slotName, typeHint, SLOT_SOURCE_CLIENT, defaultBytes, false);
    bindings.set(name, { name, slotName, slotId, default: sigDefault });
  }

  const scope: SignalScope = { key, bindings, parent };
  registry.frames.set(key, scope);
  return scope;
}

/** The binding `name` resolves to, searching outward through the chain. */
export function lookupSignal(
  scope: SignalScope | null | undefined,
  name: string,
): SignalBinding | undefined {
  for (let s = scope ?? null; s !== null; s = s.parent) {
    const found = s.bindings.get(name);
    if (found) return found;
  }
  return undefined;
}

/**
 * Is `fn` declared at the top level of `ast`'s module scope?
 *
 * Decides what a component's frame hangs off. A program-scope component sees
 * its own module and nothing else, whatever the call site was. A component
 * declared INSIDE another function (a `navItem` arrow beside the mount call)
 * sees everything lexically enclosing it — which, since such a component is
 * only reachable from the same file, is exactly the caller's chain.
 * Verified by: packages/compiler/tests/signal-scope.test.ts > "a nested helper sees the signals declared beside it"
 */
function isProgramScopeFunction(ast: T.File, fn: T.Node): boolean {
  for (const stmt of ast.program.body) {
    const node = t.isExportNamedDeclaration(stmt) && stmt.declaration
      ? stmt.declaration
      : t.isExportDefaultDeclaration(stmt)
        ? stmt.declaration
        : stmt;
    if (node === fn) return true;
    if (t.isVariableDeclaration(node)) {
      for (const declarator of node.declarations) {
        if (declarator.init === fn) return true;
      }
    }
  }
  return false;
}

export interface ComponentScopeInput {
  /** Parsed module of `filePath` (already JSX-transformed). */
  ast: T.File;
  /** The component function. Its block body is the inner frame; an
   *  expression-bodied arrow declares nothing and contributes no frame. */
  fn?: ComponentFunction | null;
  /** Name the component was resolved under — part of the frame's identity. */
  fnName: string;
  filePath: string;
  /** Module-level string constants of `filePath`. */
  constants?: Map<string, string>;
  ctx: IrEmitContext;
  registry: SignalRegistry;
  /** The scope the CALL SITE is in. Used only when the component is declared
   *  in a nested scope of the same file, where the caller's chain IS the
   *  component's lexical environment. Pass null when the component comes from
   *  another file: that file's module scope is then the whole chain. */
  callerScope?: SignalScope | null;
  /** Follows this module's imports so a signal declared in another file can
   *  fold here. Absent = imports are not followed (the pre-fix behavior).
   *  Create one per page with `createSignalImportResolver` and share it. */
  imports?: SignalImportResolver;
}

/**
 * The scope chain for a component the walk has decided to inline: its file's
 * module scope, then the component function's own body.
 *
 * This is the single hook every inlining site calls — the root page, an island
 * subtree, a nested sub-component. Adding a new kind of inlined code means
 * calling this once, not writing a fourth extraction method.
 */
export function enterComponentScope(input: ComponentScopeInput): SignalScope {
  const { ast, fn, fnName, filePath, constants, ctx, registry } = input;

  const moduleScope = enterSignalScope(
    null,
    `${filePath}#module`,
    collectSignalDeclarations(ast.program.body, { filePath, constants }),
    ctx,
    registry,
  );

  if (input.imports) {
    resolveModuleSignalImports(moduleScope, ast, filePath, input.imports, ctx, registry);
  }

  const nested = fn ? !isProgramScopeFunction(ast, fn) : false;
  const parent = nested ? (input.callerScope ?? moduleScope) : moduleScope;

  if (!fn || !t.isBlockStatement(fn.body)) return parent;

  return enterSignalScope(
    parent,
    `${filePath}#fn:${fnName}@${fn.start ?? 0}`,
    collectSignalDeclarations(fn.body.body, { filePath, constants }),
    ctx,
    registry,
  );
}

// ---------------------------------------------------------------------------
// Imported signals: resolve a default declared in another module
// ---------------------------------------------------------------------------

/**
 * Follows a module's imports to the signals they name in their DEFINING
 * modules, so `import { tok } from './store'` folds the default that
 * `store.ts` declares.
 *
 * Created once per page and shared by every scope entry on it. The caches
 * make the expensive work per-MODULE, not per-importer: one loader call per
 * (importing directory, specifier), one export-walk parse and one signal
 * collection per resolved module path, one answer per (resolved path, name)
 * however many files ask. The signal collection itself still costs its own
 * parse plus the module-constant extraction the caller's `readSignals`
 * chooses to do — once per module.
 */
export interface SignalImportResolver {
  /**
   * Every imported binding of `ast` that resolves to a signal with a
   * statically evaluable default: local name → its defining module.
   *
   * Quiet by design. This runs eagerly over ALL imports — components, utils,
   * types — and most of them are not signals, so a binding that does not
   * resolve is simply skipped: the use site keeps today's degradation warning,
   * which is the diagnostic that actually points at a consequence.
   */
  resolve(ast: T.File, filePath: string): Map<string, ResolvedSignalImport>;
}

export interface ResolvedSignalImport {
  /** The module that declares the signal, after aliases and re-exports. */
  definingPath: string;
  /** The getter's name in the defining module. */
  name: string;
  /** The defining module's COMPLETE top-level signal declarations. The
   *  `#module` frame is memoized on its first entry (`registry.frames`), so
   *  whoever enters it first must enter it whole — entering with a partial
   *  map would permanently hide the rest of that module's signals.
   *
   *  ACCEPTED TRADEOFF of whole-frame entry: every evaluable signal the
   *  store declares gets a slot, including ones no file on the page reads,
   *  and because import resolution runs when the ROOT scope is built, such
   *  a signal claims its base slot name before a later-inlined component's
   *  own same-named signal (which then mints `name#2`). A server injecting
   *  by name must use the collision warning's suffixed name in that case.
   *  The alternative — lazy per-name entry — would violate the memo
   *  contract above; slot-table bloat and the rename hazard are the price
   *  of one-slot-per-signal identity, and the collision warning names the
   *  rename whenever it happens. */
  declarations: Map<string, SignalDefault>;
}

export function createSignalImportResolver(
  loadModule: ModuleLoader,
  readSignals: (source: string, filePath: string) => Map<string, SignalDefault>,
): SignalImportResolver {
  /** One collect per module path, however many importers ask. */
  const declarationsByPath = new Map<string, Map<string, SignalDefault>>();
  const readSignalsCached = (source: string, filePath: string): Map<string, SignalDefault> => {
    const cached = declarationsByPath.get(filePath);
    if (cached) return cached;
    const declarations = readSignals(source, filePath);
    declarationsByPath.set(filePath, declarations);
    return declarations;
  };

  /** One filesystem probe per (importing directory, specifier). The loader
   *  resolves relative to the importer's directory, so the directory — not the
   *  full file path — is the cache identity. */
  const edges = new Map<string, { path: string; source: string } | null>();
  const loadEdgeCached: ModuleLoader = (fromFile, importPath) => {
    const key = `${dirname(fromFile)}>${importPath}`;
    let mod = edges.get(key);
    if (mod === undefined) {
      mod = loadModule(fromFile, importPath);
      edges.set(key, mod);
    }
    return mod;
  };

  /** One export-walk parse per module, shared across every lookup that
   *  reaches that module (directly or through a re-export chain). */
  const parsedByPath = new Map<string, T.File | null>();

  /** One traversal per (RESOLVED module path, imported name) — importers that
   *  name the same module collapse onto one answer. */
  const lookups = new Map<string, ResolvedSignalImport | null>();

  return {
    resolve(ast: T.File, filePath: string): Map<string, ResolvedSignalImport> {
      const resolved = new Map<string, ResolvedSignalImport>();
      /** Names the importing FILE also declares somewhere — a nested
       *  `const status = …` shadows the import at its use sites, and the
       *  scope chain cannot see non-signal locals, so folding the store's
       *  default there would be silently wrong. Skip the whole name. */
      let shadowed: Set<string> | null = null;

      for (const [localName, binding] of readImportBindings(ast)) {
        // A type-only binding is erased at runtime — it can never be a signal
        // read, and following it would drag the module's slot table into
        // pages that only reference a type.
        if (binding.kind === 'type') continue;
        // Namespace and default imports carry no declared name to chase —
        // skipping them (rather than half-resolving) is the contract.
        if (binding.imported === '*' || binding.imported === 'default') continue;
        // The compiler follows relative imports only; `formajs` itself and
        // every other package import is skipped without a read.
        if (!binding.source.startsWith('.') && !binding.source.startsWith('/')) continue;

        shadowed ??= nestedScopeBindings(ast);
        if (shadowed.has(localName)) continue;

        const mod = loadEdgeCached(filePath, binding.source);
        if (!mod) continue;

        const key = `${mod.path}>${binding.imported}`;
        let hit = lookups.get(key);
        if (hit === undefined) {
          hit = null;
          const lookup: SignalExportLookup<SignalDefault> = resolveExportedSignal(
            mod.source,
            mod.path,
            binding.imported,
            { loadModule: loadEdgeCached, readSignals: readSignalsCached, parsed: parsedByPath },
          );
          if (lookup.kind === 'found' && lookup.declarations.has(lookup.name)) {
            hit = {
              definingPath: lookup.filePath,
              name: lookup.name,
              declarations: lookup.declarations,
            };
          }
          lookups.set(key, hit);
        }
        if (hit) resolved.set(localName, hit);
      }
      return resolved;
    },
  };
}

/**
 * Expose a module's resolved signal imports in its `#module` frame, under
 * their local names, as the DEFINING module's bindings.
 *
 * The binding object is shared by reference with the defining module's frame —
 * `enterSignalScope`'s memo on `${definingPath}#module` returns the same frame
 * to every importer — so however many files import a signal, it is ONE slot,
 * and a server injecting it by name reaches all of them. Minting a fresh
 * binding here instead would be the one-signal-N-slots hazard the collision
 * warning in `enterSignalScope` describes.
 *
 * A name the module declares itself always wins; an import under that name is
 * a syntax error in JS anyway.
 */
export function resolveModuleSignalImports(
  moduleScope: SignalScope,
  ast: T.File,
  filePath: string,
  imports: SignalImportResolver,
  ctx: IrEmitContext,
  registry: SignalRegistry,
): void {
  for (const [localName, resolved] of imports.resolve(ast, filePath)) {
    if (moduleScope.bindings.has(localName)) continue;
    const definingScope = enterSignalScope(
      null,
      `${resolved.definingPath}#module`,
      resolved.declarations,
      ctx,
      registry,
    );
    const binding = definingScope.bindings.get(resolved.name);
    if (binding) moduleScope.bindings.set(localName, binding);
  }
}

/**
 * Forma Compiler - Coded build diagnostics (FORMA-119; DR-1, L-3, N12)
 *
 * Every construct the compiler cannot represent in a server-rendered module is
 * reported here, with a stable code, the file, the line and the column, one
 * line of why and one of fix. The catalogue below is the single list of codes;
 * `docs/DIAGNOSTICS.md` documents each one, and a test keeps the two equal.
 *
 * Codes are numbered by family (L-3). The notes, which strict mode never
 * fails on, are a construct DR-1 admits (504) and the deprecations (802 to
 * 804, 901): the old paths keep working in A2.
 *
 * Codes are numbered by family (L-3):
 *
 *   BUILD-1xx  a subtree the compiler leaves to the browser (rule 11's islands)
 *   BUILD-2xx  an attribute or prop dropped or left empty
 *   BUILD-3xx  text, a conditional or a list the server renders empty or wrong
 *   BUILD-4xx  a component the compiler does not inline
 *   BUILD-5xx  a signal the compiler cannot name
 *   BUILD-6xx  the page module itself: a placeholder, or a literal too long
 *   BUILD-7xx  a construct adoption does not handle; `browserOnly()` is the way out
 *   BUILD-8xx  the build package (reported by @getforma/build, catalogued here)
 *   BUILD-9xx  the compiler's own deprecated entry points (logged when called)
 *
 * A code never changes meaning. A new construct gets a new code; a retired one
 * stays reserved.
 *
 * What a report does, in order:
 *
 * 1. It prints the line it printed at compiler 0.3.6, one `console.warn` per
 *    report, with the code inserted after `IR:` and `:line:column` after the
 *    file. Nothing else in the line changes, and no line is added or removed:
 *    consumers gate on these lines (GateWASM counts them per file, ksx Studio
 *    matches their text), so a default build behaves as it did.
 * 2. It hands the diagnostic, with its location, to the collector the caller
 *    opened with {@link collectDiagnostics}, if any. The SSR plugin opens one
 *    per page; `@getforma/build` gathers them all, writes them as JSON on
 *    request, and under `--strict` fails the build with every one of them.
 *
 * Verified by: packages/compiler/tests/diagnostics-conformance.test.ts
 */

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export interface DiagnosticEntry {
  /** The stable code, `BUILD-<family><nn>`. */
  code: string;
  /** What the code names, in a few words. */
  title: string;
  /** One line: what happens to the page. */
  why: string;
  /** One line: what to write instead. */
  fix: string;
  /**
   * Whether `--strict` fails the build on it. True for every code but the
   * notes: a construct DR-1's published subset admits, which the compiler
   * reports because the line was printed before (BUILD-504).
   */
  strict: boolean;
}

const BROWSER_ONLY_WAY_OUT =
  'or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone';

function entry(code: string, title: string, why: string, fix: string, strict = true): DiagnosticEntry {
  return { code, title, why, fix, strict };
}

/**
 * Every code the compiler and the build can report, by family. The order is
 * the documentation's order.
 */
export const DIAGNOSTIC_CATALOGUE: readonly DiagnosticEntry[] = Object.freeze([
  // ── 1xx: subtrees left to the browser (rule 11) ──────────────────────────
  entry('BUILD-101', 'Unrecognised call in the tree',
    'The call becomes an anonymous island (`island_<n>`) that no registry names: the server renders an empty shell and nothing fills it.',
    `Write the subtree as h() calls, a component in a relative file, createShow or createList, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-102', 'Unrecognised child expression',
    'A child the compiler cannot represent (a bare ternary, a bare `&&`, an identifier, a template literal, an object) becomes an anonymous island the server renders empty.',
    'Wrap a reactive child in a function (`() => …`), use createShow for a conditional and createList for rows, or fold the value into a module-level const.'),
  entry('BUILD-103', 'Dynamic tag',
    '`h(expr, …)` with a tag the compiler cannot read becomes an anonymous island the server renders empty.',
    'Use a literal tag name, or a component the compiler can follow.'),
  entry('BUILD-104', 'Spread child that does not unroll',
    'A spread child is unrolled only as `...CONST.map(item => h(…))` over a module-level array of object literals; anything else becomes an anonymous island the server renders empty.',
    'Unroll a module-level const array of object literals, or render runtime rows with createList(source, keyFn, (row) => h(…)).'),
  entry('BUILD-105', 'Spread over a table that is not static',
    'The spread names a table the compiler cannot read (imported from a package, built at run time, or shadowed by a nested declaration), so it becomes an anonymous island the server renders empty.',
    'Declare the table as a literal `const` of object literals in the module it is imported from, with no nested declaration of the same name, or use createList.'),
  entry('BUILD-106', 'createShow branch the compiler cannot follow',
    'A createShow branch that is not `() => h(…)` (or a direct h() call) becomes an anonymous island the server renders empty.',
    'Write the branch inline as `() => h(…)`.'),
  entry('BUILD-107', 'createList the compiler cannot walk',
    'A createList without all three arguments, with a map function that is not inline, takes no named row parameter or returns nothing visible becomes a `createList` island the server renders empty.',
    'Write `createList(source, keyFn, (row) => h(…))` with the map function inline and the row parameter named, reading `row.field`.'),

  // ── 2xx: attributes and props ────────────────────────────────────────────
  entry('BUILD-201', 'Props passed as something other than an object literal',
    'None of the attributes the element carries are rendered on the server.',
    "Pass the attributes as an object literal on the h('tag', { … }) call."),
  entry('BUILD-202', 'Spread props',
    'The attributes inside `{...rest}` are not rendered on the server.',
    'List the attributes explicitly on the h() call.'),
  entry('BUILD-203', 'Prop key the compiler cannot name',
    'A computed key, or a key that is neither an identifier nor a string, drops its attribute from the server-rendered HTML.',
    'Use a plain identifier or string key.'),
  entry('BUILD-204', 'Method-valued prop',
    'An object method (`{ title() { … } }`) has no binding form, so the attribute is not rendered on the server.',
    'Write it as an arrow property (`title: () => …`) for a reactive binding.'),
  entry('BUILD-205', 'dangerouslySetInnerHTML',
    'Raw markup is not rendered from the module: the element ships empty until the browser runs.',
    `Render the content as h() children, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-206', 'Reactive attribute the compiler cannot evaluate',
    'The attribute is omitted from the server-rendered HTML and appears only once the browser activates the page.',
    'Initialize the signals it reads with literal defaults, or fold the value into a module-level const.'),
  entry('BUILD-207', 'Attribute value the compiler cannot evaluate',
    'The attribute is omitted from the server-rendered HTML, and adoption does not re-apply a value that is not a function, so it never appears.',
    'Inline the literal, use a module-level const, or wrap the value in a function (`() => …`) for a reactive binding.'),

  // ── 3xx: text and conditionals ───────────────────────────────────────────
  entry('BUILD-301', 'Text the compiler cannot evaluate',
    'The text renders empty on the server and fills in only once the browser activates the page.',
    'Initialize the signals it reads with literal defaults so the server can render them.'),
  entry('BUILD-302', 'Conditional the compiler cannot evaluate',
    'The server renders the ELSE branch; if the browser would render the THEN branch, adoption keeps the wrong one until the condition changes value.',
    'Initialize the signals the condition reads with literal defaults.'),
  entry('BUILD-303', 'List over a signal initialized with literal rows',
    "The list's source is a plain read (`rows`, `rows()`, `() => rows()`) of a signal initialized with literal rows, which have no slot, so the server renders the list empty unless a handler fills `list:<name>:array`, while the browser renders the rows. A derived source over literal rows (`() => rows().filter(…)`) is not detected in A2.",
    'Start the signal empty (`createSignal([])`) and fill it from the server (the handler sets `list:<name>:array`; an island seeds the signal from its props), or unroll a module-level const with `...CONST.map(…)`.'),

  // ── 4xx: components ──────────────────────────────────────────────────────
  entry('BUILD-401', 'Component imported from a package',
    'The compiler follows relative imports only, so the component becomes an empty island shell under its own name that nothing fills on the server.',
    `Compile the component's source in the application (a relative import), ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-402', 'Component the compiler cannot find',
    'No relative import or declaration in the calling file resolves the name, so it becomes an empty island shell that nothing fills on the server.',
    'Import the component from a relative path, or declare it in the calling file.'),
  entry('BUILD-403', 'Composition past the inlining limit of 3',
    'Components are inlined three levels deep; the fourth level becomes an empty island shell. The diagnostic names the chain from the page down.',
    `Flatten the chain so the component sits at depth 3 or less, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-404', 'Recursive component',
    'A component inside its own subtree is not inlined: it becomes an empty island shell.',
    `Render the recursion with createList over data, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-405', 'Component passed a prop the compiler cannot evaluate',
    'A component is inlined only with literal props, so it becomes an empty island shell.',
    'Pass literal values (strings, numbers, booleans, null) as props.'),
  entry('BUILD-406', 'Component the compiler cannot follow',
    'The component has no return the compiler can follow to an h() call, or its file failed to parse, so it becomes an empty island shell.',
    'Return the h() tree directly from the component (an expression body or a top-level `return h(…)`).'),
  entry('BUILD-407', 'Children passed to a component',
    "The compiler cannot place a component's children: they are not in the server-rendered HTML and appear only after the browser renders the component.",
    'Pass the content as props, or render it inside the component.'),
  entry('BUILD-408', 'Registered island whose content the compiler cannot compile',
    'The island is registered, so its empty shell activates in the browser, but the server renders a hole where it will appear (or truncates its content at the failure).',
    'Make the island resolvable (a relative import, returning its h() tree), or declare it with browserOnly() so the empty host is intended.'),

  // ── 5xx: signals ─────────────────────────────────────────────────────────
  entry('BUILD-501', 'Signal default the compiler cannot evaluate',
    "The signal gets no named slot, so bindings to it land in anonymous slots that render empty on the server and cannot be set by name.",
    'Initialize it with a string, number, boolean or null literal, or a module-level string const.'),
  entry('BUILD-502', 'Signal declared twice in one scope',
    'Two declarations with different defaults share one slot; the first owns it, so the server renders its default.',
    'Declare the signal once.'),
  entry('BUILD-503', 'Signal name taken by another scope',
    "Two scopes declare the same signal name, so this one's slot is renamed (`name#2`); a server setting the plain name fills the other one.",
    'Declare the signal once and import it, or set the renamed slot by its exact name.'),
  entry('BUILD-504', 'Signal initialized with an array or object literal (note)',
    'The signal gets no named slot, so its literal value does not reach the server. DR-1 admits literal arrays and objects, so this is a note, never an error. A read in text, an attribute or a conditional is reported where it is (BUILD-301, 206, 302), and a createList whose source is a plain read of literal rows (`rows`, `rows()`, `() => rows()`) as BUILD-303; a derived source such as `createList(() => rows().filter(…))` is not detected in A2.',
    'Act on the diagnostic at each read. A createList over `createSignal([])` needs nothing: both sides start empty.',
    false),

  // ── 6xx: the page module ─────────────────────────────────────────────────
  entry('BUILD-601', 'No mount() call in the entry',
    'The compiler cannot find the page, so it writes a placeholder module: the server renders an empty `<div id="app">` and nothing shows until the browser runs.',
    "Call mount(() => …, '#app') or activateIslands({ … }) at the top level of the SSR entry, or declare the route `ssr: false`."),
  entry('BUILD-602', 'Page component the compiler cannot resolve',
    'The page component named in mount() cannot be found or read, so the compiler writes a placeholder module and the server renders an empty `<div id="app">`.',
    'Import the page component from a relative path that exports it as a function.'),
  entry('BUILD-603', 'Page root that is not an h() call',
    'The page returns something other than an h() call, so the compiler writes a placeholder module and the server renders an empty `<div id="app">`.',
    'Return the page tree as h() calls (or JSX).'),
  entry('BUILD-604', 'Literal past 65,535 bytes',
    "FMIR's string table and slot defaults hold at most 65,535 bytes per entry, so the page cannot be encoded and the compiler writes a placeholder module.",
    'Load content that long at run time (a handler-filled slot or a fetch), or split it into smaller literals.'),
  entry('BUILD-605', 'Module const past 65,535 bytes',
    'A module-level const that folds to more than 65,535 bytes is not folded, so every use of it is reported where it is read.',
    'Keep folded constants under 65,535 bytes, or load the content at run time.'),
  entry('BUILD-606', 'Module emission failed',
    'The compiler failed while emitting the page (or writing its module) and fell back to a placeholder module. This is a defect in the compiler or an input it does not expect.',
    'Report it with the message; until it is fixed, declare the route `ssr: false`.'),

  // ── 7xx: constructs adoption does not handle (FORMA-016) ─────────────────
  entry('BUILD-701', 'Plain array child (`.map()` without createList)',
    'A `.map()` returning elements is not adopted. As a child, the server renders an empty island shell and the rows never appear after activation; in a reactive child (`() => rows.map(…)`), the server renders empty text and after activation the page shows the elements as text (`[object HTMLLIElement]`).',
    `Render rows with createList(source, keyFn, (row) => h(…)), unroll a module-level const with ...CONST.map(…), ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-702', 'createErrorBoundary in a server-rendered component',
    "Adoption has no handling for createErrorBoundary: the server renders an empty shell where it stands, and on a mount() root activation throws (`insertBefore`: parameter 1 is not of type 'Node'), so nothing after it activates.",
    `Move the boundary out of the server-rendered tree, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-703', 'createSwitch in a server-rendered component',
    "Adoption has no handling for createSwitch: the server renders an empty shell where it stands, and on a mount() root activation throws (`insertBefore`: parameter 1 is not of type 'Node'), so nothing after it activates.",
    `Use createShow for each case, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-704', 'createPortal in a server-rendered component',
    "Adoption has no handling for createPortal: the server renders an empty shell where it stands; activation goes on past it, but the portal's content never appears.",
    `Create the portal from an effect after activation, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-705', 'createSuspense in a server-rendered component',
    "Adoption has no handling for createSuspense: the server renders an empty shell where it stands, and on a mount() root activation throws (`insertBefore`: parameter 1 is not of type 'Node'), so nothing after it activates.",
    `Render the loaded state from server data, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-706', 'browserOnly() prop the compiler cannot evaluate',
    "A browser-only island's server output is its empty host with its declared props; a prop the compiler cannot evaluate to a string, number, boolean or null (a function, a spread, an array, a run-time value) is not among them, so the component never receives it.",
    'Pass a literal or a module-level const, or read the value in the browser.'),
  entry('BUILD-707', 'browserOnly() called inside the tree',
    'browserOnly() wraps a component declaration; called in the tree, the compiler cannot name the island, so it becomes an empty shell nothing registers.',
    'Declare `const X = browserOnly(Impl)` at the top level of a module, render `<X …/>`, and register X in activateIslands.'),
  entry('BUILD-708', 'browserOnly() component not registered',
    "The page activates islands from a registry that does not name this component, so its empty host never renders in the browser.",
    'Add the component to the activateIslands({ … }) registry under the name it is rendered with.'),

  // ── 8xx: the build package ───────────────────────────────────────────────
  entry('BUILD-801', 'SSR build without @getforma/compiler',
    'The build was asked for server-rendered modules but cannot load @getforma/compiler, so it writes none.',
    'Install @getforma/compiler (a peer dependency of @getforma/build), or turn `ssr` off.'),
  entry('BUILD-802', '`serviceWorker` without `app` (deprecated; note)',
    "The worker is 0.3.0's: its caches are shared by every Forma application on the origin, and it takes over open tabs at once. From 3.0.0 a worker is written only for a named app. A deprecation, not a construct the server cannot render, so --strict does not fail on it.",
    "Set `app` to the name the server passes to forma-server's `sw::ServiceWorker::for_app`, for caches per application and build and a waiting upgrade.",
    false),
  entry('BUILD-803', '`wasm` in the config (deprecated; note)',
    "The `wasm` key goes in 3.0.0 with the WASM walker (forma-ir's `wasm` feature and `@getforma/core/wasm`). The old path keeps working in A2, so strict mode does not fail a build that still sets it.",
    'Remove `wasm` from the config: islands re-render in the browser with h(), and forma-server renders pages.',
    false),
  entry('BUILD-804', 'The wasm-pack step ran (deprecated; note)',
    "The wasm-pack step goes in 3.0.0: forma_ir.js, forma_ir_bg.wasm and the manifest's wasm entry go with the WASM walker. It still runs and ships the walker in A2, so strict mode does not fail on it.",
    'Remove `wasm` from the config.',
    false),
  // The raw-entry lint, forma-raw-lint (FORMA-126, SR8): reported by @getforma/build's
  // bin, never in a build's report. RAW_LINT_CATALOGUE in packages/build/src/raw-lint.ts
  // holds the same entries (packages/build/tests/raw-lint.test.ts keeps them equal).
  entry('BUILD-810', 'Raw entry not on the allowlist (forma-raw-lint)',
    "The source uses one of INV1's and INV2's exits (raw HTML, a typed raw home or a Trusted Types relaxation), and the allowlist names no owner and end date for it (SR8).",
    'Write it without the exit (render through a component, or the typed form the message names), or add an entry to forma-raw-allowlist.json with its path, line or symbol, exit, owner, until and reason.'),
  entry('BUILD-811', 'Allowlist entry past its end date (forma-raw-lint)',
    "The entry's until date has passed: the raw entry it lists was due to go, and its owner has neither removed nor renewed it.",
    'Remove the raw entry and its allowlist entry, or, with its owner, set a new until and say why in reason.'),
  entry('BUILD-812', 'Allowlist file the lint cannot use (forma-raw-lint)',
    'The allowlist cannot be read, is not version 1, or has an entry without a path, a known exit, one of line or symbol, an owner, a real until date or a reason; the lint does not guess what it meant.',
    'Correct the file: the message names the entry and the field.'),
  entry('BUILD-813', 'Allowlist entry that lists fewer uses than it says (forma-raw-lint; note)',
    'It matches fewer raw entries than its count, or none, so the inventory overstates and leaves room for unreviewed uses: one was removed, or moved to another line or symbol. A note: the run does not fail on it.',
    'Lower its count to the uses it lists, remove it if it lists none, or point its line or symbol at where the raw entry now is.',
    false),
  entry('BUILD-814', 'Source file the lint cannot read (forma-raw-lint)',
    'The file could not be read or parsed, so the raw entries in it cannot be counted; the lint fails rather than pass a file it did not see.',
    'Fix the syntax error the message names, or leave the file out with --exclude if it is not source.'),

  // ── 9xx: the compiler's own deprecated entry points ──────────────────────
  entry('BUILD-901', '`transformServerFunctions` called (deprecated; note)',
    'The "use server" transform goes in 3.0.0 with server functions and `@getforma/core/server` (DR-22). Logged once per process when it is called; `@getforma/build` never calls it, so it is never in a build\'s report.',
    "Serve the call from a route in the application's Rust server.",
    false),
]);

const BY_CODE: ReadonlyMap<string, DiagnosticEntry> = new Map(
  DIAGNOSTIC_CATALOGUE.map((e) => [e.code, e]),
);

/** The catalogue entry for a code. Throws on a code the catalogue lacks. */
export function diagnosticEntry(code: string): DiagnosticEntry {
  const found = BY_CODE.get(code);
  if (!found) throw new Error(`unknown diagnostic code ${code}`);
  return found;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** One link of a composition chain, from the page down (BUILD-403). */
export interface DiagnosticChainLink {
  /** The component's name where it is called (the page root first). */
  component: string;
  /** The file the call is in (for the root: the page component's file). */
  file: string;
  line: number;
  column: number;
}

/** One report, as a build gathers it. */
export interface Diagnostic {
  /** The stable code, e.g. `BUILD-101`. */
  code: string;
  /** The file to edit, as the compiler read it (absolute in a real build). */
  file: string;
  /** 1-based line in that file, as authored (JSX mapped back); 0 when unknown. */
  line: number;
  /** 1-based column; 0 when unknown. */
  column: number;
  /** The specific report: the construct, what happens, and its fix. */
  message: string;
  /** The catalogue's why for the code. */
  why: string;
  /** The catalogue's fix for the code. */
  fix: string;
  /** Whether `--strict` fails the build on it (false only for notes). */
  strict: boolean;
  /** BUILD-403: the composition chain, from the page down to the component refused. */
  chain?: DiagnosticChainLink[];
}

/** A Babel-style location: 1-based line, 0-based column. */
export interface SourcePosition {
  line: number;
  column: number;
}

/** Anything carrying a Babel `loc`. */
export interface Locatable {
  loc?: { start: SourcePosition } | null;
}

export interface ReportInput {
  code: string;
  /** The file the position is in. Empty when the caller has none (unit tests). */
  file: string;
  /** The node the report is about; its position is in `file`'s compiled text. */
  node?: Locatable | null;
  /** A position to use instead of a node's (1-based line, 0-based column). */
  position?: SourcePosition;
  /**
   * The printed text after `IR: <code> `, given where to say it happened:
   * `file:line:column`, or `file` alone when the position is unknown.
   */
  text: (where: string) => string;
  chain?: DiagnosticChainLink[];
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

const collectors: Diagnostic[][] = [];

/**
 * Run `fn` and return what it returns together with every diagnostic reported
 * while it ran. Synchronous only: the compiler's walk is, and a module-level
 * stack is what lets the signal pass, the analyzer and the walker report into
 * one list without threading a sink through every signature. A report goes to
 * every open collection, so a nested one sees its own part and the outer one
 * sees everything.
 *
 * Reports still print their line as at compiler 0.3.6; collecting adds to it.
 */
export function collectDiagnostics<T>(fn: () => T): { result: T; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  collectors.push(diagnostics);
  try {
    return { result: fn(), diagnostics };
  } finally {
    collectors.pop();
  }
}

/**
 * Report one diagnostic: print its line, and add it to the open collector.
 * Returns it, located.
 */
export function reportDiagnostic(input: ReportInput): Diagnostic {
  // Never throw from a report: it runs inside the walk, where a throw would
  // change what is emitted. A test keeps every code in the source catalogued.
  const entryForCode = BY_CODE.get(input.code) ?? { why: '', fix: '', strict: true };
  const start = input.position ?? input.node?.loc?.start;
  const located = input.file && start ? originalPosition(input.file, start) : null;
  const where = !input.file
    ? ''
    : located
      ? `${input.file}:${located.line}:${located.column}`
      : input.file;
  const message = input.text(where);

  // One line, as before, so a gate counting or matching these lines is
  // unaffected: the code after `IR:`, the position after the file.
  console.warn(`   IR: ${input.code} ${message}`);

  const diagnostic: Diagnostic = {
    code: input.code,
    file: input.file,
    line: located?.line ?? 0,
    column: located?.column ?? 0,
    message,
    why: entryForCode.why,
    fix: entryForCode.fix,
    strict: entryForCode.strict,
    ...(input.chain ? { chain: input.chain } : {}),
  };
  for (const collected of collectors) collected.push(diagnostic);
  return diagnostic;
}

/**
 * Make a diagnostic from a code and an already-located position, without
 * printing it: for a caller that prints its own line (`@getforma/build`).
 */
export function makeDiagnostic(
  code: string,
  file: string,
  line: number,
  column: number,
  message: string,
): Diagnostic {
  const e = diagnosticEntry(code);
  return { code, file, line, column, message, why: e.why, fix: e.fix, strict: e.strict };
}

/**
 * One diagnostic as a block of text for a failing `--strict` build:
 * `file:line:column  CODE  message`, then its why and fix.
 */
export function formatDiagnostic(d: Diagnostic): string {
  const where = d.file
    ? d.line > 0 ? `${d.file}:${d.line}:${d.column}` : d.file
    : '(no file)';
  return `${where}  ${d.code}  ${d.message}\n    why: ${d.why}\n    fix: ${d.fix}`;
}

// ---------------------------------------------------------------------------
// Positions in .tsx and .jsx files
// ---------------------------------------------------------------------------
//
// The walker reads a .tsx or .jsx file after esbuild has turned its JSX into
// h() calls, and esbuild reprints the whole file, so a node's line in that text
// is not the line the author wrote. The transform's source map takes it back.
// The map is kept per file as text and decoded only when a report needs it,
// so a build with no diagnostics pays for the map's generation alone.

interface StoredMap {
  mappings: string;
  decoded?: Array<Array<[number, number, number]>>;
}

const sourceMaps = new Map<string, StoredMap>();

/**
 * Remember the source map of `file`'s compiled text, so positions in that text
 * are reported where the author wrote them. A file read without a transform
 * forgets any earlier map.
 */
export function registerSourceMap(file: string, map: string | null | undefined): void {
  if (!map) {
    sourceMaps.delete(file);
    return;
  }
  try {
    const parsed = JSON.parse(map) as { mappings?: unknown };
    if (typeof parsed.mappings === 'string') {
      sourceMaps.set(file, { mappings: parsed.mappings });
      return;
    }
  } catch {
    // An unreadable map only costs exact positions.
  }
  sourceMaps.delete(file);
}

/**
 * The authored position (1-based line and column) of a position in `file`'s
 * compiled text (1-based line, 0-based column).
 * Verified by: packages/compiler/tests/diagnostics-conformance.test.ts > "maps a position in a .tsx file back to the line the author wrote"
 */
export function originalPosition(file: string, pos: SourcePosition): { line: number; column: number } {
  const stored = sourceMaps.get(file);
  if (!stored) return { line: pos.line, column: pos.column + 1 };
  stored.decoded ??= decodeMappings(stored.mappings);
  const segments = stored.decoded[pos.line - 1];
  if (!segments || segments.length === 0) return { line: pos.line, column: pos.column + 1 };
  // The last segment starting at or before the column; else the line's first.
  let best = segments[0]!;
  for (const segment of segments) {
    if (segment[0] > pos.column) break;
    best = segment;
  }
  return { line: best[1] + 1, column: best[2] + 1 };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUE = new Map<string, number>([...BASE64].map((c, i) => [c, i]));

/**
 * Decode a source map's `mappings` (version 3, base64 VLQ) into, per generated
 * line, `[generatedColumn, sourceLine, sourceColumn]` segments, all 0-based.
 * The transform maps one file to itself, so the source index is not kept.
 */
function decodeMappings(mappings: string): Array<Array<[number, number, number]>> {
  const lines: Array<Array<[number, number, number]>> = [];
  let sourceLine = 0;
  let sourceColumn = 0;
  for (const lineText of mappings.split(';')) {
    const segments: Array<[number, number, number]> = [];
    let generatedColumn = 0;
    for (const segmentText of lineText.split(',')) {
      if (!segmentText) continue;
      const fields = decodeVlq(segmentText);
      generatedColumn += fields[0] ?? 0;
      if (fields.length < 4) continue;
      sourceLine += fields[2]!;
      sourceColumn += fields[3]!;
      segments.push([generatedColumn, sourceLine, sourceColumn]);
    }
    lines.push(segments);
  }
  return lines;
}

function decodeVlq(text: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of text) {
    const digit = BASE64_VALUE.get(char);
    if (digit === undefined) return values;
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value % 2 === 1 ? -Math.floor(value / 2) : value / 2);
    value = 0;
    shift = 0;
  }
  return values;
}

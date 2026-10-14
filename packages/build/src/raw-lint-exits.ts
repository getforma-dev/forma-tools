/**
 * @getforma/build — the exits the raw-entry lint looks for (FORMA-126; SR8,
 * DR-19, L-37), and the markup checks every language's strings share.
 *
 * INV1 (markup reaches the page escaped) and INV2 (only the build's script
 * runs) each have named ways out: the raw constructors, the typed raw homes,
 * Trusted Types' per-route relaxation, and, until 3.0.0 removes them, the
 * string forms the A2 bridge still accepts. Every use of one is a raw entry,
 * and SR8 requires each to be on the application's allowlist with an owner
 * and an end date. This table is the list the lint enforces; `exit` in an
 * allowlist entry is one of its names.
 *
 * Verified by: packages/build/tests/raw-lint.test.ts
 */

/** Where an exit is written. */
export type ExitLanguage = 'ts' | 'rust' | 'markup';

export interface ExitInfo {
  /** The name an allowlist entry's `exit` uses. */
  name: string;
  /** A file-system-safe name, for the fixture corpus. */
  slug: string;
  language: ExitLanguage;
  /** What a use of it is, in a few words. */
  what: string;
}

export const RAW_EXITS: readonly ExitInfo[] = Object.freeze([
  // TypeScript and JavaScript, inline scripts in HTML included.
  { name: 'trustedHtml', slug: 'trustedHtml', language: 'ts', what: "core's raw constructor, trustedHtml(), called or referenced" },
  { name: 'dangerouslySetInnerHTML', slug: 'dangerouslySetInnerHTML', language: 'ts', what: 'dangerouslySetInnerHTML with an __html the lint cannot trace to trustedHtml()' },
  { name: 'setHTMLUnsafe', slug: 'setHTMLUnsafe', language: 'ts', what: "core's setHTMLUnsafe() given markup the lint cannot trace to trustedHtml()" },
  { name: 'template', slug: 'template', language: 'ts', what: "core's template() given markup the lint cannot trace to trustedHtml()" },
  { name: 'templateMany', slug: 'templateMany', language: 'ts', what: "core's templateMany() given markup the lint cannot trace to trustedHtml()" },
  { name: 'reconcile', slug: 'reconcile', language: 'ts', what: "the runtime's reconcile() given markup the lint cannot trace to trustedHtml()" },
  { name: 'srcdoc', slug: 'srcdoc', language: 'ts', what: 'a srcdoc prop or attribute set to a value the lint cannot trace to trustedHtml()' },
  // Markup: HTML files, and string literals in either language.
  { name: 'data-bind:srcdoc', slug: 'data-bind-srcdoc', language: 'markup', what: "the HTML runtime's data-bind:srcdoc binding, which no trustedHtml() can reach" },
  { name: 'list-row-srcdoc', slug: 'list-row-srcdoc', language: 'markup', what: "a srcdoc attribute carrying {item…}, the HTML runtime's list-row binding" },
  { name: 'trusted-types-registry', slug: 'trusted-types-registry', language: 'markup', what: "the key of core's Trusted Types registry, which reaches the forma policy's mint without trustedHtml()" },
  // Rust.
  { name: 'RawHtml::trusted', slug: 'RawHtml-trusted', language: 'rust', what: "forma-server's raw constructor, RawHtml::trusted" },
  { name: 'RawHtml-alias', slug: 'RawHtml-alias', language: 'rust', what: 'RawHtml under another name (use … as, a type alias, = RawHtml), which hides RawHtml::trusted from a search' },
  { name: 'r#html', slug: 'r-html', language: 'rust', what: 'the raw identifier r#html, the name of RawHtml\'s markup field' },
  { name: 'body_prefix', slug: 'body_prefix', language: 'rust', what: 'a body_prefix the lint cannot trace to a RawHtml (a string still works in 0.2.x)' },
  { name: 'config_json', slug: 'config_json', language: 'rust', what: "PageConfig's config_json, the typed home for data" },
  { name: 'config_script', slug: 'config_script', language: 'rust', what: "PageConfig's deprecated config_script, handler text in a nonced script" },
  { name: 'into_parts_unchecked', slug: 'into_parts_unchecked', language: 'rust', what: "PageResponse::into_parts_unchecked, the page's HTML without its response" },
  { name: 'with_module_preloads', slug: 'with_module_preloads', language: 'rust', what: "RenderCtx::with_module_preloads, the typed home for modulepreload links" },
  { name: 'with_head_link', slug: 'with_head_link', language: 'rust', what: 'RenderCtx::with_head_link, the typed home for head links' },
  { name: 'relax_trusted_types', slug: 'relax_trusted_types', language: 'rust', what: "PolicyExtensions::relax_trusted_types, a route's Trusted Types relaxation" },
]);

export const EXIT_NAMES: ReadonlySet<string> = new Set(RAW_EXITS.map((e) => e.name));

/** One raw entry a scanner found, before it is matched against the allowlist. */
export interface Found {
  exit: string;
  /** 1-based, in the file as written. */
  line: number;
  /** 1-based. */
  column: number;
  /** The innermost named function, method, class, impl or module, or null at the top level. */
  symbol: string | null;
  /** What was found, in a few words. */
  message: string;
}

/** A position in a file. */
export interface Position {
  line: number;
  column: number;
}

/** The text's line and 1-based column at `offset`. */
export function positionIn(text: string, offset: number, from: { offset: number; line: number; column: number } = { offset: 0, line: 1, column: 1 }): Position {
  let line = from.line;
  let column = from.column;
  for (let i = from.offset; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

/** The registry key core keeps its Trusted Types handles under (`Symbol.for`). */
export const REGISTRY_KEY = '@getforma/core#trusted-types';

/**
 * The markup exits in `text`: `data-bind:srcdoc`, a `srcdoc` whose value
 * carries `{item` (what the runtime's list rows interpolate), and the
 * registry key, outside HTML comments. `source` is a string literal's text
 * (escapes and all) or an HTML tag; offsets are into it.
 *
 * Verified by: packages/build/tests/raw-lint.test.ts > "markup exits: each fails unlisted, passes listed, fails expired"
 */
export function scanMarkup(source: string): Array<{ exit: string; offset: number; message: string }> {
  const out: Array<{ exit: string; offset: number; message: string }> = [];
  // An HTML comment is inert markup: blanked, so offsets stay the source's.
  const text = source.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => ' '.repeat(m.length));
  for (const m of text.matchAll(/(?<![\w:.-])data-bind:srcdoc(?![\w-])/gi)) {
    out.push({ exit: 'data-bind:srcdoc', offset: m.index!, message: 'data-bind:srcdoc binds an iframe document from data' });
  }
  for (const m of text.matchAll(/(?<![\w:.-])srcdoc\s*=\s*/gi)) {
    const value = attributeValue(text, m.index! + m[0].length);
    if (value.includes('{item')) {
      out.push({ exit: 'list-row-srcdoc', offset: m.index!, message: 'srcdoc="…{item…}" binds a list row\'s iframe document from data' });
    }
  }
  let at = text.indexOf(REGISTRY_KEY);
  while (at !== -1) {
    out.push({ exit: 'trusted-types-registry', offset: at, message: `the string '${REGISTRY_KEY}' reaches core's Trusted Types registry` });
    at = text.indexOf(REGISTRY_KEY, at + 1);
  }
  return out;
}

/** The value of an attribute whose `=` ends just before `start`, quoted (escaped quotes too) or not. */
function attributeValue(text: string, start: number): string {
  let i = start;
  if (text[i] === '\\') i++;
  const quote = text[i];
  if (quote === '"' || quote === "'") {
    let end = i + 1;
    while (end < text.length && text[end] !== quote) end++;
    // An escaped quote (`\"` in a Rust or JS string) ends the value too.
    const value = text.slice(i + 1, end);
    return value.endsWith('\\') ? value.slice(0, -1) : value;
  }
  const m = /^[^\s>]*/.exec(text.slice(start));
  return m ? m[0] : '';
}

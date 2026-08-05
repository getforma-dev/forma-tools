import { h, createSignal } from 'formajs';

export function UnicodePage() {
  // Declared INSIDE the exported component, so the emitter turns it into a
  // named signal slot whose default lands in the slot table as UTF-8
  // default_bytes: 8 characters, 12 UTF-16 units, 15 bytes.
  const [greeting] = createSignal('héllo 🌍');

  return h('section', { id: 'app', 'data-note': 'naïve — déjà vu' },
    // 2-byte (ß), 3-byte (日本語) and 4-byte (🚀) UTF-8 sequences in one string.
    h('h1', null, 'Formaß — 日本語 — 🚀'),
    // ZWJ sequences and a regional-indicator pair: single "characters" to a
    // reader, 11 and 8 bytes to the length prefix.
    h('p', { class: 'lede', title: 'Ω ≈ ç √ ∫' }, 'Emoji: 👩‍💻 👨‍👩‍👧‍👦 🇯🇵'),
    // Non-ASCII next to the characters the walker HTML-escapes, so the golden
    // pins escaping and multi-byte decoding together.
    h('p', { class: 'mixed' }, 'Tom & Jerry ☕ <café> "über"'),
    h('span', null, () => greeting()),
  );
}

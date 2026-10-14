// A template literal keeps its escapes as written; the brace is still read.
export const t = `<iframe srcdoc="\u{7b}item.html}"></iframe>`; // expect: list-row-srcdoc
export const u = `<li>${1}<iframe srcdoc="\x7bitem.html}"></iframe></li>`; // expect: list-row-srcdoc

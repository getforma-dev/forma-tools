// The review's r21 (FORMA-126 review, should-fix 6): a string escape is the brace.
const T: &str = "<iframe srcdoc=\"\u{7b}item.html}\"></iframe>"; // expect: list-row-srcdoc
const U: &str = "<iframe srcdoc=\"\x7bitem.html}\"></iframe>"; // expect: list-row-srcdoc

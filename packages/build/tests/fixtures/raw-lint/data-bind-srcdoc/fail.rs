pub fn frame() -> &'static str {
    "<iframe sandbox data-bind:srcdoc=\"{doc}\"></iframe>" // expect: data-bind:srcdoc in frame
}

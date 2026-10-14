// Should-fix 3: config_script written after the literal.
fn builder(script: &str) {
    let mut c = base();
    c.config_script.get_or_insert(script); // expect: config_script in builder
}

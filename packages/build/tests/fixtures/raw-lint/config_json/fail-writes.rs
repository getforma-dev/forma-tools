// The review's r19 and should-fix 3: config_json written after the literal.
fn builder(v: &serde_json::Value) {
    let mut c = base();
    c.config_json = Some(v); // expect: config_json in builder
    c.config_json.replace(v); // expect: config_json in builder
    std::mem::replace(&mut c.config_json, Some(v)); // expect: config_json in builder
}

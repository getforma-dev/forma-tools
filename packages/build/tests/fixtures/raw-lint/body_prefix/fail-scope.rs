// The review's r09, r10, r11 and r24 (FORMA-126 review, should-fix 1): a
// RawHtml's trust is the binding's, not the name's.
use forma_server::{PageConfig, RawHtml};

fn good() {
    let shell = RawHtml::trusted("<main></main>"); // expect: RawHtml::trusted in good
    let c = PageConfig { body_prefix: Some(&shell) };
}

fn bad(shell: &str) {
    let c = PageConfig { body_prefix: Some(shell) }; // expect: body_prefix in bad
}

fn shadowed(user: &str) {
    let shell = RawHtml::trusted("<main></main>"); // expect: RawHtml::trusted in shadowed
    let shell = format!("<div>{}</div>", user);
    let c = PageConfig { body_prefix: Some(&shell) }; // expect: body_prefix in shadowed
}

fn inner_block(user: &str) {
    let shell = format!("<div>{}</div>", user);
    {
        let shell = RawHtml::trusted("<main></main>"); // expect: RawHtml::trusted in inner_block
    }
    let c = PageConfig { body_prefix: Some(&shell) }; // expect: body_prefix in inner_block
}

struct Holder {
    html: RawHtml,
}

fn field_name(html: &str) {
    let c = PageConfig { body_prefix: Some(html) }; // expect: body_prefix in field_name
}

struct App {
    shell: String,
}

impl App {
    fn page(&self) {
        let c = PageConfig { body_prefix: Some(&self.shell) }; // expect: body_prefix in App::page
    }
}

struct Other {
    shell: RawHtml,
}

fn closure_shadow(rows: Vec<String>) {
    let shell = RawHtml::trusted("<main></main>"); // expect: RawHtml::trusted in closure_shadow
    rows.iter().for_each(|shell| {
        let c = PageConfig { body_prefix: Some(shell) }; // expect: body_prefix in closure_shadow
    });
}

// The round-2 review: a let is trusted only when the constructor is its whole
// value; appended to, it is a String the user's text reaches.
fn appended(user: &str) {
    let shell = RawHtml::trusted("<x>").to_string() + user; // expect: RawHtml::trusted in appended
    let c = PageConfig { body_prefix: Some(&shell) }; // expect: body_prefix in appended
}

fn tail(markup: &str) {
    let shell = RawHtml::trusted(markup); // expect: RawHtml::trusted in tail
    let view = shell.as_str();
    let c = PageConfig { body_prefix: Some(&shell) };
}

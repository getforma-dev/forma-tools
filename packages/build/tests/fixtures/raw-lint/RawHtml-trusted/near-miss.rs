// RawHtml::trusted("<b>x</b>") in a comment is not a use.
/* RawHtml::trusted("<b>") /* nested */ RawHtml::trusted("<i>") */
/// Call RawHtml::trusted(markup) to vouch for markup.
pub fn note() -> &'static str {
    "RawHtml::trusted(markup)"
}

pub const RAW: &str = r#"RawHtml::trusted("x")"#;
pub const RAW2: &str = r##"a "# inside RawHtml::trusted("x")"##;

pub fn raw_html() -> String {
    let rawHtml = String::from("<b>a variable named rawHtml</b>");
    let raw_html = rawHtml;
    raw_html
}

pub fn typed(raw: &forma_server::RawHtml) -> &str {
    raw.as_str()
}

pub fn other() -> Other {
    Other::trusted("<b>another type's trusted</b>")
}

pub fn lifetimes<'a>(s: &'a str) -> &'a str {
    let quote = '"';
    let c = 'R';
    s
}

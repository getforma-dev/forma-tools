// RawHtml { r#html: .. } in a comment.
pub fn plain() -> &'static str {
    let html = "<b>a binding named html</b>";
    let r#type = 1;
    let _ = r#type;
    html
}
pub const RAW: &str = r#"html"#;

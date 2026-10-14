pub const LIST: &str = r#"<ul data-list="{rows}"><li><iframe srcdoc="<p>{item.body}</p>"></iframe></li></ul>"#; // expect: list-row-srcdoc

pub fn rows() -> String {
    format!("<iframe srcdoc=\"{{item.d}}\"></iframe>") // expect: list-row-srcdoc in rows
}

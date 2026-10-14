// body_prefix: Some(APP_SHELL) in a comment.
use crate::render::{body_prefix, other};
use forma_server::{AssetManifest, PageConfig, RawHtml};

pub fn none(manifest: &AssetManifest) {
    let config = PageConfig {
        body_prefix: None,
        config_json: None,
        #[allow(deprecated)]
        config_script: None,
    };
}

// A struct, an enum variant and a function of the application's own.
pub struct Page<'a> {
    body_prefix: Option<&'a str>,
}
pub enum Shape {
    Page { body_prefix: Option<String> },
}
pub fn helper(payload: &str) -> String {
    let prefix = body_prefix(payload, "/");
    let body_prefix = prefix.len();
    body_prefix.to_string()
}

// Reading the field is not setting it.
pub fn read(c: &PageConfig) -> bool {
    let PageConfig { body_prefix, .. } = c;
    c.body_prefix.is_some()
}

// A RawHtml held in a field or taken as a parameter is typed: its
// constructor is the raw entry, wherever it was made.
pub struct App {
    shell: RawHtml,
}
impl App {
    pub fn page(&self, manifest: &AssetManifest) {
        let config = PageConfig { body_prefix: Some(&self.shell), config_json: None };
    }
}
pub fn page(shell: &RawHtml, manifest: &AssetManifest) {
    let config = PageConfig { body_prefix: Some(shell.as_str()), config_json: None };
}

// Reading the field through Option methods writes nothing.
pub fn inspect(c: &PageConfig) -> usize {
    let taken = c.body_prefix.as_deref().unwrap_or("");
    let shared = &c.body_prefix;
    c.body_prefix.map(|p| p.len()).unwrap_or(0) + taken.len() + shared.is_some() as usize
}

use forma_server::{AssetManifest, PageConfig, RawHtml};

// fAuth's shape: a tenant logo the handler escapes before vouching for it.
pub fn logo(url: &str) -> RawHtml {
    RawHtml::trusted(format!("<img src=\"{url}\" alt=\"\">")) // expect: RawHtml::trusted in logo
}

pub fn shell() -> forma_server::RawHtml {
    forma_server::RawHtml::trusted("<main></main>") // expect: RawHtml::trusted in shell
}

pub fn qualified() -> RawHtml {
    <RawHtml>::trusted("<p></p>") // expect: RawHtml::trusted in qualified
}

pub fn closure() -> impl Fn(String) -> RawHtml {
    |s| RawHtml::trusted(s) // expect: RawHtml::trusted in closure
}

// The typed body_prefix: one raw entry, the constructor; the field is not reported.
pub fn page(manifest: &AssetManifest) {
    let shell = RawHtml::trusted("<main id=\"app\"></main>"); // expect: RawHtml::trusted in page
    let config = PageConfig {
        title: "Studio",
        body_prefix: Some(&shell),
        config_json: None,
    };
}

pub trait FromStatic {
    fn from_static(s: &'static str) -> Self;
}

impl FromStatic for RawHtml {
    fn from_static(s: &'static str) -> Self {
        Self::trusted(s) // expect: RawHtml::trusted in RawHtml::from_static
    }
}

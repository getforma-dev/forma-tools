use forma_server::{AssetManifest, PageConfig};

const APP_SHELL: &str = "<main id=\"app\"></main>";

// Generative UI's shape: a hand-written shell, a string.
pub fn index(manifest: &AssetManifest) {
    let config = PageConfig {
        title: "Studio",
        body_prefix: Some(APP_SHELL), // expect: body_prefix in index
        config_json: None,
    };
}

// fAuth's shape: a logo escaped by hand.
pub fn login(logo_html: String) {
    let config = PageConfig {
        body_prefix: if logo_html.is_empty() { None } else { Some(&logo_html) }, // expect: body_prefix in login
    };
}

pub fn shorthand(body_prefix: Option<&str>) {
    let config = PageConfig { title: "x", body_prefix }; // expect: body_prefix in shorthand
}

pub fn assigned(mut config: PageConfig<'_>, prefix: &str) {
    config.body_prefix = Some(prefix); // expect: body_prefix in assigned
}

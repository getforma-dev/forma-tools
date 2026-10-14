// Ledger's shape: data through the typed home.
pub fn page(json: &serde_json::Value) {
    let config = PageConfig {
        config_json: Some(json), // expect: config_json in page
        body_prefix: None,
    };
}

// GateWASM's shape: handler text in the deprecated script field.
pub fn page(script: &str) {
    #[allow(deprecated)]
    let config = PageConfig {
        #[allow(deprecated)]
        config_script: Some(script), // expect: config_script in page
        body_prefix: None,
    };
}

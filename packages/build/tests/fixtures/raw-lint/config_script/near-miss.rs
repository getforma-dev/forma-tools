// config_script: Some(&script) in a comment.
pub fn page(tenant: &str) -> String {
    let config_script = format!("window.TENANT = {};", tenant);
    config_script
}

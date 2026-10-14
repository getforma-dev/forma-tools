// config_json: Some(&json) in a comment.
pub fn page(root: &Root) {
    let config_json = serde_json::json!({ "config_json": 1 });
    let path = root.config_json_path();
    let config = PageConfig { config_json: None, body_prefix: None };
}

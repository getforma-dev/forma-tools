// RenderCtx::new().with_module_preloads(&p) in a comment.
pub fn load() -> ModulePreloads {
    assets::try_load_module_preloads::<Assets>()
}

pub fn ctx(preloads: &ModulePreloads) -> RenderCtx {
    RenderCtx::new().with_module_preloads(preloads) // expect: with_module_preloads in ctx
}

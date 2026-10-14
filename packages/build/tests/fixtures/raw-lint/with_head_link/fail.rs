// ksx Studio's shape: head links through their typed home.
pub fn ctx(icon: HeadLink) -> RenderCtx {
    RenderCtx::new()
        .with_head_link(icon) // expect: with_head_link in ctx
}

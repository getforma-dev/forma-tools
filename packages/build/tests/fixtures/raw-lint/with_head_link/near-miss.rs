// .with_head_link(link) in a comment.
pub fn icons(page: &mut String) {
    let link = HeadLink::new("icon", "/favicon.svg");
    with_icon_links(page);
}

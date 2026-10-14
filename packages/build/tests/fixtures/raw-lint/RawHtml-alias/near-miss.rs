// use forma_server::RawHtml as Markup; in a comment.
use forma_server::RawHtml;
use forma_server::{AssetManifest, PageConfig};

pub type Shells = Vec<RawHtml>;
pub type Pair = (RawHtml, forma_server::RawHtml);

pub fn same(a: &RawHtml, b: &RawHtml) -> bool {
    a.as_str() == b.as_str()
}

pub const NOTE: &str = "type Html = RawHtml;";

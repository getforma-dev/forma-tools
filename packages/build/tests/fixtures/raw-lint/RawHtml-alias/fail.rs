use forma_server::RawHtml as Markup; // expect: RawHtml-alias
use forma_server::{PageConfig, RawHtml as Shell}; // expect: RawHtml-alias
pub type Html = forma_server::RawHtml; // expect: RawHtml-alias

pub fn logo() -> Markup {
    Markup::trusted("<img>") // expect: RawHtml::trusted in logo
}

pub fn frame() -> Html {
    Html::trusted("<iframe></iframe>") // expect: RawHtml::trusted in frame
}

pub struct Wrapper;

impl std::ops::Deref for Wrapper {
    type Target = forma_server::RawHtml; // expect: RawHtml-alias in Wrapper
    fn deref(&self) -> &Self::Target {
        unimplemented!()
    }
}

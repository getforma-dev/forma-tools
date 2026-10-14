// An alias defined in another file is followed here.
pub fn studio() -> crate::Shell {
    Shell::trusted("<main></main>") // expect: RawHtml::trusted in studio
}

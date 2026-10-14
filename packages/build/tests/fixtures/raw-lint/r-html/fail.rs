pub fn forged() -> RawHtml {
    RawHtml { r#html: "<script></script>".into() } // expect: r#html in forged
}

pub fn studio_policy() -> PolicyExtensions {
    PolicyExtensions::new()
        .report_to("/csp-reports")
        .relax_trusted_types("app.ts writes innerHTML in four places; owner: studio") // expect: relax_trusted_types in studio_policy
}

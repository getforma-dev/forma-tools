// .relax_trusted_types("reason") in a comment.
pub fn policy() -> PolicyExtensions {
    PolicyExtensions::new().report_to("/csp-reports")
}
pub const NOTE: &str = "relax_trusted_types needs a reason";

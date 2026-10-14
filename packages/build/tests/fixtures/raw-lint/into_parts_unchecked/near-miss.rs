// resp.into_parts_unchecked() in a comment.
pub fn axum(resp: Response) {
    let (parts, body) = resp.into_parts();
    let note = "into_parts_unchecked";
}

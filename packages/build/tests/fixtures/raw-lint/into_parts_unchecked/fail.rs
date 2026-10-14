pub async fn stream(resp: PageResponse) {
    let parts = resp.into_parts_unchecked(); // expect: into_parts_unchecked in stream
}

pub fn as_function() {
    let split = PageResponse::into_parts_unchecked; // expect: into_parts_unchecked in as_function
}

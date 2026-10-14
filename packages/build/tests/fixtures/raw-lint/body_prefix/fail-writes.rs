// The review's r06, r07, r08, r13, r14 and r15 (FORMA-126 review, should-fix
// 3): body_prefix written through an Option method or a mutable borrow.
use forma_server::{PageConfig, RawHtml};

fn replace(mut c: PageConfig, s: &str) {
    c.body_prefix.replace(s); // expect: body_prefix in replace
}

fn insert(mut c: PageConfig, s: &str) {
    let _ = c.body_prefix.insert(s); // expect: body_prefix in insert
}

fn mem_replace(mut c: PageConfig, s: &str) {
    std::mem::replace(&mut c.body_prefix, Some(s)); // expect: body_prefix in mem_replace
}

fn ptr_write(c: &mut PageConfig, s: &'static str) {
    *(&mut c.body_prefix) = Some(s); // expect: body_prefix in ptr_write
}

fn get_or_insert(c: &mut PageConfig, s: &'static str) {
    c.body_prefix.get_or_insert(s); // expect: body_prefix in get_or_insert
}

fn through_ref(c: &mut PageConfig, s: &'static str) {
    let bp = &mut c.body_prefix; // expect: body_prefix in through_ref
    *bp = Some(s);
}

fn as_mut(c: &mut PageConfig, s: &'static str) {
    if let Some(p) = c.body_prefix.as_mut() { // expect: body_prefix in as_mut
        *p = s;
    }
}

// A RawHtml parameter: its constructor is the raw entry, wherever it was made.
fn typed_replace(mut c: PageConfig, shell: &RawHtml) {
    c.body_prefix.replace(shell);
}

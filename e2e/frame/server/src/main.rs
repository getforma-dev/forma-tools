//! The preview-frame e2e lane's server (FORMA-175): a small forma-server
//! application over the output `@getforma/build` wrote with `previewFrame`.
//!
//! ```text
//! forma-e2e-frame [port]      (default 0: any free port on 127.0.0.1)
//! ```
//!
//! It embeds the three outputs `../build-app.mjs` wrote, as an application
//! embeds its `dist` (rust-embed, compiled in), and at start does what an
//! application does: reads each manifest and calls `PreviewFrame::load` with
//! the origin it serves. Once it listens it prints one JSON line on stdout,
//! the origin and, per output, whether the frame loaded (the runtime's asset
//! and SHA-256) or the `FrameError`'s code; a frame that does not load is
//! reported, never a panic, so the spec names the code. It serves:
//!
//! - `/host`: the host page, the application's half of the frame (forma-server's
//!   `frame` module docs; L-12, L-33): an `iframe` with `sandbox="allow-scripts"`
//!   set before its `src` and its insertion, one `MessageChannel` port posted
//!   on its first load and nothing else, the frame torn down on any later
//!   load. Its policy is the strict one with `frame-src` the frame's exact URL.
//! - `/preview-frame`: `PageResponse::frame` from `dist-on`.
//! - `/__lane`: the JSON line again.

use std::sync::Arc;

use axum::extract::State;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use forma_server::assets::try_load_manifest;
use forma_server::{build_csp_header, CspNonce, PageResponse, PreviewFrame, FRAME_RUNTIME_ASSET};
use rust_embed::Embed;
use serde_json::{json, Value};

/// `previewFrame: true`.
#[derive(Embed)]
#[folder = "../out/dist-on/"]
struct On;

/// The same application without it.
#[derive(Embed)]
#[folder = "../out/dist-off/"]
struct Off;

/// `dist-on` with a runtime neither the build nor forma-server may inline.
#[derive(Embed)]
#[folder = "../out/dist-tampered/"]
struct Tampered;

struct Lane {
    origin: String,
    frame: Option<PreviewFrame>,
    report: Value,
}

/// Load the frame from the embedded output `A` as an application does at start.
fn load<A: Embed>(origin: &str) -> (Option<PreviewFrame>, Value) {
    let manifest = match try_load_manifest::<A>() {
        Ok(manifest) => manifest,
        Err(error) => return (None, json!({ "ok": false, "code": null, "error": error })),
    };
    let asset = manifest.assets.get(FRAME_RUNTIME_ASSET).cloned();
    match PreviewFrame::load::<A>(&manifest, origin) {
        Ok(frame) => {
            let embedded = asset.as_deref().and_then(A::get).map(|file| file.data.len());
            let report = json!({
                "ok": true,
                "asset": asset,
                "embeddedBytes": embedded,
                "debug": format!("{frame:?}"),
            });
            (Some(frame), report)
        }
        Err(error) => (
            None,
            json!({ "ok": false, "code": error.code(), "error": error.to_string(), "asset": asset }),
        ),
    }
}

fn html(body: String, policy: Option<String>) -> Response {
    let mut response = Response::new(body.into());
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(policy) = policy {
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_str(&policy).expect("a header value"),
        );
    }
    response
}

async fn host(State(lane): State<Arc<Lane>>) -> Response {
    let nonce = CspNonce::generate();
    let policy = format!(
        "{}; frame-src {}/preview-frame",
        build_csp_header(&nonce),
        lane.origin
    );
    let body = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Host</title></head>
<body>
<script nonce="{nonce}">
window.received = [];
window.loads = 0;
const frame = document.createElement('iframe');
frame.setAttribute('sandbox', 'allow-scripts'); // before src, before insertion
frame.id = 'preview';
frame.title = 'Preview';
frame.src = '/preview-frame';
const channel = new MessageChannel();
frame.addEventListener('load', () => {{
  if (++window.loads > 1) {{ channel.port1.close(); frame.remove(); window.tornDown = true; return; }}
  channel.port1.onmessage = (event) => {{ window.received.push(event.data); }};
  frame.contentWindow.postMessage(null, '*', [channel.port2]); // only the port
}});
window.send = (message) => channel.port1.postMessage(message);
document.body.append(frame);
</script>
</body>
</html>"#,
        nonce = nonce.as_str()
    );
    html(body, Some(policy))
}

async fn preview_frame(State(lane): State<Arc<Lane>>) -> Response {
    match &lane.frame {
        Some(frame) => match PageResponse::frame(frame) {
            Ok(page) => page.into_response(),
            Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.code()).into_response(),
        },
        None => (StatusCode::SERVICE_UNAVAILABLE, "the frame did not load at start").into_response(),
    }
}

async fn lane_report(State(lane): State<Arc<Lane>>) -> Response {
    let mut response = Response::new(lane.report.to_string().into());
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

#[tokio::main]
async fn main() {
    let port: u16 = match std::env::args().nth(1) {
        Some(port) => port.parse().expect("usage: forma-e2e-frame [port]"),
        None => 0,
    };
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("bind 127.0.0.1");
    let origin = format!(
        "http://127.0.0.1:{}",
        listener.local_addr().expect("a local address").port()
    );

    let (frame, on) = load::<On>(&origin);
    let (_, off) = load::<Off>(&origin);
    let (_, tampered) = load::<Tampered>(&origin);
    let report = json!({ "origin": origin, "on": on, "off": off, "tampered": tampered });
    // One line: the spec reads it to learn the port and what loaded.
    println!("{report}");

    let lane = Arc::new(Lane { origin, frame, report });
    let app = Router::new()
        .route("/host", get(host))
        .route("/preview-frame", get(preview_frame))
        .route("/__lane", get(lane_report))
        .with_state(lane);
    axum::serve(listener, app).await.expect("serve");
}

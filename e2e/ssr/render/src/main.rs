//! Render every built SSR e2e case with forma's real walker and page template.
//!
//! ```text
//! forma-e2e-render <cases-dir> <build-dir> <site-dir>
//! ```
//!
//! For each `<build-dir>/<case>/manifest.json` written by `@getforma/build`:
//!
//! - parse the `.ir` module the build emitted for route `/`;
//! - fill its slots from `<cases-dir>/<case>/slots.json` when that file exists
//!   (by slot name, `SlotData::from_json`, as a handler does), otherwise from the
//!   module's own defaults (`SlotData::new_from_defaults`, as the minimal
//!   template does);
//! - write `<site-dir>/<case>/index.html`, the Phase 2 page, and
//!   `<site-dir>/<case>/csr.html`, the same build client-rendered (Phase 1),
//!   each with a `.headers.json` holding the response headers
//!   `PageOutput::headers()` gives (CSP with the page's nonce, `no-store`, the
//!   document security headers).
//!
//! Any failure is fatal. In particular a Phase 2 render that fell back to
//! Phase 1 (`render_page` does that silently on a walk error) stops the run:
//! a case that is not server-rendered tests nothing.

use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use forma_ir::{IrModule, SlotData};
use forma_server::{render_page, AssetManifest, PageConfig, RenderMode};

/// The route every case is built and rendered under.
const ROUTE: &str = "/";
/// The page title `render_page` writes into `<head>`.
const TITLE: &str = "Forma SSR fixture";

fn main() {
    if let Err(err) = run() {
        eprintln!("forma-e2e-render: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [cases_dir, build_dir, site_dir] = args.as_slice() else {
        return Err("usage: forma-e2e-render <cases-dir> <build-dir> <site-dir>".into());
    };
    let (cases_dir, build_dir, site_dir) =
        (Path::new(cases_dir), Path::new(build_dir), Path::new(site_dir));

    let mut cases: Vec<PathBuf> = fs::read_dir(build_dir)?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.join("manifest.json").is_file())
        .collect();
    cases.sort();
    if cases.is_empty() {
        return Err(format!("no built cases under {}", build_dir.display()).into());
    }

    for dist in &cases {
        let name = dist
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("case directory name is not UTF-8")?;
        render_case(name, dist, &cases_dir.join(name), &site_dir.join(name))
            .map_err(|err| format!("case {name}: {err}"))?;
    }
    Ok(())
}

fn render_case(name: &str, dist: &Path, source: &Path, out: &Path) -> Result<(), Box<dyn Error>> {
    let manifest: AssetManifest =
        serde_json::from_str(&fs::read_to_string(dist.join("manifest.json"))?)?;
    let ir_file = manifest
        .route(ROUTE)
        .and_then(|route| route.ir.clone())
        .ok_or("the manifest names no .ir module for route / (the build emitted no IR)")?;
    let module = IrModule::parse(&fs::read(dist.join(&ir_file))?)?;

    let slots_path = source.join("slots.json");
    let slots = if slots_path.is_file() {
        SlotData::from_json(&fs::read_to_string(&slots_path)?, &module)?
    } else {
        SlotData::new_from_defaults(&module.slots)
    };

    fs::create_dir_all(out)?;
    for (file, mode) in [
        ("index", RenderMode::Phase2SsrReconcile),
        ("csr", RenderMode::Phase1ClientMount),
    ] {
        let page = render_page(&PageConfig {
            title: TITLE,
            route_pattern: ROUTE,
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: mode,
            ir_module: Some(&module),
            slots: Some(&slots),
        });

        let server_rendered = page.html.contains("<div id=\"app\" data-forma-ssr>");
        if server_rendered != (mode == RenderMode::Phase2SsrReconcile) {
            return Err(format!(
                "{file}.html: expected {mode:?}, but the page {} server-rendered \
                 (render_page falls back to Phase 1 when the walk fails)",
                if server_rendered { "is" } else { "is not" }
            )
            .into());
        }

        let mut headers = serde_json::Map::new();
        for (header, value) in page.headers() {
            headers.insert(
                header.as_str().to_string(),
                serde_json::Value::String(value.to_str()?.to_string()),
            );
        }
        fs::write(out.join(format!("{file}.html")), &page.html)?;
        fs::write(
            out.join(format!("{file}.headers.json")),
            serde_json::to_string_pretty(&headers)?,
        )?;
    }

    println!("rendered {name}: index.html (Phase 2), csr.html (Phase 1), module {ir_file}");
    Ok(())
}

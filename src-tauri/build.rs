use std::env;
use std::fs;
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_SECRET");

    let env_path = Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join("../.env");
    println!("cargo:rerun-if-changed={}", env_path.display());
    // CI sets these in the environment; local builds read them from .env.
    for key in ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] {
        if env::var_os(key).is_some_and(|v| !v.is_empty()) {
            continue;
        }
        if let Ok(text) = fs::read_to_string(&env_path) {
            for line in text.lines() {
                let Some((k, v)) = line.trim().split_once('=') else { continue };
                if k == key {
                    let v = v.trim().trim_matches(['"', '\'']);
                    if !v.is_empty() {
                        println!("cargo:rustc-env={key}={v}");
                    }
                    break;
                }
            }
        }
    }

    tauri_build::build()
}

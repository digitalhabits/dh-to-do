/// The Google client id and secret, and the Microsoft client id, reach
/// `option_env!` in google.rs and microsoft.rs from the environment (GitHub
/// Actions) or, for a local build, from `apps/todo/.env` (gitignored). None
/// is ever committed. Without them the app builds and has no such sign-in.
fn sign_in_client_env() {
  const KEYS: [&str; 3] = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MICROSOFT_CLIENT_ID"];
  for key in KEYS {
    println!("cargo:rerun-if-env-changed={key}");
  }
  let env_path =
    std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../.env");
  println!("cargo:rerun-if-changed={}", env_path.display());
  let Ok(text) = std::fs::read_to_string(&env_path) else {
    return;
  };
  for key in KEYS {
    if std::env::var_os(key).is_some_and(|v| !v.is_empty()) {
      continue;
    }
    for line in text.lines() {
      let Some((k, v)) = line.trim().split_once('=') else {
        continue;
      };
      if k.trim() == key {
        let v = v.trim().trim_matches(['"', '\'']);
        if !v.is_empty() {
          println!("cargo:rustc-env={key}={v}");
        }
        break;
      }
    }
  }
}

fn main() {
  sign_in_client_env();
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(
      // The webview runs the shared TypeScript store; the board reaches
      // SQLite through the two-command bridge. Rust keeps the pieces that
      // must be native: the OAuth broker flow, EventKit, and the focus
      // window (an NSPanel on macOS).
      tauri_build::AppManifest::new().commands(&[
        "todo_sql_query",
        "todo_sql_batch",
        "todo_is_demo",
        "todo_media_write",
        "todo_media_read",
        "save_backup",
        "save_note_image",
        "open_focus_popout",
        "close_focus_popout",
        "set_focus_popout_height",
        "enter_fullscreen_focus",
        "exit_fullscreen_focus",
        "exit_fullscreen_focus_to_home",
        "start_basecamp_auth",
        "handle_oauth_callback",
        "google_status",
        "start_google_auth",
        "google_access_token",
        "google_disconnect",
        "microsoft_status",
        "start_microsoft_auth",
        "microsoft_access_token",
        "microsoft_disconnect",
        "request_store_review",
        "fetch_reminders_lists",
        "fetch_reminders_tasks",
        "update_reminders_status",
        "update_reminders_title",
        "update_reminders_notes",
        "update_reminders_due",
        "delete_reminders_task",
        "create_reminders_task",
        "open_reminders_privacy_settings",
      ]),
    ),
  )
  .expect("failed to run tauri-build");
}

//! The demo app: `pnpm app:dev:demo`, for videos and screenshots.
//!
//! It is the same app with another identifier (tauri.demo.conf.json), so it
//! has its own data directory and its own SQLite file. The page fills that
//! file with an invented board each time it starts (apps/todo/src/demo).
//!
//! The identifier is the only switch. The page asks here before it writes
//! anything, so a build flag alone can never put the invented board over a
//! real one.

use tauri::{AppHandle, Runtime};

/// The identifier in tauri.demo.conf.json.
const DEMO_IDENTIFIER: &str = "com.redd.do.demo";

/// The web view store of every demo window (macOS 14 and later).
///
/// A dev build keeps its web view storage under the binary's name, not the
/// identifier, so without this the demo shared localStorage — the calendar's
/// notes, events and settings — with the normal dev build.
pub const DEMO_DATA_STORE: [u8; 16] = *b"dh-todo-demo-v1.";

pub fn is_demo<R: Runtime>(app: &AppHandle<R>) -> bool {
  app.config().identifier == DEMO_IDENTIFIER
}

/// Whether this is the demo app. The page fills the board only when it is.
#[tauri::command]
pub fn todo_is_demo(app: AppHandle) -> bool {
  is_demo(&app)
}

/// The demo's main window, with the demo's store.
///
/// tauri.demo.conf.json sets `create: false` on it, and it is made here: the
/// store cannot be given in the config, whose generated code does not
/// compile with `dataStoreIdentifier` in it (Tauri 2.11).
pub fn create_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
  let Some(config) = app.config().app.windows.first().cloned() else {
    return Ok(());
  };
  tauri::WebviewWindowBuilder::from_config(app, &config)?
    .data_store_identifier(DEMO_DATA_STORE)
    .build()?;
  Ok(())
}

/// The web view store a new window of this app gets: the demo's in the
/// demo, and the default (None) otherwise.
pub fn data_store<R: Runtime>(app: &AppHandle<R>) -> Option<[u8; 16]> {
  is_demo(app).then_some(DEMO_DATA_STORE)
}

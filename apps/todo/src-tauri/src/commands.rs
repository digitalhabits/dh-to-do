use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::db::{SqlStatement, TodoDb};

fn map_err(e: impl ToString) -> String {
  e.to_string()
}

/// The identifier that test builds of 3.x had before its release.
const PREVIEW_IDENTIFIER: &str = "org.digitalhabits.todo";

/// Take over the board of a 3.x test build, once.
///
/// The released app has the identifier of 2.x, `com.redd.do`, so that it
/// updates 2.x in the stores and finds the 2.x board in its web view storage.
/// Test builds of 3.x had another identifier, and so another data directory.
/// Somebody who used one has a board there, and would open an empty app.
///
/// Only when this app has no board yet, so nothing is ever written over. The
/// old file is copied and left where it is. Inside the App Store sandbox the
/// old directory cannot be read, and then nothing happens: no test build was
/// ever in the sandbox.
fn adopt_preview_board(path: &std::path::Path) {
  if path.exists() {
    return;
  }
  let Some(data_dir) = path.parent() else { return };
  let Some(old_dir) = data_dir.parent().map(|p| p.join(PREVIEW_IDENTIFIER)) else {
    return;
  };
  let Some(name) = path.file_name().and_then(|n| n.to_str()) else { return };
  if !old_dir.join(name).is_file() {
    return;
  }
  if let Err(e) = std::fs::create_dir_all(data_dir) {
    log::warn!("Could not make {}: {e}", data_dir.display());
    return;
  }
  // The write-ahead log can hold the newest rows, so it comes too.
  for suffix in ["", "-wal", "-shm"] {
    let from = old_dir.join(format!("{name}{suffix}"));
    if !from.is_file() {
      continue;
    }
    let to = data_dir.join(format!("{name}{suffix}"));
    match std::fs::copy(&from, &to) {
      Ok(_) => log::info!("Took over {} from a 3.x test build", from.display()),
      Err(e) => log::warn!("Could not copy {}: {e}", from.display()),
    }
  }
}

/// Open (or create) the SQLite file under the app data directory.
pub fn init_db(app: &AppHandle) -> Result<TodoDb, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("app_data_dir: {e}"))?;
  let path = TodoDb::default_path(dir);
  adopt_preview_board(&path);
  log::info!("Opening To-Do SQLite at {}", path.display());
  TodoDb::open(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn todo_sql_query(
  db: State<'_, TodoDb>,
  statement: SqlStatement,
) -> Result<Value, String> {
  db.sql_query(&statement).map_err(map_err)
}


#[tauri::command]
pub fn todo_sql_batch(
  db: State<'_, TodoDb>,
  statements: Vec<SqlStatement>,
) -> Result<(), String> {
  db.sql_batch(&statements).map_err(map_err)
}

/// A note picture into the SQLite file. Base64 across the bridge, because
/// the invoke channel carries JSON. See tauri-media.ts.
#[tauri::command]
pub fn todo_media_write(
  db: State<'_, TodoDb>,
  bytes_base64: String,
  content_type: String,
  filename: String,
  width: Option<i64>,
  height: Option<i64>,
) -> Result<Value, String> {
  use base64::Engine;
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(bytes_base64.as_bytes())
    .map_err(map_err)?;
  db.media_write(&bytes, &content_type, &filename, width, height)
    .map_err(map_err)
}

/// A note picture out of the SQLite file, for the sync to give to Basecamp.
/// The web view draws pictures on the `todo-media` scheme instead.
#[tauri::command]
pub fn todo_media_read(
  db: State<'_, TodoDb>,
  id: String,
) -> Result<Option<Value>, String> {
  use base64::Engine;
  Ok(db.media_read(&id).map_err(map_err)?.map(
    |(bytes, content_type, filename)| {
      json!({
        "bytesBase64": base64::engine::general_purpose::STANDARD.encode(bytes),
        "contentType": content_type,
        "filename": filename,
      })
    },
  ))
}

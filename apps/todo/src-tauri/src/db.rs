//! Local SQLite board for standalone Digital Habits: To-Do.

use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use thiserror::Error;

const SCHEMA_VERSION: i32 = 13;

#[derive(Debug, Error)]
pub enum DbError {
  #[error("{0}")]
  Message(String),
  #[error(transparent)]
  Sqlite(#[from] rusqlite::Error),
}

pub type DbResult<T> = Result<T, DbError>;

#[derive(Clone)]
pub struct TodoDb {
  conn: Arc<Mutex<Connection>>,
}

impl TodoDb {
  pub fn open(path: &Path) -> DbResult<Self> {
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent).map_err(|e| {
        DbError::Message(format!("Could not create data directory: {e}"))
      })?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    let db = Self {
      conn: Arc::new(Mutex::new(conn)),
    };
    db.migrate()?;
    Ok(db)
  }

  pub fn default_path(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir.join("todo.sqlite3")
  }

  fn migrate(&self) -> DbResult<()> {
    let conn = self.conn.lock();
    conn.execute_batch(
      r#"
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
      );
      "#,
    )?;
    let version: i32 = conn
      .query_row(
        "SELECT version FROM schema_version LIMIT 1",
        [],
        |row| row.get(0),
      )
      .optional()?
      .unwrap_or(0);

    if version < 1 {
      conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS todo_groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          colour TEXT,
          position REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS todo_lists (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          group_id TEXT REFERENCES todo_groups (id) ON DELETE SET NULL,
          colour TEXT,
          emoji TEXT,
          position REAL NOT NULL DEFAULT 0,
          basecamp_project_id TEXT,
          basecamp_list_id TEXT,
          reminders_list_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS todo_lists_group_idx
          ON todo_lists (group_id, position);

        CREATE TABLE IF NOT EXISTS todo_people (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          colour TEXT,
          photo_url TEXT,
          source_kind TEXT,
          source_id TEXT,
          position REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS todo_tasks (
          id TEXT PRIMARY KEY,
          list_id TEXT NOT NULL REFERENCES todo_lists (id) ON DELETE CASCADE,
          text TEXT NOT NULL DEFAULT '',
          notes_html TEXT,
          completed INTEGER NOT NULL DEFAULT 0,
          completed_at TEXT,
          is_favourite INTEGER NOT NULL DEFAULT 0,
          favourite_position REAL,
          is_backlog INTEGER NOT NULL DEFAULT 0,
          is_today INTEGER NOT NULL DEFAULT 0,
          colour TEXT,
          expected_duration_minutes INTEGER,
          time_spent_seconds INTEGER NOT NULL DEFAULT 0,
          position REAL NOT NULL DEFAULT 0,
          basecamp_id TEXT,
          reminders_id TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS todo_tasks_list_idx
          ON todo_tasks (list_id, completed, position);

        CREATE TABLE IF NOT EXISTS todo_task_assignees (
          task_id TEXT NOT NULL REFERENCES todo_tasks (id) ON DELETE CASCADE,
          person_id TEXT NOT NULL REFERENCES todo_people (id) ON DELETE CASCADE,
          position REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (task_id, person_id)
        );

        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (1);
        "#,
      )?;
    }

    let version: i32 = conn
      .query_row(
        "SELECT version FROM schema_version LIMIT 1",
        [],
        |row| row.get(0),
      )
      .optional()?
      .unwrap_or(0);

    if version < 2 {
      conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS todo_basecamp_connection (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          account_id TEXT NOT NULL,
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          email TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (2);
        "#,
      )?;
    }

    let version: i32 = conn
      .query_row(
        "SELECT version FROM schema_version LIMIT 1",
        [],
        |row| row.get(0),
      )
      .optional()?
      .unwrap_or(0);

    if version < 3 {
      // Basecamp assignee sync. `basecamp_person_id` says who a person is in
      // Basecamp; `source_kind` / `source_id` keep saying where the row came
      // from. `assignees_updated_at` stamps assignment changes on their own,
      // so an unrelated edit cannot overwrite a reassignment made in Basecamp.
      conn.execute_batch(
        r#"
        ALTER TABLE todo_people ADD COLUMN email TEXT;
        ALTER TABLE todo_people ADD COLUMN basecamp_person_id TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS todo_people_basecamp_person_idx
          ON todo_people (basecamp_person_id)
          WHERE basecamp_person_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS todo_people_email_idx
          ON todo_people (lower(email))
          WHERE email IS NOT NULL;
        ALTER TABLE todo_tasks ADD COLUMN assignees_updated_at TEXT;
        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (3);
        "#,
      )?;
    }

    let version: i32 = conn
      .query_row(
        "SELECT version FROM schema_version LIMIT 1",
        [],
        |row| row.get(0),
      )
      .optional()?
      .unwrap_or(0);

    if version < 4 {
      // One Basecamp to-do maps to one local task. The pull half of the sync
      // decides that a remote to-do is new from a task snapshot that it reads
      // before it calls the Basecamp API. Two syncs that overlap both read the
      // snapshot before either one inserts, so both insert the same to-do.
      // The index rejects the second insert. One app instance makes the race
      // rare here, but the planner shares this sync design over Postgres and
      // hit it, so the guarantee belongs in both stores.
      conn.execute_batch(
        r#"
        DELETE FROM todo_tasks
         WHERE basecamp_id IS NOT NULL
           AND rowid NOT IN (
             SELECT MIN(rowid) FROM todo_tasks
              WHERE basecamp_id IS NOT NULL
              GROUP BY list_id, basecamp_id
           );
        CREATE UNIQUE INDEX IF NOT EXISTS todo_tasks_basecamp_id_idx
          ON todo_tasks (list_id, basecamp_id)
          WHERE basecamp_id IS NOT NULL;
        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (4);
        "#,
      )?;
    }

    if version < 5 {
      // What each task last agreed with Basecamp.
      //
      // The sync compared the two live copies and let the newer clock win.
      // That cannot tell "somebody edited this" from "the other side
      // reformatted it", and Basecamp reformats every push — it keeps its
      // own subset of HTML and rewrites the rest. So an untouched note read
      // as an edit, and the newer clock overwrote a real edit with it.
      //
      // These three hold the last state both sides are known to have held.
      // Null means no exchange has been recorded, so nothing needs
      // backfilling: the sync falls back to the old comparison once and
      // writes a base as it goes.
      conn.execute_batch(
        r#"
        ALTER TABLE todo_tasks ADD COLUMN basecamp_base_text TEXT;
        ALTER TABLE todo_tasks ADD COLUMN basecamp_base_notes TEXT;
        ALTER TABLE todo_tasks ADD COLUMN basecamp_base_completed INTEGER;
        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (5);
        "#,
      )?;
    }

    let version: i32 = conn
      .query_row(
        "SELECT version FROM schema_version LIMIT 1",
        [],
        |row| row.get(0),
      )
      .optional()?
      .unwrap_or(0);

    if version < 6 {
      // Someday column: work that is not in the real backlog.
      conn.execute_batch(
        r#"
        ALTER TABLE todo_tasks ADD COLUMN is_someday INTEGER NOT NULL DEFAULT 0;
        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (6);
        "#,
      )?;
    }

    if version < 7 {
      // Subtasks — Basecamp's "steps", one row per step. The base columns
      // serve the same three-copy sync the tasks use.
      conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS todo_subtasks (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES todo_tasks (id) ON DELETE CASCADE,
          text TEXT NOT NULL DEFAULT '',
          completed INTEGER NOT NULL DEFAULT 0,
          position REAL NOT NULL DEFAULT 0,
          basecamp_id TEXT,
          basecamp_base_text TEXT,
          basecamp_base_completed INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS todo_subtasks_task_idx
          ON todo_subtasks (task_id, position);
        CREATE UNIQUE INDEX IF NOT EXISTS todo_subtasks_basecamp_idx
          ON todo_subtasks (task_id, basecamp_id)
          WHERE basecamp_id IS NOT NULL;
        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (7);
        "#,
      )?;
    }

    if version < 8 {
      // A subtask is a task with a parent — see Postgres migration 066.
      // The rows move over, ids and Basecamp links intact, and the thin
      // table goes.
      conn.execute_batch(
        r#"
        ALTER TABLE todo_tasks ADD COLUMN parent_task_id TEXT
          REFERENCES todo_tasks (id) ON DELETE CASCADE;
        CREATE INDEX IF NOT EXISTS todo_tasks_parent_idx
          ON todo_tasks (parent_task_id)
          WHERE parent_task_id IS NOT NULL;
        INSERT OR IGNORE INTO todo_tasks
          (id, list_id, parent_task_id, text, completed, completed_at, position,
           basecamp_id, basecamp_base_text, basecamp_base_completed,
           created_at, updated_at)
        SELECT s.id, t.list_id, s.task_id, s.text, s.completed,
               CASE WHEN s.completed THEN s.updated_at ELSE NULL END,
               s.position, s.basecamp_id, s.basecamp_base_text,
               s.basecamp_base_completed, s.created_at, s.updated_at
          FROM todo_subtasks s
          JOIN todo_tasks t ON t.id = s.task_id;
        DROP TABLE todo_subtasks;
        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (8);
        "#,
      )?;
    }

    if version < 9 {
      // A due date, in Basecamp's shape: YYYY-MM-DD as text — see Postgres
      // migration 074. The base column serves the three-copy sync.
      conn.execute_batch(
        r#"
        ALTER TABLE todo_tasks ADD COLUMN due_on TEXT;
        ALTER TABLE todo_tasks ADD COLUMN basecamp_base_due_on TEXT;
        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (9);
        "#,
      )?;
    }

    if version < 10 {
      // The due date a task was last put in Today for — see Postgres
      // migration 075.
      conn.execute_batch(
        r#"
        ALTER TABLE todo_tasks ADD COLUMN due_promoted_on TEXT;
        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (10);
        "#,
      )?;
    }

    if version < 11 {
      // A task may have no list — see Postgres migration 077. SQLite cannot
      // drop NOT NULL in place, so the table is made again without it and
      // the rows move over, ids intact. Foreign keys are off for the
      // rebuild: on, dropping the old table would take the assignees with
      // it. The rename points the assignees' reference at the new table.
      conn.execute_batch(
        r#"
        PRAGMA foreign_keys = OFF;
        CREATE TABLE todo_tasks_v11 (
          id TEXT PRIMARY KEY,
          list_id TEXT REFERENCES todo_lists (id) ON DELETE CASCADE,
          text TEXT NOT NULL DEFAULT '',
          notes_html TEXT,
          completed INTEGER NOT NULL DEFAULT 0,
          completed_at TEXT,
          is_favourite INTEGER NOT NULL DEFAULT 0,
          favourite_position REAL,
          is_backlog INTEGER NOT NULL DEFAULT 0,
          is_today INTEGER NOT NULL DEFAULT 0,
          colour TEXT,
          expected_duration_minutes INTEGER,
          time_spent_seconds INTEGER NOT NULL DEFAULT 0,
          position REAL NOT NULL DEFAULT 0,
          basecamp_id TEXT,
          reminders_id TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          assignees_updated_at TEXT,
          basecamp_base_text TEXT,
          basecamp_base_notes TEXT,
          basecamp_base_completed INTEGER,
          is_someday INTEGER NOT NULL DEFAULT 0,
          parent_task_id TEXT REFERENCES todo_tasks_v11 (id) ON DELETE CASCADE,
          due_on TEXT,
          basecamp_base_due_on TEXT,
          due_promoted_on TEXT
        );
        INSERT INTO todo_tasks_v11
          (id, list_id, text, notes_html, completed, completed_at,
           is_favourite, favourite_position, is_backlog, is_today, colour,
           expected_duration_minutes, time_spent_seconds, position,
           basecamp_id, reminders_id, created_by, created_at, updated_at,
           assignees_updated_at, basecamp_base_text, basecamp_base_notes,
           basecamp_base_completed, is_someday, parent_task_id, due_on,
           basecamp_base_due_on, due_promoted_on)
        SELECT
           id, list_id, text, notes_html, completed, completed_at,
           is_favourite, favourite_position, is_backlog, is_today, colour,
           expected_duration_minutes, time_spent_seconds, position,
           basecamp_id, reminders_id, created_by, created_at, updated_at,
           assignees_updated_at, basecamp_base_text, basecamp_base_notes,
           basecamp_base_completed, is_someday, parent_task_id, due_on,
           basecamp_base_due_on, due_promoted_on
          FROM todo_tasks;
        DROP TABLE todo_tasks;
        ALTER TABLE todo_tasks_v11 RENAME TO todo_tasks;
        CREATE INDEX IF NOT EXISTS todo_tasks_list_idx
          ON todo_tasks (list_id, completed, position);
        CREATE UNIQUE INDEX IF NOT EXISTS todo_tasks_basecamp_id_idx
          ON todo_tasks (list_id, basecamp_id)
          WHERE basecamp_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS todo_tasks_parent_idx
          ON todo_tasks (parent_task_id)
          WHERE parent_task_id IS NOT NULL;
        PRAGMA foreign_keys = ON;
        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (11);
        "#,
      )?;
    }

    if version < 12 {
      // Pictures in notes that Basecamp does not hold — a task on no list,
      // or on a list Basecamp does not know. The note names one by id on
      // its tag (see media-store.ts); the web view reads it on the
      // `todo-media` scheme. The planner keeps the same in its private
      // bucket.
      conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS todo_media (
          id TEXT PRIMARY KEY,
          content_type TEXT NOT NULL,
          filename TEXT NOT NULL DEFAULT '',
          filesize INTEGER NOT NULL,
          width INTEGER,
          height INTEGER,
          bytes BLOB NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (12);
        "#,
      )?;
    }

    if version < 13 {
      // A task with a due date can be shown on the Calendar view, on its
      // due day. Off until the reader asks for it. See Postgres migration
      // 083.
      conn.execute_batch(
        r#"
        ALTER TABLE todo_tasks ADD COLUMN show_on_calendar INTEGER NOT NULL DEFAULT 0;
        DELETE FROM schema_version;
        INSERT INTO schema_version (version) VALUES (13);
        "#,
      )?;
    }

    let _ = SCHEMA_VERSION;
    Ok(())
  }
}

/// One statement from the TypeScript store: portable SQL plus its parameters.
#[derive(serde::Deserialize)]
pub struct SqlStatement {
  pub sql: String,
  #[serde(default)]
  pub params: Vec<Value>,
}

/// What one statement produced: the rows it returned, and how many rows it
/// changed. The TypeScript driver reads both, because the store checks
/// `rowCount` on updates and reads `RETURNING` rows on inserts.
fn run_statement(
  conn: &Connection,
  statement: &SqlStatement,
) -> DbResult<Value> {
  let mut prepared = conn.prepare(&statement.sql)?;
  let column_names: Vec<String> =
    prepared.column_names().iter().map(|s| s.to_string()).collect();
  let bound = rusqlite::params_from_iter(
    statement.params.iter().map(json_to_sql),
  );
  let mut rows_out: Vec<Value> = Vec::new();
  let mut rows = prepared.query(bound)?;
  while let Some(row) = rows.next()? {
    let mut object = Map::new();
    for (index, name) in column_names.iter().enumerate() {
      object.insert(name.clone(), sql_to_json(row.get_ref(index)?));
    }
    rows_out.push(Value::Object(object));
  }
  drop(rows);
  drop(prepared);
  Ok(json!({ "rows": rows_out, "rowCount": conn.changes() }))
}

fn json_to_sql(value: &Value) -> rusqlite::types::Value {
  use rusqlite::types::Value as Sql;
  match value {
    Value::Null => Sql::Null,
    // SQLite has no boolean type. The schema stores 0 and 1.
    Value::Bool(b) => Sql::Integer(if *b { 1 } else { 0 }),
    Value::Number(n) => {
      if let Some(i) = n.as_i64() {
        Sql::Integer(i)
      } else {
        Sql::Real(n.as_f64().unwrap_or(0.0))
      }
    }
    Value::String(s) => Sql::Text(s.clone()),
    // Arrays and objects have no SQLite shape. Store their JSON.
    other => Sql::Text(other.to_string()),
  }
}

fn sql_to_json(value: rusqlite::types::ValueRef<'_>) -> Value {
  use rusqlite::types::ValueRef;
  match value {
    ValueRef::Null => Value::Null,
    ValueRef::Integer(i) => json!(i),
    ValueRef::Real(f) => json!(f),
    ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
    ValueRef::Blob(_) => Value::Null,
  }
}

impl TodoDb {
  /// Run one statement for the TypeScript store.
  pub fn sql_query(&self, statement: &SqlStatement) -> DbResult<Value> {
    let conn = self.conn.lock();
    run_statement(&conn, statement)
  }

  /// Run statements inside one transaction, so a failure changes nothing.
  /// The portable form of what a Postgres data-modifying CTE does in one
  /// statement — see setTaskAssignees in people-store.ts.
  pub fn sql_batch(&self, statements: &[SqlStatement]) -> DbResult<()> {
    let mut conn = self.conn.lock();
    let tx = conn.transaction()?;
    for statement in statements {
      run_statement(&tx, statement)?;
    }
    tx.commit()?;
    Ok(())
  }
}

impl TodoDb {
  /// Keep a note picture. Answers with what the note's tag needs.
  pub fn media_write(
    &self,
    bytes: &[u8],
    content_type: &str,
    filename: &str,
    width: Option<i64>,
    height: Option<i64>,
  ) -> DbResult<Value> {
    let id = uuid::Uuid::new_v4().to_string();
    let conn = self.conn.lock();
    conn.execute(
      "INSERT INTO todo_media (id, content_type, filename, filesize, width, height, bytes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      rusqlite::params![id, content_type, filename, bytes.len() as i64, width, height, bytes],
    )?;
    Ok(json!({
      "id": id,
      "contentType": content_type,
      "filename": filename,
      "filesize": bytes.len(),
      "width": width,
      "height": height,
    }))
  }

  /// A note picture: its bytes, content type and file name.
  pub fn media_read(&self, id: &str) -> DbResult<Option<(Vec<u8>, String, String)>> {
    let conn = self.conn.lock();
    let found = conn
      .query_row(
        "SELECT bytes, content_type, filename FROM todo_media WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
      )
      .optional()?;
    Ok(found)
  }
}

#[cfg(test)]
mod media_tests {
  use super::*;
  use uuid::Uuid;

  #[test]
  fn a_note_picture_comes_back_as_it_went_in() {
    let path = std::env::temp_dir()
      .join(format!("todo-media-test-{}.sqlite3", Uuid::new_v4()));
    let db = TodoDb::open(&path).expect("open");
    let bytes: Vec<u8> = (0..=255u8).collect();
    let stored = db
      .media_write(&bytes, "image/png", "shot.png", Some(640), Some(480))
      .expect("write");
    let id = stored["id"].as_str().expect("id").to_string();
    assert_eq!(stored["filesize"], json!(256));
    let (back, content_type, filename) =
      db.media_read(&id).expect("read").expect("found");
    assert_eq!(back, bytes);
    assert_eq!(content_type, "image/png");
    assert_eq!(filename, "shot.png");
    assert!(db.media_read("nothing").expect("read").is_none());
    // The generic bridge never leaks the bytes: a blob reads as null there.
    let row = db
      .sql_query(&SqlStatement {
        sql: "SELECT bytes, filesize FROM todo_media WHERE id = ?1".into(),
        params: vec![json!(id)],
      })
      .expect("query");
    assert!(row["rows"][0]["bytes"].is_null());
    assert_eq!(row["rows"][0]["filesize"], json!(256));
  }
}

#[cfg(test)]
mod bridge_tests {
  use super::*;
  use uuid::Uuid;

  /// The statements here are the exact output of toSqlite() in
  /// sqlite-driver.ts over the store's SQL — generated, not hand-written.
  /// The test proves the translated dialect runs against the real schema:
  /// placeholders, datetime('now'), CASE on 0/1, ON CONFLICT, RETURNING.
  #[test]
  fn translated_store_sql_runs() {
    let path = std::env::temp_dir()
      .join(format!("todo-bridge-test-{}.sqlite3", Uuid::new_v4()));
    let db = TodoDb::open(&path).expect("open");

    let q = |sql: &str, params: Vec<Value>| {
      db.sql_query(&SqlStatement { sql: sql.into(), params })
        .expect("query")
    };

    q(
      "INSERT INTO todo_lists (id, name, position) VALUES (?1, ?2, 1)",
      vec![json!("list-1"), json!("List")],
    );

    // create_task, translated: CASE WHEN ?8 THEN datetime('now'), position
    // subselect, ON CONFLICT DO NOTHING, RETURNING *.
    let create = "INSERT INTO todo_tasks\n       (id, list_id, text, expected_duration_minutes, is_favourite, is_backlog,\n        is_today, is_someday, completed, completed_at, reminders_id, position, created_by)\n     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,\n             CASE WHEN ?9 THEN datetime('now') ELSE NULL END,\n             ?10,\n             (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_tasks\n               WHERE list_id = ?2 AND NOT completed),\n             ?11)\n     ON CONFLICT (id) DO NOTHING\n     RETURNING *";
    let params = vec![
      json!("task-1"), json!("list-1"), json!("hello"), json!(null),
      json!(0), json!(0), json!(1), json!(0), json!(0), json!(null), json!("mcp:test"),
    ];
    let made = q(create, params.clone());
    assert_eq!(made["rows"].as_array().unwrap().len(), 1);
    assert!(made["rows"][0]["completed_at"].is_null());
    assert_eq!(made["rows"][0]["is_today"], json!(1));

    // Replaying the same create returns no rows: the store reads that as
    // "already exists" and loads the row instead.
    let replay = q(create, params);
    assert_eq!(replay["rows"].as_array().unwrap().len(), 0);

    // setTaskAssignees, translated: the batch that replaced the Postgres CTE.
    q(
      "INSERT INTO todo_people (id, name, position) VALUES (?1, ?2, 1)",
      vec![json!("person-1"), json!("Someone")],
    );
    db.sql_batch(&[
      SqlStatement {
        sql: "DELETE FROM todo_task_assignees\n                WHERE task_id = ?1\n                  AND person_id NOT IN (?2)".into(),
        params: vec![json!("task-1"), json!("person-1")],
      },
      SqlStatement {
        sql: "UPDATE todo_tasks SET assignees_updated_at = ?2 WHERE id = ?1".into(),
        params: vec![json!("task-1"), json!("2026-08-13T12:00:00.000Z")],
      },
      SqlStatement {
        sql: "INSERT INTO todo_task_assignees (task_id, person_id, position)\n            VALUES (?1, ?2, ?3)\n            ON CONFLICT (task_id, person_id)\n            DO UPDATE SET position = EXCLUDED.position".into(),
        params: vec![json!("task-1"), json!("person-1"), json!(0)],
      },
    ])
    .expect("batch");
    let linked = q(
      "SELECT person_id FROM todo_task_assignees WHERE task_id = ?1",
      vec![json!("task-1")],
    );
    assert_eq!(linked["rows"][0]["person_id"], json!("person-1"));

    // update_task, translated: rowCount reports the change.
    let updated = q(
      "UPDATE todo_tasks SET text = ?1, completed = ?2, completed_at = datetime('now'), updated_at = datetime('now')\n       WHERE id = ?3",
      vec![json!("done"), json!(1), json!("task-1")],
    );
    assert_eq!(updated["rowCount"], json!(1));

    // The sync's pull insert, translated: conflict target on the partial
    // unique index. Two inserts of one Basecamp id leave one row.
    let pull = "INSERT INTO todo_tasks\n         (id, list_id, text, notes_html, completed, completed_at, position, basecamp_id)\n       VALUES (?1, ?2, ?3, ?4, ?5, CASE WHEN ?5 THEN datetime('now') ELSE NULL END,\n               (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_tasks WHERE list_id = ?2),\n               ?6)\n       ON CONFLICT (list_id, basecamp_id) WHERE basecamp_id IS NOT NULL\n         DO NOTHING\n       RETURNING id";
    let first = q(pull, vec![json!("pull-1"), json!("list-1"), json!("from bc"), json!(null), json!(0), json!("bc-9")]);
    assert_eq!(first["rows"].as_array().unwrap().len(), 1);
    let second = q(pull, vec![json!("pull-2"), json!("list-1"), json!("from bc"), json!(null), json!(0), json!("bc-9")]);
    assert_eq!(second["rows"].as_array().unwrap().len(), 0);

    // create_subtask, translated: a child task, positioned among its
    // siblings, on the v8 schema.
    let sub = q(
      "INSERT INTO todo_tasks (id, list_id, parent_task_id, text, position)\n     VALUES (?1, ?2, ?3,\n       (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_tasks WHERE parent_task_id = ?3), ?4)\n     RETURNING *",
      vec![json!("sub-1"), json!("list-1"), json!("pull-1"), json!("a step")],
    );
    assert_eq!(sub["rows"][0]["parent_task_id"], json!("pull-1"));

    // The step sync's pull insert: same conflict target as the task pull —
    // steps and to-dos share one id space, so one index covers both.
    let step_pull = "INSERT INTO todo_tasks\n         (id, list_id, parent_task_id, text, completed, position, basecamp_id,\n          basecamp_base_text, basecamp_base_completed)\n       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?4, ?5)\n       ON CONFLICT (list_id, basecamp_id) WHERE basecamp_id IS NOT NULL\n         DO NOTHING";
    q(step_pull, vec![json!("sub-2"), json!("list-1"), json!("pull-1"), json!("remote step"), json!(0), json!(2.0), json!("step-7")]);
    q(step_pull, vec![json!("sub-3"), json!("list-1"), json!("pull-1"), json!("remote step"), json!(0), json!(2.0), json!("step-7")]);
    let steps = q(
      "SELECT count(*) AS n FROM todo_tasks WHERE parent_task_id = ?1",
      vec![json!("pull-1")],
    );
    assert_eq!(steps["rows"][0]["n"], json!(2));

    // Deleting the task takes its children with it.
    q("DELETE FROM todo_tasks WHERE id = ?1", vec![json!("pull-1")]);
    let orphans = q(
      "SELECT count(*) AS n FROM todo_tasks WHERE parent_task_id = ?1",
      vec![json!("pull-1")],
    );
    assert_eq!(orphans["rows"][0]["n"], json!(0));

    // delete_task, translated: RETURNING hands back the sync keys.
    let deleted = q(
      "DELETE FROM todo_tasks WHERE id = ?1 RETURNING list_id, basecamp_id",
      vec![json!("task-1")],
    );
    assert_eq!(deleted["rows"][0]["list_id"], json!("list-1"));

    let _ = std::fs::remove_file(&path);
  }
}

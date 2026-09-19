fn main() {
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(
      // The webview runs the shared TypeScript store; the board reaches
      // SQLite through the two-command bridge. Rust keeps the pieces that
      // must be native: the OAuth broker flow, EventKit, and the focus
      // window (an NSPanel on macOS).
      tauri_build::AppManifest::new().commands(&[
        "todo_sql_query",
        "todo_sql_batch",
        "todo_media_write",
        "todo_media_read",
        "open_focus_popout",
        "close_focus_popout",
        "set_focus_popout_height",
        "enter_fullscreen_focus",
        "exit_fullscreen_focus",
        "exit_fullscreen_focus_to_home",
        "start_basecamp_auth",
        "handle_oauth_callback",
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

mod commands;
mod db;
mod focus;
#[cfg(target_os = "macos")]
mod menu;
mod oauth;
mod opener;
mod reminders;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_deep_link::init());

  // The focus window is an NSPanel on macOS (see focus.rs).
  #[cfg(target_os = "macos")]
  let builder = builder.plugin(tauri_nspanel::init());

  builder
    // The Basecamp transport fetches through this plugin, because webview
    // fetch answers to CORS and Basecamp sends no CORS headers. Without the
    // registration, every Basecamp call fails at the bridge.
    .plugin(tauri_plugin_http::init())
    // A note picture the app keeps itself (see db.rs, todo_media), drawn by
    // the web view on a scheme of its own: `todo-media://localhost/<id>`
    // on macOS, `http://todo-media.localhost/<id>` on Windows.
    .register_uri_scheme_protocol("todo-media", |ctx, request| {
      let id = request.uri().path().trim_start_matches('/').to_string();
      let db = ctx.app_handle().state::<db::TodoDb>();
      match db.media_read(&id) {
        // The scheme is its own origin and the page another, so the web
        // view runs a cross-origin check on the picture; without an
        // answer it draws a broken frame. The picture is the reader's own.
        Ok(Some((bytes, content_type, _))) => tauri::http::Response::builder()
          .status(200)
          .header("Content-Type", content_type)
          .header("Cache-Control", "private, max-age=31536000, immutable")
          .header("Access-Control-Allow-Origin", "*")
          .body(bytes)
          .unwrap(),
        _ => tauri::http::Response::builder()
          .status(404)
          .header("Content-Type", "text/plain")
          .body(b"no picture".to_vec())
          .unwrap(),
      }
    })
    .setup(|app| {
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;
      let db = commands::init_db(app.handle())?;
      app.manage(db);

      // Settings… in the app menu, and the version and our addresses in Help.
      #[cfg(target_os = "macos")]
      if let Err(err) = menu::install(app) {
        log::warn!("menu: {err}");
      }

      // Deep link fallback from Amplify (reddtodo://oauth-callback?...)
      #[cfg(desktop)]
      {
        use tauri_plugin_deep_link::DeepLinkExt;
        let handle = app.handle().clone();
        app.deep_link().on_open_url(move |event| {
          for url in event.urls() {
            let s = url.to_string();
            if s.starts_with("reddtodo://") || s.starts_with("redddo://") {
              let h = handle.clone();
              let url_str = s.clone();
              tauri::async_runtime::spawn(async move {
                let _ = oauth::handle_oauth_callback(h, url_str).await;
              });
            }
          }
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::todo_sql_query,
      commands::todo_sql_batch,
      commands::todo_media_write,
      commands::todo_media_read,
      focus::open_focus_popout,
      focus::close_focus_popout,
      focus::set_focus_popout_height,
      focus::enter_fullscreen_focus,
      focus::exit_fullscreen_focus,
      focus::exit_fullscreen_focus_to_home,
      oauth::start_basecamp_auth,
      oauth::handle_oauth_callback,
      reminders::fetch_reminders_lists,
      reminders::fetch_reminders_tasks,
      reminders::update_reminders_status,
      reminders::update_reminders_title,
      reminders::update_reminders_notes,
      reminders::update_reminders_due,
      reminders::delete_reminders_task,
      reminders::create_reminders_task,
      reminders::open_reminders_privacy_settings,
    ])
    // The main window is the app: closing it quits, as on Windows. Left
    // to itself the window went and the focus panel, hidden, kept the app
    // running with nothing on screen and nothing for the Dock to show.
    //
    // Not on macOS while a focus window is on screen. The reader is using
    // that window, and a quit takes it away with its running timer. The
    // main window is then hidden, not closed: its page completes the task
    // that the focus window ticks. A click on the Dock icon brings it
    // back (below), and so do the tick and the home button of the focus
    // window (focus.rs, `close_focus_popout`).
    .on_window_event(|window, event| {
      if window.label() == "main" {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
          #[cfg(target_os = "macos")]
          if focus::any_focus_window_showing(window.app_handle()) {
            api.prevent_close();
            let _ = window.hide();
            return;
          }
          let _ = api;
          window.app_handle().exit(0);
        }
      }
    })
    .build(tauri::generate_context!())
    .expect("error while running Digital Habits: To-Do")
    .run(|_app, _event| {
      // A click on the Dock icon: the main window comes back when it was
      // closed with a focus window open.
      #[cfg(target_os = "macos")]
      if let tauri::RunEvent::Reopen { .. } = _event {
        focus::show_main_window(_app);
      }
    });
}

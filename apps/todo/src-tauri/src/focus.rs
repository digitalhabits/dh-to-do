//! The floating focus window, as redd-do built it: a second webview that
//! loads the app's own bundled `index.html?focus=1&…` and renders only the
//! focus bar. The page is local, so it paints at once. Everything the bar
//! needs to show at first paint (task id, title, duration, elapsed time)
//! travels in the URL. Time spent goes back into the shared SQLite store
//! from inside the panel.
//!
//! On macOS the window is a true NSPanel, so it floats above every app,
//! including full-screen windows. Other platforms get a regular
//! always-on-top window.
//!
//! The planner shell carries the same commands against its hosted page.
//! The two copies must keep the same command names and arguments, because
//! `lib/native-shell.ts` in the monorepo root calls both.

use tauri::Manager;

#[cfg(target_os = "macos")]
use tauri_nspanel::{
  CollectionBehavior, ManagerExt, PanelBuilder, PanelLevel, StyleMask, TrackingAreaOptions,
};

#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
  panel!(FocusModePanel {
    config: {
      can_become_key_window: true,
      can_become_main_window: false,
      needs_panel_to_become_key: true,
      accepts_first_responder: true,
      becomes_key_only_if_needed: true,
      works_when_modal: true,
      is_floating_panel: true
    }
    with: {
      tracking_area: {
        options: TrackingAreaOptions::new()
          .active_always()
          .mouse_entered_and_exited()
          .mouse_moved()
          .cursor_update(),
        auto_resize: true
      }
    }
  })

  panel_event!(FocusModePanelEventHandler {})
}

/// Non-activating panels need a hover nudge so the first click hits a button
/// instead of only activating the window (matches redd-do).
#[cfg(target_os = "macos")]
fn configure_focus_panel_hover_activation(app: &tauri::AppHandle, label: &str) {
  if let Ok(panel) = app.get_webview_panel(label) {
    let handler = FocusModePanelEventHandler::new();
    let app_handle = app.clone();
    let panel_label = label.to_string();
    handler.on_mouse_entered(move |_event| {
      if let Ok(panel) = app_handle.get_webview_panel(&panel_label) {
        // The full-screen button sits on the panel, so the pointer is over
        // it when the panel hides. A late "entered" must not bring it back.
        if !panel.is_visible() {
          return;
        }
        panel.make_key_window();
        panel.order_front_regardless();
      }
    });
    panel.set_event_handler(Some(handler.as_ref()));
  }
}

fn safe_label_part(task_id: &str) -> String {
  urlencoding::encode(task_id)
    .replace('%', "_")
    .replace('.', "_2E")
    .replace('~', "_7E")
}

fn focus_popout_label(task_id: &str) -> String {
  format!("focus-{}", safe_label_part(task_id))
}

fn fullscreen_focus_label(task_id: &str) -> String {
  format!("focusfs-{}", safe_label_part(task_id))
}

const FOCUS_POPOUT_WIDTH: f64 = 320.0;
/// Default height — matches redd-do (focus-bar is 48px; a little chrome room).
const FOCUS_POPOUT_HEIGHT: f64 = 56.0;
const FOCUS_POPOUT_MIN_HEIGHT: f64 = 48.0;
/// The widest the mini panel can ever be. With no limit, a drag or a
/// double-click (macOS zooms a window there) made it fill the screen: a
/// one-line bar on a screen of empty yellow. Once the page has measured
/// itself, `set_focus_popout_height` holds it to its content, inside this.
const FOCUS_POPOUT_MAX_WIDTH: f64 = 720.0;
/// The narrowest: room for the bar's buttons.
const FOCUS_POPOUT_MIN_WIDTH: f64 = 280.0;
/// How much taller than its content the panel can be drawn out.
const FOCUS_POPOUT_ROOM: f64 = 80.0;

#[derive(Clone, Copy)]
struct FocusWindowGeometry {
  x: f64,
  y: f64,
  width: f64,
  height: f64,
}

/// Where the mini focus panel sat before handing off to fullscreen, so the
/// return trip restores it exactly (redd-do's fullscreen_handoff_geometry).
fn fullscreen_handoff_geometry(
) -> &'static std::sync::Mutex<std::collections::HashMap<String, FocusWindowGeometry>> {
  static STORE: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, FocusWindowGeometry>>,
  > = std::sync::OnceLock::new();
  STORE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Two focus windows can be up at once: one for the task the reader works
/// on, and one for a task that something else works on in the meantime (an
/// AI agent, a long build). Each window has a slot, 1 or 2. The page reads
/// the slot from its address, and the second window wears a different
/// colour, so the two tell apart at a glance. The planner shell has the same
/// rule (see FOCUS_PANEL_LABELS there).
///
/// A third task takes the second window's place, so the first stays put.
/// The board closes the window that gives way before it asks for the new
/// one, by the window's own save-and-close. What this file does for that
/// window is the fallback, for a board that did not.
fn focus_slots() -> &'static std::sync::Mutex<std::collections::HashMap<String, usize>> {
  static STORE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, usize>>> =
    std::sync::OnceLock::new();
  STORE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// The gap between the first window and the second when the second is put
/// under it.
const FOCUS_POPOUT_STACK_GAP: f64 = 12.0;

/// A focus window that exists and is on screen. A hidden NSPanel reports
/// itself not visible, and a closed window (other platforms) is gone.
/// Windows 11: round the corners like the macOS panel (8px) and drop the 1px
/// system border, which sat next to the note's own. Windows 10 ignores both.
#[cfg(windows)]
fn round_without_border(window: &tauri::WebviewWindow) {
  use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
  };
  let Ok(hwnd) = window.hwnd() else { return };
  let round = DWMWCP_ROUND;
  let no_border: u32 = 0xFFFF_FFFE; // DWMWA_COLOR_NONE
  unsafe {
    let _ = DwmSetWindowAttribute(
      hwnd,
      DWMWA_WINDOW_CORNER_PREFERENCE,
      &round as *const _ as *const std::ffi::c_void,
      std::mem::size_of_val(&round) as u32,
    );
    let _ = DwmSetWindowAttribute(
      hwnd,
      DWMWA_BORDER_COLOR,
      &no_border as *const _ as *const std::ffi::c_void,
      std::mem::size_of_val(&no_border) as u32,
    );
  }
}

fn focus_window_is_showing(app: &tauri::AppHandle, label: &str) -> bool {
  app
    .get_webview_window(label)
    .map(|win| win.is_visible().unwrap_or(false))
    .unwrap_or(false)
}

/// Is a focus window on screen: a small one or a full-screen one. The close
/// button of the main window asks (lib.rs).
#[cfg(target_os = "macos")]
pub fn any_focus_window_showing(app: &tauri::AppHandle) -> bool {
  app.webview_windows().iter().any(|(label, win)| {
    (label.starts_with("focus-") || label.starts_with("focusfs-"))
      && win.is_visible().unwrap_or(false)
  })
}

/// Bring the main window to the front: shown again when it was closed with
/// a focus window open, and focused when it was behind other windows. A
/// tick or the home button ends the focus, so the app comes back to it
/// (changed 2026-10-04; until then a main window on screen was left behind).
pub fn show_main_window(app: &tauri::AppHandle) {
  if let Some(main_window) = app.get_webview_window("main") {
    let _ = main_window.show();
    let _ = main_window.set_focus();
  }
}

/// The slot for the window `label`, and the windows that must give way to
/// it. A window that is up keeps its slot. A new one gets slot 1 when that
/// is free, and slot 2 if not; the window that held slot 2 gives way.
fn take_focus_slot(app: &tauri::AppHandle, label: &str) -> (usize, Vec<String>) {
  let Ok(mut slots) = focus_slots().lock() else {
    return (1, Vec::new());
  };
  slots.retain(|held, _| focus_window_is_showing(app, held));
  if let Some(slot) = slots.get(label) {
    return (*slot, Vec::new());
  }
  if !slots.values().any(|slot| *slot == 1) {
    slots.insert(label.to_string(), 1);
    return (1, Vec::new());
  }
  let give_way: Vec<String> = slots
    .iter()
    .filter(|(_, slot)| **slot == 2)
    .map(|(held, _)| held.clone())
    .collect();
  for held in &give_way {
    slots.remove(held);
  }
  slots.insert(label.to_string(), 2);
  (2, give_way)
}

/// Where the second window goes when it is first shown: under the first.
fn position_under_first_focus_window(app: &tauri::AppHandle) -> Option<(f64, f64)> {
  let first = focus_slots()
    .lock()
    .ok()?
    .iter()
    .find(|(_, slot)| **slot == 1)
    .map(|(held, _)| held.clone())?;
  let first_win = app
    .get_webview_window(&first)
    .filter(|_| focus_window_is_showing(app, &first))?;
  let scale = first_win.scale_factor().ok()?;
  let pos = first_win.outer_position().ok()?.to_logical::<f64>(scale);
  let size = first_win.outer_size().ok()?.to_logical::<f64>(scale);
  Some((pos.x, pos.y + size.height + FOCUS_POPOUT_STACK_GAP))
}

/// The bundled focus page. `WebviewUrl::App` resolves against the dev server
/// in `tauri dev` and against `frontendDist` in a build, so the same path
/// works in both. `main.tsx` reads `focus=1` and mounts the focus bar.
fn focus_page_url(
  task_id: &str,
  title: &str,
  elapsed_ms: Option<f64>,
  duration_minutes: Option<f64>,
  fullscreen: bool,
  slot: usize,
) -> tauri::WebviewUrl {
  let mut url = format!(
    "index.html?focus=1&taskId={}&title={}&slot={slot}",
    urlencoding::encode(task_id),
    urlencoding::encode(title)
  );
  if fullscreen {
    url.push_str("&fullscreen=1");
  }
  if let Some(ms) = elapsed_ms {
    url.push_str(&format!("&elapsed={ms}"));
  }
  if let Some(minutes) = duration_minutes {
    url.push_str(&format!("&duration={minutes}"));
  }
  tauri::WebviewUrl::App(url.into())
}

/// Off the main thread, two clicks can reach the commands below at once. One
/// window is made at a time, so two opens cannot take the same slot or build
/// the same window twice.
#[cfg(not(target_os = "macos"))]
static FOCUS_BUILD: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Open (or re-target) the floating focus window for a task.
///
/// Must stay a sync Tauri command on macOS: it builds an NSPanel, and AppKit
/// requires that on the main thread. Elsewhere it runs on a worker thread:
/// on Windows, building a webview on the main thread inside a command call
/// deadlocks WebView2, and the whole app freezes.
///
/// `user_agent` is accepted so the call matches the planner shell. The
/// bundled page does not need it, so it is ignored.
#[cfg_attr(target_os = "macos", tauri::command)]
#[cfg_attr(not(target_os = "macos"), tauri::command(async))]
pub fn open_focus_popout(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
  task_id: String,
  title: String,
  user_agent: Option<String>,
  elapsed_ms: Option<f64>,
  duration_minutes: Option<f64>,
) -> Result<(), String> {
  let _ = user_agent;
  #[cfg(not(target_os = "macos"))]
  let _one_at_a_time = FOCUS_BUILD.lock().unwrap_or_else(|e| e.into_inner());
  let label = focus_popout_label(&task_id);
  // Read before the slot is taken: the second window goes under the first.
  let (slot, give_way) = take_focus_slot(&app, &label);
  let under_first = if slot == 2 {
    position_under_first_focus_window(&app)
  } else {
    None
  };
  let url = focus_page_url(&task_id, &title, elapsed_ms, duration_minutes, false, slot);

  #[cfg(target_os = "macos")]
  {
    // Two focus panels at most (see focus_slots).
    for stale in give_way {
      hide_focus_panel(&app, &stale);
      if let Some(win) = app.get_webview_window(&stale) {
        let _ = win.hide();
      }
    }

    let panel_behavior = CollectionBehavior::new()
      .can_join_all_spaces()
      .stationary()
      .full_screen_auxiliary()
      .ignores_cycle();

    if let Some(existing) = app.get_webview_window(&label) {
      if let Ok(panel) = app.get_webview_panel(&label) {
        panel.show_and_make_key();
        panel.set_floating_panel(true);
        panel.set_level(PanelLevel::Floating.value());
        panel.set_collection_behavior(panel_behavior.value());
        panel.order_front_regardless();
        configure_focus_panel_hover_activation(&app, &label);
      } else {
        let _ = existing.show();
        let _ = existing.set_focus();
      }
      let _ = existing.set_size(tauri::LogicalSize::new(
        FOCUS_POPOUT_WIDTH,
        FOCUS_POPOUT_HEIGHT,
      ));
      let _ = existing.set_min_size(Some(tauri::LogicalSize::new(
        280.0,
        FOCUS_POPOUT_MIN_HEIGHT,
      )));
      let _ = existing.set_max_size(Some(tauri::LogicalSize::new(
        FOCUS_POPOUT_MAX_WIDTH,
        FOCUS_POPOUT_MAX_HEIGHT,
      )));
      // Reload the local page so it remounts with a fresh timer session.
      let _ = existing.navigate(resolve_app_url(&existing, url)?);
      return Ok(());
    }

    let panel = PanelBuilder::<_, FocusModePanel>::new(&app, &label)
      .url(url)
      .level(PanelLevel::Floating)
      .floating(true)
      .hides_on_deactivate(false)
      .movable_by_window_background(true)
      .collection_behavior(panel_behavior)
      .style_mask(StyleMask::empty().resizable().nonactivating_panel())
      .corner_radius(8.0)
      .transparent(true)
      .with_window(move |w| {
        w.title(title)
          .decorations(false)
          .resizable(true)
          .inner_size(FOCUS_POPOUT_WIDTH, FOCUS_POPOUT_HEIGHT)
          .min_inner_size(280.0, FOCUS_POPOUT_MIN_HEIGHT)
          .max_inner_size(FOCUS_POPOUT_MAX_WIDTH, FOCUS_POPOUT_MAX_HEIGHT)
      })
      .build()
      .map_err(|e| e.to_string())?;

    configure_focus_panel_hover_activation(&app, &label);
    panel.show_and_make_key();
    panel.order_front_regardless();

    if let Some(win) = app.get_webview_window(&label) {
      let _ = win.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
      // Under the first panel, or top-right of the invoking window's monitor.
      if let Some((x, y)) = under_first {
        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
      } else if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let pos = monitor.position().to_logical::<f64>(scale);
        let _ = win.set_position(tauri::LogicalPosition::new(
          pos.x + size.width - FOCUS_POPOUT_WIDTH - 24.0,
          pos.y + 96.0,
        ));
      }
    }
    Ok(())
  }

  #[cfg(not(target_os = "macos"))]
  {
    use tauri::WebviewWindowBuilder;

    for stale in give_way {
      if let Some(win) = app.get_webview_window(&stale) {
        let _ = win.close();
      }
    }

    if let Some(existing) = app.get_webview_window(&label) {
      let _ = existing.navigate(resolve_app_url(&existing, url)?);
      let _ = existing.show();
      #[cfg(target_os = "linux")]
      let _ = existing.set_always_on_top(true);
      let _ = existing.set_focus();
      return Ok(());
    }

    let popout = WebviewWindowBuilder::new(&app, &label, url)
      .title(title.clone())
      // The sticky-note colour (todo.css), so nothing shows white or black
      // before the page paints.
      .background_color(if slot == 2 {
        tauri::window::Color(0xc6, 0xf0, 0x8c, 0xff)
      } else {
        tauri::window::Color(0xff, 0xf9, 0xc4, 0xff)
      })
      .inner_size(FOCUS_POPOUT_WIDTH, FOCUS_POPOUT_HEIGHT)
      .min_inner_size(280.0, FOCUS_POPOUT_MIN_HEIGHT)
          .max_inner_size(FOCUS_POPOUT_MAX_WIDTH, FOCUS_POPOUT_MAX_HEIGHT)
      .resizable(true)
      .decorations(false)
      .always_on_top(true)
      .visible_on_all_workspaces(true)
      .zoom_hotkeys_enabled(false)
      .build()
      .map_err(|e| e.to_string())?;
    if let Some((x, y)) = under_first {
      let _ = popout.set_position(tauri::LogicalPosition::new(x, y));
    }
    #[cfg(windows)]
    round_without_border(&popout);
    // Some Linux window managers drop "keep above" when it is asked before
    // the window is on screen. Ask again once it is.
    #[cfg(target_os = "linux")]
    let _ = popout.set_always_on_top(true);
    let _ = popout.set_focus();
    let _ = window;
    Ok(())
  }
}

/// `navigate` wants an absolute URL. Resolve the app-relative focus page
/// against the origin the window already shows (the dev server or the
/// bundled `tauri://localhost`), so dev and build both work.
fn resolve_app_url(
  window: &tauri::WebviewWindow,
  url: tauri::WebviewUrl,
) -> Result<tauri::Url, String> {
  let relative = match url {
    tauri::WebviewUrl::App(path) => path.to_string_lossy().into_owned(),
    tauri::WebviewUrl::External(absolute) => return Ok(absolute),
    other => return Err(format!("Unsupported focus URL: {other:?}")),
  };
  let current = window.url().map_err(|e| e.to_string())?;
  current
    .join(&format!("/{relative}"))
    .map_err(|e| format!("Bad focus URL: {e}"))
}

/// Hand the running focus session off to a distraction-free fullscreen
/// window (redd-do's enter_fullscreen_focus_handoff): remember the panel's
/// geometry, open `focusfs-*` fullscreen with the elapsed session time, and
/// hide the mini panel. Off the main thread except on macOS, like
/// open_focus_popout.
#[cfg_attr(target_os = "macos", tauri::command)]
#[cfg_attr(not(target_os = "macos"), tauri::command(async))]
pub fn enter_fullscreen_focus(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
  task_id: String,
  title: String,
  user_agent: Option<String>,
  elapsed_ms: f64,
  duration_minutes: Option<f64>,
) -> Result<(), String> {
  use tauri::WebviewWindowBuilder;

  let _ = user_agent;
  #[cfg(not(target_os = "macos"))]
  let _one_at_a_time = FOCUS_BUILD.lock().unwrap_or_else(|e| e.into_inner());
  let fullscreen_label = fullscreen_focus_label(&task_id);
  // The panel that asks is the panel to hide. Its label has the task it was
  // opened for, and the panel's own switcher can have moved it to another
  // task since, so the label is not made from the task here.
  let panel_label = if window.label().starts_with("focus-") {
    window.label().to_string()
  } else {
    focus_popout_label(&task_id)
  };
  log::info!("focus: fullscreen asked by {} for {fullscreen_label}", window.label());

  let scale = window.scale_factor().unwrap_or(1.0);
  if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
    let geometry = FocusWindowGeometry {
      x: (pos.x as f64) / scale,
      y: (pos.y as f64) / scale,
      width: (size.width as f64) / scale,
      height: (size.height as f64) / scale,
    };
    if let Ok(mut store) = fullscreen_handoff_geometry().lock() {
      store.insert(task_id.clone(), geometry);
    }
  }

  // The fullscreen window has no colour of its own, so the slot says nothing there.
  let url = focus_page_url(&task_id, &title, Some(elapsed_ms), duration_minutes, true, 1);

  if let Some(existing) = app.get_webview_window(&fullscreen_label) {
    let _ = existing.navigate(resolve_app_url(&existing, url)?);
    let _ = existing.set_fullscreen(true);
    let _ = existing.show();
    let _ = existing.set_focus();
  } else {
    let fullscreen_window = WebviewWindowBuilder::new(&app, &fullscreen_label, url)
      .title(title)
      .zoom_hotkeys_enabled(false)
      .always_on_top(true)
      .decorations(false)
      .resizable(true)
      .fullscreen(true)
      .build()
      .map_err(|e| {
        log::error!("focus: the fullscreen window was not made: {e}");
        e.to_string()
      })?;
    let _ = fullscreen_window.set_focus();
  }

  #[cfg(target_os = "macos")]
  hide_focus_panel(&app, &panel_label);
  if let Some(panel_window) = app.get_webview_window(&panel_label) {
    let _ = panel_window.hide();
  }
  Ok(())
}

/// Return from fullscreen focus to the mini panel, restored to where it sat
/// before the handoff (redd-do's exit_fullscreen_focus_handoff). Off the main
/// thread except on macOS: it can build the panel, and it takes the same
/// slot lock as open_focus_popout.
#[cfg_attr(target_os = "macos", tauri::command)]
#[cfg_attr(not(target_os = "macos"), tauri::command(async))]
pub fn exit_fullscreen_focus(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
  task_id: String,
  title: String,
  user_agent: Option<String>,
  elapsed_ms: f64,
  duration_minutes: Option<f64>,
) -> Result<(), String> {
  open_focus_popout(
    app.clone(),
    window.clone(),
    task_id.clone(),
    title,
    user_agent,
    Some(elapsed_ms),
    duration_minutes,
  )?;

  if let Ok(mut store) = fullscreen_handoff_geometry().lock() {
    if let Some(geometry) = store.remove(&task_id) {
      if let Some(restored) = app.get_webview_window(&focus_popout_label(&task_id)) {
        // A size kept from before the limits stays inside them.
        let _ = restored.set_size(tauri::LogicalSize::new(
          geometry.width.min(FOCUS_POPOUT_MAX_WIDTH),
          geometry.height.min(FOCUS_POPOUT_MAX_HEIGHT),
        ));
        let _ = restored.set_position(tauri::LogicalPosition::new(geometry.x, geometry.y));
      }
    }
  }

  if window.label().starts_with("focusfs-") {
    let _ = window.close();
  } else if let Some(fullscreen_window) = app.get_webview_window(&fullscreen_focus_label(&task_id))
  {
    let _ = fullscreen_window.close();
  }
  Ok(())
}

/// Leave fullscreen focus entirely: close the fullscreen window, drop the
/// panel, and bring the main app window back (redd-do's
/// exit_fullscreen_focus_to_home).
#[tauri::command]
pub fn exit_fullscreen_focus_to_home(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
  task_id: String,
) -> Result<(), String> {
  if let Ok(mut store) = fullscreen_handoff_geometry().lock() {
    store.remove(&task_id);
  }

  if window.label().starts_with("focusfs-") {
    let _ = window.close();
  } else if let Some(fullscreen_window) = app.get_webview_window(&fullscreen_focus_label(&task_id))
  {
    let _ = fullscreen_window.close();
  }

  let panel_label = focus_popout_label(&task_id);
  #[cfg(target_os = "macos")]
  hide_focus_panel(&app, &panel_label);
  if let Some(panel_window) = app.get_webview_window(&panel_label) {
    let _ = panel_window.hide();
  }

  if let Some(main_window) = app.get_webview_window("main") {
    let _ = main_window.show();
    let _ = main_window.set_focus();
  }
  Ok(())
}

/// Hide the focus panel from inside it. NSPanels are hidden rather than
/// closed (tauri-nspanel windows don't survive close cleanly); reopening
/// navigates the hidden window fresh.
#[tauri::command]
pub fn close_focus_popout(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
) -> Result<(), String> {
  if !window.label().starts_with("focus-") {
    return Err("Not a focus popout window".into());
  }
  #[cfg(target_os = "macos")]
  {
    hide_focus_panel(&app, window.label());
    let hidden = window.hide().map_err(|e| e.to_string());
    // The tick and the home button come through here: the focus is over,
    // and the main window comes to the front (shown again if it was closed).
    show_main_window(&app);
    hidden
  }
  #[cfg(not(target_os = "macos"))]
  {
    let closed = window.close().map_err(|e| e.to_string());
    show_main_window(&app);
    closed
  }
}

/// Hide the focus panel `label`, safely.
///
/// Hiding the key panel made AppKit's shared colour panel throw and quit
/// the app, so the key goes to another window first. If AppKit throws
/// there still, it is a warning, not a crash.
#[cfg(target_os = "macos")]
fn hide_focus_panel(app: &tauri::AppHandle, label: &str) {
  let Ok(panel) = app.get_webview_panel(label) else {
    return;
  };
  if panel.as_panel().isKeyWindow() {
    hand_key_on(app, label);
  }
  let hid = objc2::exception::catch(std::panic::AssertUnwindSafe(|| panel.hide()));
  if let Err(err) = hid {
    log::warn!("[focus] hiding the panel {label} threw: {err:?}");
  }
}

/// Give the key window to another visible focus panel, or to the main window.
#[cfg(target_os = "macos")]
fn hand_key_on(app: &tauri::AppHandle, closing: &str) {
  let other = app.webview_windows().into_iter().find_map(|(label, win)| {
    (label != closing && label.starts_with("focus-") && win.is_visible().unwrap_or(false))
      .then(|| app.get_webview_panel(&label).ok())
      .flatten()
  });
  if let Some(panel) = other {
    panel.make_key_window();
    return;
  }
  if let Some(main) = app.get_webview_window("main") {
    let _ = main.show();
    let _ = main.set_focus();
  }
}

/// The tallest the mini panel grows to, so an open task list on a short
/// screen cannot push the bar off it.
const FOCUS_POPOUT_MAX_HEIGHT: f64 = 640.0;

/// Fit the mini focus panel to its content. The panel opens at 56px, which
/// holds the bar alone, so the task list and the notes editor need the
/// window to grow before either one is visible. redd-do does the same over
/// `set-focus-window-height`.
///
/// The panel measures itself and calls this for its own window, with the
/// width its bar wants (`max_width`). That size is also the largest the
/// window may be: a window the user narrowed keeps its width, and one
/// dragged wider than its content goes back to it. The planner
/// shell carries the same command against its hosted page.
#[tauri::command]
pub fn set_focus_popout_height(
  window: tauri::WebviewWindow,
  height: f64,
  max_width: Option<f64>,
) -> Result<(), String> {
  if !window.label().starts_with("focus") {
    return Err("Not a focus popout window".into());
  }
  if !height.is_finite() {
    return Err("height is not a number".into());
  }
  let scale = window.scale_factor().map_err(|e| e.to_string())?;
  let size = window
    .inner_size()
    .map_err(|e| e.to_string())?
    .to_logical::<f64>(scale);
  let target = height.clamp(FOCUS_POPOUT_MIN_HEIGHT, FOCUS_POPOUT_MAX_HEIGHT);
  // The widest is what the bar holds on one line, plus air (the page
  // measures it). A page from before sends none: then the cap.
  let max_width = max_width
    .filter(|w| w.is_finite())
    .map(|w| w.clamp(FOCUS_POPOUT_MIN_WIDTH, FOCUS_POPOUT_MAX_WIDTH))
    .unwrap_or(FOCUS_POPOUT_MAX_WIDTH);
  // The height: never less than the content, so nothing is cut off, and
  // up to FOCUS_POPOUT_ROOM more, so the window can be drawn out a little
  // both ways. A height the reader chose inside that is kept; when the
  // content grows past it (the task list opens), the window grows.
  // The limits first, so the size set below is inside them.
  let tallest = (target + FOCUS_POPOUT_ROOM).min(FOCUS_POPOUT_MAX_HEIGHT.max(target));
  let _ = window.set_min_size(Some(tauri::LogicalSize::new(FOCUS_POPOUT_MIN_WIDTH, target)));
  let _ = window.set_max_size(Some(tauri::LogicalSize::new(max_width, tallest)));
  let width = size.width.clamp(FOCUS_POPOUT_MIN_WIDTH, max_width);
  let height = size.height.clamp(target, tallest);
  if (size.height - height).abs() < 1.0 && (size.width - width).abs() < 1.0 {
    return Ok(());
  }
  log::info!(
    "focus panel: fit {}x{}px -> {}x{}px",
    size.width.round(),
    size.height.round(),
    width.round(),
    height.round()
  );
  window
    .set_size(tauri::LogicalSize::new(width, height))
    .map_err(|e| e.to_string())
}

//! The menu bar, on macOS. The same two additions as Digital Habits Mail has
//! (apps/mail/src-tauri/src/menu.rs), to the menu Tauri makes by default.
//!
//! In the app menu, "Settings…" with Cmd+Comma. That is where a Mac user
//! looks for the settings of any app, and this one kept them behind the gear
//! in the title bar only. The item does not open anything itself: the page
//! owns the settings sheet, so the item tells the page and the page opens it.
//!
//! In the Help menu, the version and three ways to reach us, as To-Do 2 had
//! them. Somebody who reports a problem has to be able to say which version
//! they are on.
//!
//! Both are put into the submenus macOS already makes, rather than into menus
//! of our own. The default Help submenu is what gives the search field at the
//! top, and a Help menu built from scratch does not get one.
//!
//! The Help addresses are opened here, by the shell. The page's opener takes
//! http and https only, and "Contact us" is a mailto address.

#![cfg(target_os = "macos")]

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{App, Emitter, Manager, Wry};
use tauri_plugin_opener::OpenerExt;

/// The public repository of the app.
const ISSUES_URL: &str = "https://github.com/digitalhabits/dh-to-do/issues";
const CONTACT_URL: &str = "mailto:team@digitalhabits.org";
const STORY_URL: &str = "https://digitalhabits.org/story";

/// What the page listens for when Settings… is chosen. See
/// `listenOpenSettings` in lib/todo/native-bridge.ts.
pub const OPEN_SETTINGS_EVENT: &str = "open-settings";

/// The window with the board, and so with the settings. A focus window has
/// a label of its own and no settings sheet to open.
const MAIN_WINDOW: &str = "main";

pub fn install(app: &App) -> tauri::Result<()> {
  let menu = Menu::default(app.handle())?;
  let submenus: Vec<Submenu<Wry>> = menu
    .items()?
    .into_iter()
    .filter_map(|item| item.as_submenu().cloned())
    .collect();

  // The app menu is the first one. It is named after the app, so it is found
  // by position rather than by text.
  match submenus.first() {
    Some(app_menu) => {
      let settings = MenuItem::with_id(
        app,
        "app_settings",
        "Settings…",
        true,
        Some("CmdOrCtrl+,"),
      )?;
      // Where every Mac app puts it: after "About" and its separator, and
      // before Services. That is index 2 in the default menu, and a separator
      // after it keeps Services in a group of its own.
      app_menu.insert(&settings, 2)?;
      app_menu.insert(&PredefinedMenuItem::separator(app)?, 3)?;
    }
    None => log::warn!("menu: no app submenu to add Settings to"),
  }

  let help = submenus.iter().find(|submenu| {
    matches!(submenu.text(), Ok(text) if text == "Help")
  });

  match help {
    Some(help) => {
      // Tauri takes the number from the config, which reads ../package.json,
      // so it is the number the app bundle and the store carry.
      let version = MenuItem::with_id(
        app,
        "help_version",
        format!("Digital Habits: To-Do {}", app.package_info().version),
        // Nothing to click. It is here to be read and repeated.
        false,
        None::<&str>,
      )?;
      let report = MenuItem::with_id(
        app,
        "help_report_issue",
        "Report an issue",
        true,
        None::<&str>,
      )?;
      let contact =
        MenuItem::with_id(app, "help_contact_us", "Contact us", true, None::<&str>)?;
      let who_we_are =
        MenuItem::with_id(app, "help_who_we_are", "Who we are", true, None::<&str>)?;

      help.append(&PredefinedMenuItem::separator(app)?)?;
      help.append(&version)?;
      help.append(&report)?;
      help.append(&contact)?;
      help.append(&who_we_are)?;
    }
    // A macOS without a Help submenu is not a case we have seen. Say so
    // rather than leave a menu that quietly lost three items.
    None => log::warn!("menu: no Help submenu to add to"),
  }

  app.set_menu(menu)?;

  app.on_menu_event(|app, event| {
    let url = match event.id().as_ref() {
      "app_settings" => {
        // To the main window, and to the front: Settings… chosen while a
        // focus window has the focus, or with the main window closed, must
        // still show the settings somewhere.
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
          let _ = window.show();
          let _ = window.set_focus();
          if let Err(err) = app.emit_to(MAIN_WINDOW, OPEN_SETTINGS_EVENT, ()) {
            log::warn!("menu: could not ask the page to open settings: {err}");
          }
        }
        return;
      }
      "help_report_issue" => ISSUES_URL,
      "help_contact_us" => CONTACT_URL,
      "help_who_we_are" => STORY_URL,
      _ => return,
    };
    if let Err(err) = app.opener().open_url(url, None::<&str>) {
      log::warn!("menu: could not open {url}: {err}");
    }
  });

  Ok(())
}

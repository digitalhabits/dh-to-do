//! Updates for the Linux AppImage. Linux has no store, so the app updates
//! itself. It is kept simple: a short while after start, the app asks
//! GitHub for the latest published release. When that release is newer, it
//! downloads the signed AppImage and puts it over the old file. The reader
//! gets the new version at the next start. Nothing is shown.
//!
//! Only the AppImage updates itself. A .deb belongs to the package manager,
//! and the reader updates it with a new .deb.
//!
//! The address and the public key are in `tauri.linux.conf.json`. The
//! release build signs the AppImage with the private key
//! (TAURI_SIGNING_PRIVATE_KEY in the "release" environment), and the updater
//! refuses a file whose signature does not match.

#![cfg(target_os = "linux")]

use std::time::Duration;

use tauri_plugin_updater::UpdaterExt;

/// Give the board time to load before the network is used.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);

pub fn start(app: &tauri::AppHandle) {
  // The AppImage runtime sets APPIMAGE to the file it runs from.
  if std::env::var_os("APPIMAGE").is_none() {
    return;
  }
  if let Err(err) = app.plugin(tauri_plugin_updater::Builder::new().build()) {
    log::warn!("update: {err}");
    return;
  }
  let app = app.clone();
  tauri::async_runtime::spawn(async move {
    tokio::time::sleep(FIRST_CHECK_DELAY).await;
    if let Err(err) = check_and_install(&app).await {
      log::warn!("update: {err}");
    }
  });
}

async fn check_and_install(app: &tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
  let Some(update) = app.updater()?.check().await? else {
    return Ok(());
  };
  log::info!("update: {} found, installing", update.version);
  update.download_and_install(|_, _| {}, || {}).await?;
  log::info!("update: {} installed; it starts next time", update.version);
  Ok(())
}

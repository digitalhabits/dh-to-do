#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // Wayland lets no app keep a window on top, so the focus window sank
  // behind the others. Under XWayland the app is an X11 client, and GNOME,
  // KDE and the others honour "keep above" for X11 windows. It must be set
  // before GTK starts. A GDK_BACKEND the reader set is left alone.
  #[cfg(target_os = "linux")]
  if std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("GDK_BACKEND").is_none() {
    std::env::set_var("GDK_BACKEND", "x11");
  }

  app_lib::run();
}

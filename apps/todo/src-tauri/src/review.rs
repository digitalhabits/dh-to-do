//! The system's own rating sheet.
//!
//! On a Mac from the App Store, macOS can show a small sheet over the
//! window: five stars and Submit. The person rates without leaving the app.
//!
//! The app asks only when the person clicks "Leave a review" in the
//! app's banner, and once: the banner then never comes again
//! (store-review.tsx). macOS decides if the sheet shows. It does not when
//! the person turned in-app ratings off, and Apple's limit is three times
//! in a year. A click that shows nothing is no good, so the command says
//! if the sheet came, and the page opens the store when it did not.
//!
//! macOS tells the app nothing. But the sheet is a window of the system's
//! store helper (`storeuid`), and the list of windows on screen is open
//! to every app. A new window of that helper soon after the ask is the
//! sheet. Seen in November 2026 on macOS 26: it comes after about half a
//! second. Should a later macOS draw the sheet some other way, the
//! command says "no sheet" and the store page opens too: more than is
//! needed, never nothing.
//!
//! Seen in November 2026 on macOS 26: the sheet shows in an app bundle
//! signed with the Developer ID, and does not show in the bare program
//! that `tauri dev` runs. So to see it, make a bundle
//! (`VITE_TODO_STORE=mac VITE_TODO_PREVIEW_REVIEW=1 pnpm tauri build
//! --debug --bundles app`) and open that.

use tauri::{command, AppHandle};

/// Ask macOS to show its rating sheet. True when the sheet came on
/// screen. Other systems have no such sheet, and the answer is false.
#[command(async)]
pub fn request_store_review(app: AppHandle) -> Result<bool, String> {
  #[cfg(target_os = "macos")]
  {
    let before = mac::store_helper_windows();
    // AppKit: on the main thread only.
    app
      .run_on_main_thread(|| {
        log::info!("[review] asking macOS for the rating sheet");
        // Apple's newer call (AppStore.requestReview) is for Swift only.
        // This one is marked as old, and is what a Rust shell can reach.
        #[allow(deprecated)]
        unsafe {
          objc2_store_kit::SKStoreReviewController::requestReview();
        }
      })
      .map_err(|e| format!("Could not ask for the rating sheet: {e}"))?;

    // This is not the main thread (`command(async)`), so it can wait.
    for _ in 0..mac::LOOKS {
      std::thread::sleep(mac::LOOK_EVERY);
      if mac::store_helper_windows().difference(&before).next().is_some() {
        log::info!("[review] the rating sheet is on screen");
        return Ok(true);
      }
    }
    log::info!("[review] no rating sheet came");
    Ok(false)
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = app;
    Ok(false)
  }
}

#[cfg(target_os = "macos")]
mod mac {
  use std::collections::HashSet;
  use std::time::Duration;

  use core_foundation::base::{CFType, TCFType};
  use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
  use core_foundation::number::CFNumber;
  use core_foundation::string::CFString;
  use core_graphics::window::{
    copy_window_info, kCGNullWindowID, kCGWindowListOptionOnScreenOnly, kCGWindowNumber,
    kCGWindowOwnerName,
  };

  /// The system program that draws the rating sheet.
  const STORE_HELPER: &str = "storeuid";
  /// Look for 2.4 seconds in all. The sheet was seen after 0.5.
  pub const LOOKS: u32 = 12;
  pub const LOOK_EVERY: Duration = Duration::from_millis(200);

  /// The numbers of the store helper's windows that are on screen now.
  pub fn store_helper_windows() -> HashSet<i64> {
    let mut found = HashSet::new();
    let Some(windows) = copy_window_info(kCGWindowListOptionOnScreenOnly, kCGNullWindowID) else {
      return found;
    };
    let (owner_key, number_key) = unsafe {
      (
        CFString::wrap_under_get_rule(kCGWindowOwnerName),
        CFString::wrap_under_get_rule(kCGWindowNumber),
      )
    };
    for item in windows.iter() {
      let window: CFDictionary<CFString, CFType> =
        unsafe { CFDictionary::wrap_under_get_rule(*item as CFDictionaryRef) };
      let owner = window.find(&owner_key).and_then(|v| v.downcast::<CFString>());
      if owner.map(|name| name.to_string()).as_deref() != Some(STORE_HELPER) {
        continue;
      }
      let number = window.find(&number_key).and_then(|v| v.downcast::<CFNumber>());
      if let Some(n) = number.and_then(|n| n.to_i64()) {
        found.insert(n);
      }
    }
    found
  }
}

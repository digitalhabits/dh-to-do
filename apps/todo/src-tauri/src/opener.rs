/// Open a URL (https, mailto, etc.) in the user's default handler.
///
/// On macOS this goes through NSWorkspace instead of spawning `/usr/bin/open`:
/// in sandboxed Mac App Store builds the spawned child inherits the App
/// Sandbox and `/usr/bin/open` can fail, whereas NSWorkspace works in-process.
pub fn open_external(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSWorkspace;
        use objc2_foundation::{NSString, NSURL};

        let ns_url = NSURL::URLWithString(&NSString::from_str(url))
            .ok_or_else(|| format!("Invalid URL: {url}"))?;
        if NSWorkspace::sharedWorkspace().openURL(&ns_url) {
            Ok(())
        } else {
            Err(format!("NSWorkspace failed to open {url}"))
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = url;
        Err("open_external is only implemented on macOS in this shell".into())
    }
}

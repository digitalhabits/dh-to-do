//! What the Google sign-in (google.rs) and the Microsoft sign-in
//! (microsoft.rs) share: where a sign-in is kept, and the small parts of
//! the loopback flow of RFC 8252 that are the same for both.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;

/// Where the kept sign-ins are: the system's credential store (the
/// Keychain on macOS, the Credential Manager on Windows). `name` is the
/// entry, one for each service.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub mod vault {
  const SERVICE: &str = "Digital Habits To-Do";

  pub fn read(_app: &tauri::AppHandle, name: &str) -> Option<String> {
    keyring::Entry::new(SERVICE, name).ok()?.get_password().ok()
  }

  pub fn write(_app: &tauri::AppHandle, name: &str, value: &str) -> Result<(), String> {
    keyring::Entry::new(SERVICE, name)
      .and_then(|entry| entry.set_password(value))
      .map_err(|e| format!("The sign-in could not be kept: {e}"))
  }
}

/// Linux has no one credential store that every desktop has. The file is
/// in the app's own data folder and only its user can read it.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub mod vault {
  use tauri::Manager;

  fn path(app: &tauri::AppHandle, name: &str) -> Option<std::path::PathBuf> {
    Some(app.path().app_data_dir().ok()?.join(format!("{name}.json")))
  }

  pub fn read(app: &tauri::AppHandle, name: &str) -> Option<String> {
    std::fs::read_to_string(path(app, name)?).ok()
  }

  pub fn write(app: &tauri::AppHandle, name: &str, value: &str) -> Result<(), String> {
    let path = path(app, name).ok_or("The app has no data folder")?;
    if let Some(dir) = path.parent() {
      let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(&path, value).map_err(|e| format!("The sign-in could not be kept: {e}"))?;
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
  }
}

/// URL-safe random token, for the PKCE verifier and for the state.
pub fn random_token() -> Result<String, String> {
  let mut bytes = [0u8; 32];
  getrandom::fill(&mut bytes).map_err(|e| format!("Failed to generate random token: {e}"))?;
  Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// The code from the callback URL. A state that does not match is refused
/// (CSRF), and the service's own error is passed on when consent was
/// declined.
pub fn authorization_code(parsed: &url::Url, expected_state: &str) -> Result<String, String> {
  let param = |key: &str| {
    parsed
      .query_pairs()
      .find(|(k, _)| k == key)
      .map(|(_, v)| v.to_string())
  };
  if let Some(error) = param("error") {
    return Err(param("error_description").unwrap_or(error));
  }
  if param("state").as_deref() != Some(expected_state) {
    return Err("Callback state did not match the request; ignoring it".to_string());
  }
  param("code").ok_or_else(|| "No authorization code received".to_string())
}

/// What an id_token says about the account. No signature check is
/// necessary: it came straight from the token endpoint over TLS.
pub fn id_token_claims(id_token: &str) -> Option<serde_json::Value> {
  let encoded = id_token.split('.').nth(1)?;
  let decoded = URL_SAFE_NO_PAD.decode(encoded).ok()?;
  serde_json::from_slice(&decoded).ok()
}

/// The page the browser shows when the sign-in came back.
pub fn respond_html(request: tiny_http::Request, success: bool, message: &str) {
  let title = if success {
    "Authentication successful"
  } else {
    "Authentication failed"
  };
  // The message can hold words from the service's answer.
  let message = message
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;");
  let body = format!(
    "<html><body style=\"font-family: system-ui; text-align: center; padding: 48px 24px;\"><h1>{title}</h1><p>{message}</p><script>setTimeout(() => window.close(), 600);</script></body></html>"
  );
  let response = tiny_http::Response::from_string(body)
    .with_status_code(if success { 200 } else { 400 })
    .with_header(
      tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
        .unwrap(),
    );
  let _ = request.respond(response);
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_state_that_does_not_match_is_refused() {
    let url = url::Url::parse("http://127.0.0.1/?code=abc&state=other").unwrap();
    assert!(authorization_code(&url, "mine").is_err());
    let url = url::Url::parse("http://127.0.0.1/?code=abc&state=mine").unwrap();
    assert_eq!(authorization_code(&url, "mine").unwrap(), "abc");
  }

  #[test]
  fn a_declined_consent_gives_the_services_own_words() {
    let url =
      url::Url::parse("http://127.0.0.1/?error=access_denied&error_description=No+thanks").unwrap();
    assert_eq!(authorization_code(&url, "mine").unwrap_err(), "No thanks");
  }

  #[test]
  fn the_claims_of_an_id_token_are_read() {
    let body = URL_SAFE_NO_PAD.encode(br#"{"email":"ana@example.com"}"#);
    let claims = id_token_claims(&format!("head.{body}.sig")).unwrap();
    assert_eq!(claims["email"], "ana@example.com");
  }
}

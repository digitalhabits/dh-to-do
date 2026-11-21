//! The Microsoft sign-in, for Microsoft To Do.
//!
//! The same flow as the Google sign-in (google.rs): RFC 8252, the
//! authorization code comes back to a loopback listener and is exchanged
//! here with PKCE. There is no server hop.
//!
//! The tokens stay in this process. The refresh token goes to the system's
//! credential store, and the page gets only a short-lived access token
//! when it asks for one.
//!
//! What is not as Google:
//! - A desktop app is a public client at Microsoft: there is no client
//!   secret, only the client id. It is compile-time only (`option_env!`),
//!   from the `MICROSOFT_CLIENT_ID` secret on the build step or, for a
//!   local build, from `apps/todo/.env` (gitignored), which `build.rs`
//!   reads.
//! - Each use of a refresh token gives a new one. The new one is kept and
//!   the old one is dropped.
//! - Microsoft has no way for an app to end one permission. A disconnect
//!   forgets the sign-in here; the person removes the app's permission in
//!   their Microsoft account when they want that too.
//! - The redirect is `http://localhost:{port}`. Microsoft ignores the port
//!   of a localhost redirect, so the app registration holds
//!   `http://localhost` only (platform "Mobile and desktop applications").

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::net::TcpListener;
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{command, AppHandle, Emitter, Manager};

use crate::sign_in::{authorization_code, id_token_claims, random_token, respond_html, vault};

/// `common`: work, school and personal accounts.
const MICROSOFT_AUTH_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
/// Tasks.ReadWrite: the person's own task lists, and nothing else of
/// theirs. It needs no admin consent by default. offline_access gives the
/// refresh token; the other three say which account signed in.
const MICROSOFT_SCOPE: &str = "Tasks.ReadWrite offline_access openid email profile";
/// How long the sign-in page may stay open before the listener gives up.
const SIGN_IN_WAIT: Duration = Duration::from_secs(600);
/// The entry of the credential store that holds the Microsoft sign-ins.
const VAULT_ENTRY: &str = "microsoft-accounts";

fn client_id() -> &'static str {
  option_env!("MICROSOFT_CLIENT_ID").unwrap_or("")
}

fn configured() -> bool {
  !client_id().is_empty()
}

// --- The kept sign-ins ------------------------------------------------------

/// One account as it is kept. No access token: that one lives about an
/// hour and stays in memory.
#[derive(Serialize, Deserialize, Clone, Default)]
struct StoredAccount {
  refresh_token: String,
  scopes: Vec<String>,
}

type Accounts = BTreeMap<String, StoredAccount>;

fn load_accounts(app: &AppHandle) -> Accounts {
  vault::read(app, VAULT_ENTRY)
    .and_then(|text| serde_json::from_str(&text).ok())
    .unwrap_or_default()
}

fn save_accounts(app: &AppHandle, accounts: &Accounts) -> Result<(), String> {
  let text = serde_json::to_string(accounts).map_err(|e| e.to_string())?;
  vault::write(app, VAULT_ENTRY, &text)
}

/// Access tokens by account, with the moment each stops being good.
fn access_tokens() -> &'static Mutex<HashMap<String, (String, Instant)>> {
  static TOKENS: OnceLock<Mutex<HashMap<String, (String, Instant)>>> = OnceLock::new();
  TOKENS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember_access_token(email: &str, token: &str, expires_in: u64) {
  // A minute early, so a token is never sent in its last seconds.
  let good_for = Duration::from_secs(expires_in.saturating_sub(60));
  access_tokens()
    .lock()
    .insert(email.to_string(), (token.to_string(), Instant::now() + good_for));
}

/// One refresh at a time. Each refresh gives a new refresh token: two at
/// once would each keep its own, and one of the two would be lost.
fn refresh_gate() -> &'static tokio::sync::Mutex<()> {
  static GATE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
  GATE.get_or_init(|| tokio::sync::Mutex::new(()))
}

// --- Commands ---------------------------------------------------------------

/// Whether this build can sign in, and who is signed in. No token leaves.
#[command]
pub fn microsoft_status(app: AppHandle) -> serde_json::Value {
  let accounts: Vec<serde_json::Value> = load_accounts(&app)
    .iter()
    .map(|(email, account)| serde_json::json!({ "email": email, "scopes": account.scopes }))
    .collect();
  serde_json::json!({ "configured": configured(), "accounts": accounts })
}

/// An access token for one account. A new one when the kept one is old, or
/// when `fresh` says Microsoft refused it.
#[command]
pub async fn microsoft_access_token(
  app: AppHandle,
  email: String,
  fresh: bool,
) -> Result<String, String> {
  let cached = |email: &str| {
    access_tokens()
      .lock()
      .get(email)
      .filter(|(_, until)| Instant::now() < *until)
      .map(|(token, _)| token.clone())
  };
  if !fresh {
    if let Some(token) = cached(&email) {
      return Ok(token);
    }
  }
  let _one_at_a_time = refresh_gate().lock().await;
  // Another call got a new token while this one waited.
  if !fresh {
    if let Some(token) = cached(&email) {
      return Ok(token);
    }
  }
  let mut accounts = load_accounts(&app);
  let Some(account) = accounts.get(&email).cloned() else {
    return Err("This Microsoft account is not connected".to_string());
  };

  let response = reqwest::Client::new()
    .post(MICROSOFT_TOKEN_URL)
    .form(&[
      ("grant_type", "refresh_token"),
      ("refresh_token", account.refresh_token.as_str()),
      ("client_id", client_id()),
      ("scope", MICROSOFT_SCOPE),
    ])
    .send()
    .await
    .map_err(|e| format!("Token refresh failed: {e}"))?;

  if !response.status().is_success() {
    let body = response.text().await.unwrap_or_default();
    // The person took the permission away, changed their password, or
    // stayed away for 90 days. The kept sign-in is of no use: forget it,
    // so the app says "connect".
    if body.contains("invalid_grant") || body.contains("interaction_required") {
      accounts.remove(&email);
      let _ = save_accounts(&app, &accounts);
      access_tokens().lock().remove(&email);
      return Err("Microsoft ended the sign-in. Connect Microsoft again in Settings.".to_string());
    }
    return Err(format!("Microsoft refused the token request: {body}"));
  }

  let payload: serde_json::Value = response
    .json()
    .await
    .map_err(|e| format!("Failed to parse Microsoft token response: {e}"))?;
  let token = payload
    .get("access_token")
    .and_then(|v| v.as_str())
    .ok_or("Microsoft sent no access token")?
    .to_string();
  // The new refresh token takes the place of the old one.
  if let Some(next) = payload.get("refresh_token").and_then(|v| v.as_str()) {
    if !next.is_empty() && next != account.refresh_token {
      accounts.insert(
        email.clone(),
        StoredAccount {
          refresh_token: next.to_string(),
          scopes: account.scopes.clone(),
        },
      );
      if let Err(e) = save_accounts(&app, &accounts) {
        // The old one stays good until its own end: the sync goes on.
        log::warn!("[Microsoft OAuth] The new refresh token was not kept: {e}");
      }
    }
  }
  let expires_in = payload.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(3600);
  remember_access_token(&email, &token, expires_in);
  Ok(token)
}

/// Forget an account. Microsoft has no call that ends one permission, so
/// nothing is sent.
#[command]
pub fn microsoft_disconnect(app: AppHandle, email: String) -> Result<(), String> {
  let mut accounts = load_accounts(&app);
  if accounts.remove(&email).is_none() {
    return Ok(());
  }
  save_accounts(&app, &accounts)?;
  access_tokens().lock().remove(&email);
  Ok(())
}

/// Start the sign-in: open Microsoft's page in the browser and wait for
/// the answer on a loopback port. The result comes to the page as the
/// event `microsoft-auth-success` (email and scopes) or
/// `microsoft-auth-error`.
#[command]
pub async fn start_microsoft_auth(app: AppHandle) -> Result<(), String> {
  if !configured() {
    let message = "Microsoft sign-in is not set up in this build";
    emit_error(&app, message);
    return Err(message.to_string());
  }

  let verifier = random_token()?;
  let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
  let state = random_token()?;

  let listener = TcpListener::bind("127.0.0.1:0")
    .map_err(|e| format!("Failed to bind local callback server: {e}"))?;
  let port = listener
    .local_addr()
    .map_err(|e| format!("Failed to resolve local callback port: {e}"))?
    .port();
  let server = tiny_http::Server::from_listener(listener, None)
    .map_err(|e| format!("Failed to start local callback server: {e}"))?;

  let redirect_uri = format!("http://localhost:{port}");

  // prompt=select_account: the person picks the account, also when the
  // browser is signed in to one already.
  let auth_url = format!(
    "{MICROSOFT_AUTH_URL}?response_type=code&response_mode=query&prompt=select_account\
     &code_challenge_method=S256&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}",
    urlencoding::encode(client_id()),
    urlencoding::encode(&redirect_uri),
    urlencoding::encode(MICROSOFT_SCOPE),
    urlencoding::encode(&state),
    urlencoding::encode(&challenge)
  );

  log::info!("[Microsoft OAuth] Loopback listener on port {port}");

  let handle = app.clone();
  thread::spawn(move || receive_callback(handle, server, verifier, state, redirect_uri));

  // NSWorkspace on macOS: spawning /usr/bin/open fails inside the App
  // Sandbox (Mac App Store builds).
  if let Err(e) = crate::opener::open_external(&auth_url) {
    let message = format!("Failed to open browser: {e}");
    emit_error(&app, &message);
    return Err(message);
  }
  Ok(())
}

/// Wait for Microsoft to send the browser back, then exchange the code and
/// keep the sign-in.
fn receive_callback(
  app: AppHandle,
  server: tiny_http::Server,
  verifier: String,
  expected_state: String,
  redirect_uri: String,
) {
  let request = match server.recv_timeout(SIGN_IN_WAIT) {
    Ok(Some(request)) => request,
    // Nobody finished the sign-in. The port is free again.
    _ => return,
  };

  let code = match url::Url::parse(&format!("http://localhost{}", request.url()))
    .map_err(|e| format!("Failed to parse callback URL: {e}"))
    .and_then(|parsed| authorization_code(&parsed, &expected_state))
  {
    Ok(code) => code,
    Err(message) => {
      respond_html(request, false, &message);
      emit_error(&app, &message);
      return;
    }
  };

  let result = tokio::runtime::Runtime::new()
    .map_err(|e| format!("Failed to start token exchange: {e}"))
    .and_then(|runtime| runtime.block_on(exchange_code(&code, &verifier, &redirect_uri)))
    .and_then(|signed_in| keep_sign_in(&app, signed_in));

  match result {
    Ok(payload) => {
      respond_html(
        request,
        true,
        "Authentication successful. You can return to Digital Habits: To-Do.",
      );
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("microsoft-auth-success", payload);
        let _ = window.set_focus();
      }
    }
    Err(message) => {
      respond_html(request, false, &message);
      emit_error(&app, &message);
    }
  }
}

/// What a finished sign-in gave.
struct SignedIn {
  email: String,
  refresh_token: String,
  access_token: String,
  expires_in: u64,
  scopes: Vec<String>,
}

async fn exchange_code(code: &str, verifier: &str, redirect_uri: &str) -> Result<SignedIn, String> {
  let response = reqwest::Client::new()
    .post(MICROSOFT_TOKEN_URL)
    .form(&[
      ("grant_type", "authorization_code"),
      ("code", code),
      ("client_id", client_id()),
      ("code_verifier", verifier),
      ("redirect_uri", redirect_uri),
      ("scope", MICROSOFT_SCOPE),
    ])
    .send()
    .await
    .map_err(|e| format!("Token request failed: {e}"))?;

  if !response.status().is_success() {
    let body = response.text().await.unwrap_or_default();
    return Err(format!("Microsoft rejected the token request: {body}"));
  }
  let payload: serde_json::Value = response
    .json()
    .await
    .map_err(|e| format!("Failed to parse Microsoft token response: {e}"))?;
  let text = |key: &str| payload.get(key).and_then(|v| v.as_str()).map(str::to_string);

  Ok(SignedIn {
    email: text("id_token")
      .and_then(|token| id_token_claims(&token))
      .and_then(|claims| account_name(&claims))
      .ok_or("Microsoft did not say which account signed in")?,
    refresh_token: text("refresh_token").ok_or("Microsoft sent no refresh token")?,
    access_token: text("access_token").ok_or("Microsoft sent no access token")?,
    expires_in: payload.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(3600),
    scopes: text("scope")
      .unwrap_or_default()
      .split_whitespace()
      .map(str::to_string)
      .collect(),
  })
}

/// The name the account is shown and kept under: its address when it has
/// one, else its sign-in name (a work account can have no mailbox).
fn account_name(claims: &serde_json::Value) -> Option<String> {
  ["email", "preferred_username"]
    .iter()
    .filter_map(|key| claims.get(*key)?.as_str())
    .map(str::trim)
    .find(|value| !value.is_empty())
    .map(str::to_lowercase)
}

/// Keep the sign-in, and say who it is. The tokens stay here.
fn keep_sign_in(app: &AppHandle, signed_in: SignedIn) -> Result<serde_json::Value, String> {
  let mut accounts = load_accounts(app);
  accounts.insert(
    signed_in.email.clone(),
    StoredAccount {
      refresh_token: signed_in.refresh_token,
      scopes: signed_in.scopes.clone(),
    },
  );
  save_accounts(app, &accounts)?;
  remember_access_token(&signed_in.email, &signed_in.access_token, signed_in.expires_in);
  Ok(serde_json::json!({ "email": signed_in.email, "scopes": signed_in.scopes }))
}

fn emit_error(app: &AppHandle, message: &str) {
  log::error!("[Microsoft OAuth] {message}");
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.emit("microsoft-auth-error", message);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_account_is_named_by_its_address_or_else_its_sign_in_name() {
    let both = serde_json::json!({ "email": "Ana@Example.com", "preferred_username": "ana@corp.example" });
    assert_eq!(account_name(&both).unwrap(), "ana@example.com");
    let no_mail = serde_json::json!({ "email": "", "preferred_username": "ana@corp.example" });
    assert_eq!(account_name(&no_mail).unwrap(), "ana@corp.example");
    assert!(account_name(&serde_json::json!({})).is_none());
  }
}

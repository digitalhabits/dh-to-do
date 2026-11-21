//! The Google sign-in, for Google Tasks.
//!
//! Follows RFC 8252 (OAuth 2.0 for Native Apps): the authorization code
//! comes straight back to a loopback listener and is exchanged here with
//! PKCE. There is no server hop, and no token travels through a public URL.
//! The flow is Tiago Costa's, from the 2.x app.
//!
//! What is new in 3.x: the tokens stay in this process. The refresh token
//! goes to the system's credential store (the Keychain on macOS, the
//! Credential Manager on Windows), and the page gets only a short-lived
//! access token when it asks for one. So a refresh token cannot reach the
//! board's database or a backup file. In 2.x it was in both.
//!
//! More than one account can be signed in, and each keeps the scopes that
//! the person allowed. Tasks sync asks for one scope today; a later use
//! (calendars) adds its own, and Google lets a person allow one and not
//! the other.
//!
//! Google still wants the Desktop client's `client_secret` on the token
//! endpoint, also with PKCE. Google documents that value as not
//! confidential for installed apps. The id and the secret are compile-time
//! only (`option_env!`), never committed:
//! - GitHub Actions: the `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
//!   secrets on the build step.
//! - A local build: `apps/todo/.env` (gitignored), which `build.rs` reads.

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

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
/// Exactly the scopes Google approved for this app. A new scope needs a
/// new review by Google before it may be asked for in a store build.
const GOOGLE_SCOPE: &str =
  "https://www.googleapis.com/auth/tasks openid https://www.googleapis.com/auth/userinfo.email";
/// How long the sign-in page may stay open before the listener gives up.
const SIGN_IN_WAIT: Duration = Duration::from_secs(600);
/// The entry of the credential store that holds the Google sign-ins.
const VAULT_ENTRY: &str = "google-accounts";

fn client_id() -> &'static str {
  option_env!("GOOGLE_CLIENT_ID").unwrap_or("")
}

fn client_secret() -> &'static str {
  option_env!("GOOGLE_CLIENT_SECRET").unwrap_or("")
}

fn configured() -> bool {
  !client_id().is_empty() && !client_secret().is_empty()
}

// --- The kept sign-ins ------------------------------------------------------

/// One account as it is kept. No access token: that one lives an hour and
/// stays in memory.
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

// --- Commands ---------------------------------------------------------------

/// Whether this build can sign in, and who is signed in. No token leaves.
#[command]
pub fn google_status(app: AppHandle) -> serde_json::Value {
  let accounts: Vec<serde_json::Value> = load_accounts(&app)
    .iter()
    .map(|(email, account)| serde_json::json!({ "email": email, "scopes": account.scopes }))
    .collect();
  serde_json::json!({ "configured": configured(), "accounts": accounts })
}

/// An access token for one account. A new one when the kept one is old, or
/// when `fresh` says Google refused it.
#[command]
pub async fn google_access_token(
  app: AppHandle,
  email: String,
  fresh: bool,
) -> Result<String, String> {
  if !fresh {
    if let Some((token, until)) = access_tokens().lock().get(&email).cloned() {
      if Instant::now() < until {
        return Ok(token);
      }
    }
  }
  let mut accounts = load_accounts(&app);
  let Some(account) = accounts.get(&email).cloned() else {
    return Err("This Google account is not connected".to_string());
  };

  let response = reqwest::Client::new()
    .post(GOOGLE_TOKEN_URL)
    .form(&[
      ("grant_type", "refresh_token"),
      ("refresh_token", account.refresh_token.as_str()),
      ("client_id", client_id()),
      ("client_secret", client_secret()),
    ])
    .send()
    .await
    .map_err(|e| format!("Token refresh failed: {e}"))?;

  if !response.status().is_success() {
    let body = response.text().await.unwrap_or_default();
    // The person took the permission away at Google, or it ran out. The
    // kept sign-in is of no use: forget it, so the app says "connect".
    if body.contains("invalid_grant") {
      accounts.remove(&email);
      let _ = save_accounts(&app, &accounts);
      access_tokens().lock().remove(&email);
      return Err("Google ended the sign-in. Connect Google again in Settings.".to_string());
    }
    return Err(format!("Google refused the token request: {body}"));
  }

  let payload: serde_json::Value = response
    .json()
    .await
    .map_err(|e| format!("Failed to parse Google token response: {e}"))?;
  let token = payload
    .get("access_token")
    .and_then(|v| v.as_str())
    .ok_or("Google sent no access token")?
    .to_string();
  let expires_in = payload.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(3600);
  remember_access_token(&email, &token, expires_in);
  Ok(token)
}

/// Forget an account, and tell Google to end the permission. Without the
/// second part the app would stay in the person's Google account as allowed.
#[command]
pub async fn google_disconnect(app: AppHandle, email: String) -> Result<(), String> {
  let mut accounts = load_accounts(&app);
  let Some(account) = accounts.remove(&email) else {
    return Ok(());
  };
  save_accounts(&app, &accounts)?;
  access_tokens().lock().remove(&email);
  // Best effort: offline, the sign-in is still forgotten here.
  let _ = reqwest::Client::new()
    .post(GOOGLE_REVOKE_URL)
    .form(&[("token", account.refresh_token.as_str())])
    .send()
    .await;
  Ok(())
}

/// Start the sign-in: open Google's page in the browser and wait for the
/// answer on a loopback port. The result comes to the page as the event
/// `google-auth-success` (email and scopes) or `google-auth-error`.
#[command]
pub async fn start_google_auth(app: AppHandle) -> Result<(), String> {
  if !configured() {
    let message = "Google sign-in is not set up in this build";
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

  // Google accepts any port on a loopback redirect, so nothing is
  // registered in the Cloud Console.
  let redirect_uri = format!("http://127.0.0.1:{port}");

  // access_type=offline + prompt=consent, so Google always sends a refresh
  // token. Without prompt=consent it sends one on the first consent only.
  // select_account: the person picks the account, so a second one can be
  // added when the browser is signed in to the first.
  let auth_url = format!(
    "{GOOGLE_AUTH_URL}?response_type=code&access_type=offline&prompt=consent%20select_account\
     &code_challenge_method=S256&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}",
    urlencoding::encode(client_id()),
    urlencoding::encode(&redirect_uri),
    urlencoding::encode(GOOGLE_SCOPE),
    urlencoding::encode(&state),
    urlencoding::encode(&challenge)
  );

  log::info!("[Google OAuth] Loopback listener on port {port}");

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

/// Wait for Google to send the browser back, then exchange the code and
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

  let code = match url::Url::parse(&format!("http://127.0.0.1{}", request.url()))
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
        let _ = window.emit("google-auth-success", payload);
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
    .post(GOOGLE_TOKEN_URL)
    .form(&[
      ("grant_type", "authorization_code"),
      ("code", code),
      ("client_id", client_id()),
      ("client_secret", client_secret()),
      ("code_verifier", verifier),
      ("redirect_uri", redirect_uri),
    ])
    .send()
    .await
    .map_err(|e| format!("Token request failed: {e}"))?;

  if !response.status().is_success() {
    let body = response.text().await.unwrap_or_default();
    return Err(format!("Google rejected the token request: {body}"));
  }
  let payload: serde_json::Value = response
    .json()
    .await
    .map_err(|e| format!("Failed to parse Google token response: {e}"))?;
  let text = |key: &str| payload.get(key).and_then(|v| v.as_str()).map(str::to_string);

  Ok(SignedIn {
    email: text("id_token")
      .and_then(|token| email_from_id_token(&token))
      .ok_or("Google did not say which account signed in")?,
    refresh_token: text("refresh_token").ok_or("Google sent no refresh token")?,
    access_token: text("access_token").ok_or("Google sent no access token")?,
    expires_in: payload.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(3600),
    // What the person allowed. They can untick a permission on Google's page.
    scopes: text("scope")
      .unwrap_or_default()
      .split_whitespace()
      .map(str::to_string)
      .collect(),
  })
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

/// The account's address, from the id_token.
fn email_from_id_token(id_token: &str) -> Option<String> {
  id_token_claims(id_token)?.get("email")?.as_str().map(str::to_string)
}

fn emit_error(app: &AppHandle, message: &str) {
  log::error!("[Google OAuth] {message}");
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.emit("google-auth-error", message);
  }
}

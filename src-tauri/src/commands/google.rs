//! Google Tasks OAuth.
//!
//! Follows RFC 8252 (OAuth 2.0 for Native Apps): the authorization code comes
//! straight back to a loopback listener and is exchanged here using PKCE.
//! No server hop, and no token ever travels through a public URL — unlike the
//! Basecamp flow in `oauth.rs`.
//!
//! Google still requires the Desktop client's `client_secret` on the token
//! endpoint even with PKCE. Google documents that value as non-confidential for
//! installed apps (it is baked into the binary the same way as `client_id`).
//!
//! Credentials are compile-time only (`option_env!`), never committed:
//! - GitHub Actions: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` secrets on the
//!   build step
//! - Local release / `npm run dev`: project-root `.env` (gitignored), loaded by
//!   `build.rs` into rustc

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use sha2::{Digest, Sha256};
use std::net::TcpListener;
use std::thread;
use tauri::{command, AppHandle, Emitter, Manager};

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE: &str =
    "https://www.googleapis.com/auth/tasks openid https://www.googleapis.com/auth/userinfo.email";

/// Set at compile time via CI secrets or `build.rs` reading `.env`.
fn get_google_client_id() -> String {
    option_env!("GOOGLE_CLIENT_ID").unwrap_or("").to_string()
}

/// Set at compile time via CI secrets or `build.rs` reading `.env`.
fn get_google_client_secret() -> String {
    option_env!("GOOGLE_CLIENT_SECRET").unwrap_or("").to_string()
}

/// URL-safe random token, used for both the PKCE verifier and the state nonce.
fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("Failed to generate random token: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// Start the Google Tasks OAuth flow.
#[command]
pub async fn start_google_auth(app: AppHandle) -> Result<(), String> {
    let client_id = get_google_client_id();
    if client_id.is_empty() {
        let error_msg = "Google client ID is not configured in this build";
        emit_google_error(&app, error_msg);
        return Err(error_msg.to_string());
    }

    let client_secret = get_google_client_secret();
    if client_secret.is_empty() {
        let error_msg = "Google client secret is not configured in this build";
        emit_google_error(&app, error_msg);
        return Err(error_msg.to_string());
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

    // Google accepts any port on a loopback redirect, so there is nothing to
    // register in the Cloud Console and nothing to keep in sync.
    let redirect_uri = format!("http://127.0.0.1:{port}");

    // access_type=offline + prompt=consent so Google always returns a refresh
    // token; without prompt=consent it only sends one on the very first consent.
    let auth_url = format!(
        "{GOOGLE_AUTH_URL}?response_type=code&access_type=offline&prompt=consent\
         &code_challenge_method=S256&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}",
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(GOOGLE_SCOPE),
        urlencoding::encode(&state),
        urlencoding::encode(&challenge)
    );

    log::info!("[Google OAuth] Loopback listener on port {port}");

    let handle = app.clone();
    thread::spawn(move || {
        receive_google_callback(
            handle,
            server,
            client_id,
            client_secret,
            verifier,
            state,
            redirect_uri,
        );
    });

    // Uses NSWorkspace on macOS: spawning /usr/bin/open fails inside the App
    // Sandbox (Mac App Store builds).
    if let Err(e) = crate::opener::open_external(&auth_url) {
        let error_msg = format!("Failed to open browser: {e}");
        emit_google_error(&app, &error_msg);
        return Err(error_msg);
    }

    Ok(())
}

/// Wait for Google to redirect the browser back, then exchange the code.
fn receive_google_callback(
    app: AppHandle,
    server: tiny_http::Server,
    client_id: String,
    client_secret: String,
    verifier: String,
    expected_state: String,
    redirect_uri: String,
) {
    let Ok(request) = server.recv() else { return };

    let code = match url::Url::parse(&format!("http://127.0.0.1{}", request.url()))
        .map_err(|e| format!("Failed to parse callback URL: {e}"))
        .and_then(|parsed| authorization_code(&parsed, &expected_state))
    {
        Ok(code) => code,
        Err(error_msg) => {
            respond_html(request, false, &error_msg);
            emit_google_error(&app, &error_msg);
            return;
        }
    };

    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(e) => {
            let error_msg = format!("Failed to start token exchange: {e}");
            respond_html(request, false, &error_msg);
            emit_google_error(&app, &error_msg);
            return;
        }
    };

    match runtime.block_on(exchange_google_code(
        &code,
        &client_id,
        &client_secret,
        &verifier,
        &redirect_uri,
    )) {
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
        Err(error_msg) => {
            respond_html(request, false, &error_msg);
            emit_google_error(&app, &error_msg);
        }
    }
}

/// Pull the authorization code out of the callback URL, rejecting a mismatched
/// state (CSRF) and surfacing the error Google sends when consent is declined.
fn authorization_code(parsed: &url::Url, expected_state: &str) -> Result<String, String> {
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

async fn exchange_google_code(
    code: &str,
    client_id: &str,
    client_secret: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<serde_json::Value, String> {
    let response = reqwest::Client::new()
        .post(GOOGLE_TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code_verifier", verifier),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .map_err(|e| format!("Token request failed: {e}"))?;

    google_token_payload(response).await
}

/// Refresh an expired Google access token.
#[command]
pub async fn refresh_google_token(refresh_token: String) -> Result<serde_json::Value, String> {
    let client_id = get_google_client_id();
    if client_id.is_empty() {
        return Err("Google client ID is not configured in this build".to_string());
    }

    let client_secret = get_google_client_secret();
    if client_secret.is_empty() {
        return Err("Google client secret is not configured in this build".to_string());
    }

    let response = reqwest::Client::new()
        .post(GOOGLE_TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {e}"))?;

    google_token_payload(response).await
}

/// Normalise a Google token response: surface the account email and drop the
/// id_token, which the frontend has no use for and would otherwise be persisted.
async fn google_token_payload(response: reqwest::Response) -> Result<serde_json::Value, String> {
    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Google rejected the token request: {body}"));
    }

    let mut payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Google token response: {e}"))?;

    if let Some(obj) = payload.as_object_mut() {
        let email = obj
            .remove("id_token")
            .and_then(|token| token.as_str().and_then(email_from_id_token));
        if let Some(email) = email {
            obj.insert("email".to_string(), serde_json::json!(email));
        }
    }

    Ok(payload)
}

/// Read the account email from the id_token payload. No signature check needed:
/// it came straight from Google's token endpoint over TLS.
fn email_from_id_token(id_token: &str) -> Option<String> {
    let encoded = id_token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    claims.get("email")?.as_str().map(str::to_string)
}

fn respond_html(request: tiny_http::Request, success: bool, message: &str) {
    let title = if success {
        "Authentication successful"
    } else {
        "Authentication failed"
    };
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

fn emit_google_error(app: &AppHandle, error_msg: &str) {
    log::error!("[Google OAuth] {error_msg}");
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("google-auth-error", error_msg);
    }
}

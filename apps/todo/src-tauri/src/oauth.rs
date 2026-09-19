use std::net::TcpListener;
use std::thread;
use tauri::{command, AppHandle, Emitter, Manager};

const BC_REDIRECT_URI_DEV: &str = "http://localhost:3000/callback";
const BC_REDIRECT_URI_PROD: &str = "https://todo.digitalhabits.org/api/auth";
const LOCAL_CALLBACK_STATE_PREFIX: &str = "localhost:";

// Dev client ID uses localhost redirect (must match redd-do hosting/src/basecamp.js DEV_CLIENT_ID)
const BC_CLIENT_ID_DEV: &str = "aed7f4889aa6bb83b74e8e494e70701d59d1c9c5";
// Prod client ID for Amplify redirect (public; must match hosting PROD_CLIENT_ID).
const BC_CLIENT_ID_PROD: &str = "d83392d7842f055157c3fef1f5464b2e15a013dc";

/// OAuth client_id (public). Dev uses localhost app; release uses Amplify prod client.
fn get_client_id(is_dev: bool) -> String {
    if is_dev {
        BC_CLIENT_ID_DEV.to_string()
    } else {
        BC_CLIENT_ID_PROD.to_string()
    }
}

/// Start Basecamp OAuth flow
#[command]
pub async fn start_basecamp_auth(app: AppHandle) -> Result<(), String> {
    let is_dev = cfg!(debug_assertions);
    let client_id = get_client_id(is_dev);

    if client_id.is_empty() {
        let error_msg = "BASECAMP_CLIENT_ID not configured";
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("basecamp-auth-error", error_msg);
        }
        return Err(error_msg.to_string());
    }

    let redirect_uri = if is_dev {
        BC_REDIRECT_URI_DEV
    } else {
        BC_REDIRECT_URI_PROD
    };

    let mut auth_url = format!(
        "https://launchpad.37signals.com/authorization/new?type=web_server&client_id={}&redirect_uri={}",
        client_id,
        urlencoding::encode(redirect_uri)
    );

    log::info!("[Basecamp OAuth] Opening auth URL: {}", auth_url);
    log::info!(
        "[Basecamp OAuth] isDev: {}, redirect_uri: {}",
        is_dev,
        redirect_uri
    );

    if is_dev {
        // Dev mode: start local HTTP server to receive callback
        let app_handle = app.clone();
        let client_id_clone = client_id.clone();

        thread::spawn(move || {
            start_local_callback_server(app_handle, client_id_clone);
        });

        // Small delay to ensure server is ready
        std::thread::sleep(std::time::Duration::from_millis(100));
    } else {
        // Prefer the localhost bridge; if it can't start (e.g. sandbox restrictions),
        // omit the state param so the Amplify callback falls back to the deep link.
        match start_local_token_bridge_server(app.clone()) {
            Ok(bridge_port) => {
                let state = format!("{LOCAL_CALLBACK_STATE_PREFIX}{bridge_port}");
                auth_url.push_str("&state=");
                auth_url.push_str(&urlencoding::encode(&state));

                log::info!(
                    "[Basecamp OAuth] Added localhost bridge on port {} with state {}",
                    bridge_port,
                    state
                );

                // Give the bridge thread a moment to start listening before the browser redirects back.
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => {
                log::warn!(
                    "[Basecamp OAuth] Localhost bridge unavailable ({}), falling back to deep link callback",
                    e
                );
            }
        }
    }

    // Open browser for OAuth. Uses NSWorkspace on macOS: spawning /usr/bin/open
    // fails inside the App Sandbox (Mac App Store builds).
    if let Err(e) = crate::opener::open_external(&auth_url) {
        let error_msg = format!("Failed to open browser: {}", e);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("basecamp-auth-error", &error_msg);
        }
        return Err(error_msg);
    }

    Ok(())
}

/// Start local HTTP server to receive OAuth callback (dev mode only)
fn start_local_callback_server(app: AppHandle, client_id: String) {
    log::info!("[Basecamp OAuth] Starting local callback server on port 3000");

    let server = match tiny_http::Server::http("127.0.0.1:3000") {
        Ok(s) => s,
        Err(e) => {
            log::error!("[Basecamp OAuth] Failed to start server: {}", e);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit(
                    "basecamp-auth-error",
                    format!("Failed to start callback server: {}", e),
                );
            }
            return;
        }
    };

    log::info!("[Basecamp OAuth] Local server listening on port 3000");

    // Wait for one request (the callback)
    if let Some(request) = server.recv().ok() {
        let url = request.url().to_string();
        log::info!("[Basecamp OAuth] Received request: {}", url);

        if url.starts_with("/callback") {
            // Parse the URL to get the code
            let full_url = format!("http://localhost:3000{}", url);
            if let Ok(parsed) = url::Url::parse(&full_url) {
                let code = parsed
                    .query_pairs()
                    .find(|(k, _)| k == "code")
                    .map(|(_, v)| v.to_string());

                if let Some(code) = code {
                    log::info!("[Basecamp OAuth] Received code, exchanging for token...");

                    // Exchange code for token via Amplify hosting function
                    let rt = tokio::runtime::Runtime::new().unwrap();
                    match rt.block_on(exchange_code_for_token(&code, &client_id)) {
                        Ok(token_data) => {
                            log::info!("[Basecamp OAuth] Token exchange successful");

                            // Send success response to browser
                            let response = tiny_http::Response::from_string(
                                "<html><body style=\"font-family: system-ui; text-align: center; padding-top: 50px;\">
                                <h1>Authentication successful!</h1>
                                <p>You can close this window and return to Digital Habits: To-Do.</p>
                                <script>window.close()</script>
                                </body></html>"
                            ).with_header(
                                tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap()
                            );
                            let _ = request.respond(response);

                            // Emit success to frontend
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("basecamp-auth-success", token_data);
                                let _ = window.set_focus();
                            }
                        }
                        Err(e) => {
                            log::error!("[Basecamp OAuth] Token exchange failed: {}", e);

                            let response = tiny_http::Response::from_string(format!(
                                "Authentication failed: {}",
                                e
                            ))
                            .with_status_code(500);
                            let _ = request.respond(response);

                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("basecamp-auth-error", e);
                            }
                        }
                    }
                } else {
                    log::error!("[Basecamp OAuth] No code in callback URL");
                    let response =
                        tiny_http::Response::from_string("No authorization code received")
                            .with_status_code(400);
                    let _ = request.respond(response);
                }
            }
        } else {
            let response = tiny_http::Response::from_string("Not found").with_status_code(404);
            let _ = request.respond(response);
        }
    }

    log::info!("[Basecamp OAuth] Local server shutting down");
}

fn start_local_token_bridge_server(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind localhost callback server: {}", e))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to resolve localhost callback port: {}", e))?
        .port();

    let server = tiny_http::Server::from_listener(listener, None)
        .map_err(|e| format!("Failed to start localhost callback server: {}", e))?;

    log::info!(
        "[Basecamp OAuth] Localhost bridge listening on {}",
        server
            .server_addr()
            .to_ip()
            .map(|addr| addr.to_string())
            .unwrap_or_else(|| format!("127.0.0.1:{port}"))
    );

    thread::spawn(move || {
        if let Some(request) = server.recv().ok() {
            let url = request.url().to_string();
            log::info!(
                "[Basecamp OAuth] Localhost bridge received request: {}",
                url
            );

            if !url.starts_with("/callback") {
                let response = tiny_http::Response::from_string("Not found").with_status_code(404);
                let _ = request.respond(response);
                return;
            }

            let full_url = format!("http://127.0.0.1:{}{}", port, url);
            let parsed = match url::Url::parse(&full_url) {
                Ok(parsed) => parsed,
                Err(e) => {
                    let error_msg = format!("Failed to parse localhost callback URL: {}", e);
                    log::error!("[Basecamp OAuth] {}", error_msg);
                    let response =
                        tiny_http::Response::from_string(error_msg.clone()).with_status_code(400);
                    let _ = request.respond(response);
                    emit_auth_error(&app, &error_msg);
                    return;
                }
            };

            if let Some(error) = parsed
                .query_pairs()
                .find(|(k, _)| k == "error")
                .map(|(_, v)| v.to_string())
            {
                let error_desc = parsed
                    .query_pairs()
                    .find(|(k, _)| k == "error_description")
                    .map(|(_, v)| v.to_string())
                    .unwrap_or(error);

                let response =
                    tiny_http::Response::from_string(build_callback_html(false, &error_desc))
                        .with_status_code(400)
                        .with_header(
                            tiny_http::Header::from_bytes(
                                &b"Content-Type"[..],
                                &b"text/html; charset=utf-8"[..],
                            )
                            .unwrap(),
                        );
                let _ = request.respond(response);
                emit_auth_error(&app, &error_desc);
                return;
            }

            let access_token = parsed
                .query_pairs()
                .find(|(k, _)| k == "access_token")
                .map(|(_, v)| v.to_string());
            let refresh_token = parsed
                .query_pairs()
                .find(|(k, _)| k == "refresh_token")
                .map(|(_, v)| v.to_string());
            let expires_in = parsed
                .query_pairs()
                .find(|(k, _)| k == "expires_in")
                .map(|(_, v)| v.to_string());

            match access_token {
                Some(token) => {
                    let payload = serde_json::json!({
                        "access_token": token,
                        "refresh_token": refresh_token,
                        "expires_in": expires_in,
                        "client_id": get_client_id(false)
                    });

                    let response = tiny_http::Response::from_string(build_callback_html(
                        true,
                        "Authentication successful. You can return to Digital Habits: To-Do.",
                    ))
                    .with_header(
                        tiny_http::Header::from_bytes(
                            &b"Content-Type"[..],
                            &b"text/html; charset=utf-8"[..],
                        )
                        .unwrap(),
                    );
                    let _ = request.respond(response);

                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("basecamp-auth-success", payload);
                        let _ = window.set_focus();
                    }
                }
                None => {
                    let error_msg = "No access token received from localhost callback";
                    let response =
                        tiny_http::Response::from_string(build_callback_html(false, error_msg))
                            .with_status_code(400)
                            .with_header(
                                tiny_http::Header::from_bytes(
                                    &b"Content-Type"[..],
                                    &b"text/html; charset=utf-8"[..],
                                )
                                .unwrap(),
                            );
                    let _ = request.respond(response);
                    emit_auth_error(&app, error_msg);
                }
            }
        }
    });

    Ok(port)
}

fn build_callback_html(success: bool, message: &str) -> String {
    let title = if success {
        "Authentication successful"
    } else {
        "Authentication failed"
    };

    format!(
        "<html><body style=\"font-family: system-ui; text-align: center; padding: 48px 24px;\"><h1>{}</h1><p>{}</p><script>setTimeout(() => window.close(), 600);</script></body></html>",
        title, message
    )
}

fn emit_auth_error(app: &AppHandle, error_msg: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("basecamp-auth-error", error_msg);
    }
}

/// Exchange authorization code for tokens via Amplify hosting function
async fn exchange_code_for_token(code: &str, client_id: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();

    let response = client
        .post("https://todo.digitalhabits.org/api/exchange")
        .json(&serde_json::json!({
            "code": code,
            "redirect_uri": BC_REDIRECT_URI_DEV,
            "client_id": client_id
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed: {}", error_text));
    }

    let mut token_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Add client_id to response
    if let Some(obj) = token_data.as_object_mut() {
        obj.insert("client_id".to_string(), serde_json::json!(client_id));
    }

    Ok(token_data)
}

/// Handle OAuth callback (called from deep link handler in production)
#[command]
pub async fn handle_oauth_callback(app: AppHandle, url: String) -> Result<(), String> {
    log::info!("[Basecamp OAuth] Received callback URL: {}", url);

    let parsed = match url::Url::parse(&url) {
        Ok(u) => u,
        Err(e) => {
            let error_msg = format!("Failed to parse OAuth URL: {}", e);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("basecamp-auth-error", &error_msg);
            }
            return Err(error_msg);
        }
    };

    // Check for error in callback
    if let Some(error) = parsed.query_pairs().find(|(k, _)| k == "error") {
        let error_desc = parsed
            .query_pairs()
            .find(|(k, _)| k == "error_description")
            .map(|(_, v)| v.to_string())
            .unwrap_or_else(|| error.1.to_string());

        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("basecamp-auth-error", &error_desc);
        }
        return Err(error_desc);
    }

    // Extract tokens
    let access_token = parsed
        .query_pairs()
        .find(|(k, _)| k == "access_token")
        .map(|(_, v)| v.to_string());
    let refresh_token = parsed
        .query_pairs()
        .find(|(k, _)| k == "refresh_token")
        .map(|(_, v)| v.to_string());
    let expires_in = parsed
        .query_pairs()
        .find(|(k, _)| k == "expires_in")
        .map(|(_, v)| v.to_string());

    let is_dev = cfg!(debug_assertions);

    match access_token {
        Some(token) => {
            let payload = serde_json::json!({
                "access_token": token,
                "refresh_token": refresh_token,
                "expires_in": expires_in,
                "client_id": get_client_id(is_dev)
            });

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("basecamp-auth-success", payload);
                let _ = window.set_focus();
            }

            Ok(())
        }
        None => {
            let error_msg = "No access token received";
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("basecamp-auth-error", error_msg);
            }
            Err(error_msg.to_string())
        }
    }
}

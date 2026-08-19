//! Bearer-token auth, ported from `src/auth.ts`, as an axum middleware.
//!
//! When no API key is configured, everything passes. When one is, every request
//! except `/health` must carry `Authorization: Bearer <key>`.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode, header::AUTHORIZATION},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::types::AppConfig;

pub async fn require_auth(
    State(config): State<Arc<AppConfig>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    if let Some(key) = &config.api_key
        && request.uri().path() != "/health"
    {
        let expected = format!("Bearer {key}");
        let provided = request
            .headers()
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok());
        if provided != Some(expected.as_str()) {
            return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
        }
    }
    next.run(request).await
}

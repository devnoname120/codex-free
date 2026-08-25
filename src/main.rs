use clap::Parser;

use codex_free::config::{Cli, load_config};
use codex_free::server::start_http_server;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    // We build reqwest with `rustls-no-provider`, so a rustls crypto provider
    // must be installed process-wide before any HTTP client is built. Every
    // client factory installs it too, but do it once up front so any client
    // constructed by a dependency also finds a provider.
    codex_free::tls::ensure_crypto_provider();

    let cli = Cli::parse();
    let config = match load_config(cli) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    };

    if let Err(e) = start_http_server(config).await {
        eprintln!("Server error: {e}");
        std::process::exit(1);
    }
}

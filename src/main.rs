use clap::Parser;

use codex_free::config::{Cli, load_config};
use codex_free::logging;
use codex_free::server::start_http_server;

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    logging::init(cli.verbose);
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

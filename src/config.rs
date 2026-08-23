//! CLI parsing and config loading. Ports `src/config.ts`.
//!
//! An existing `codex.config.json` keeps working: every field is read with its
//! original camelCase name, absent sections fall back to the same defaults the
//! TypeScript used, and a missing config file is tolerated.

use std::path::{Path, PathBuf};

use clap::Parser;
use serde::Deserialize;

use std::collections::HashMap;

use crate::types::{
    AppConfig, CommandConfig, ExecConfig, ExecMode, IgnoreConfig, McpServerSpec, MemoryConfig,
    OpenAiTunnelConfig, OutputConfig, ProjectDocConfig, SkillsConfig, TreeConfig,
};

#[derive(Parser, Debug)]
#[command(
    name = "codexrr",
    about = "Codex Free MCP bridge (Rust): expose Codex-style agent tools over Streamable HTTP."
)]
pub struct Cli {
    /// Project directory the tools operate on (required).
    #[arg(long = "work-dir")]
    pub work_dir: String,

    /// Server port. Default: 3000 (or the config file's value).
    #[arg(long)]
    pub port: Option<u16>,

    /// Bearer token for auth. When set, every request except /health must carry it.
    #[arg(long = "api-key")]
    pub api_key: Option<String>,

    /// Config file path. Default: ./codex.config.json (tolerated if missing).
    #[arg(long)]
    pub config: Option<String>,

    /// Existing OpenAI Secure MCP Tunnel id. Enables the outbound native tunnel.
    #[arg(long = "openai-tunnel-id")]
    pub openai_tunnel_id: Option<String>,

    /// Runtime API-key reference: env:NAME or file:/path/to/key.
    #[arg(long = "openai-tunnel-api-key-ref")]
    pub openai_tunnel_api_key_ref: Option<String>,

    /// Explicit tunnel-client or tunnel-client-runtime binary.
    #[arg(long = "openai-tunnel-client")]
    pub openai_tunnel_client: Option<String>,

    /// Optional OpenAI organization id sent by tunnel-client.
    #[arg(long = "openai-tunnel-organization-id")]
    pub openai_tunnel_organization_id: Option<String>,
}

fn default_allowed_commands() -> Vec<String> {
    [
        "bun", "npm", "npx", "node", "git", "python", "pip", "cargo", "make",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

fn default_extra_allowed() -> Vec<String> {
    [
        "ls", "cat", "grep", "find", "head", "tail", "wc", "echo", "pwd", "which", "rg", "sed",
        "awk", "sort", "uniq", "diff", "true", "false",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

fn default_tree() -> TreeConfig {
    TreeConfig {
        default_depth: 3,
        ignore: ["node_modules", ".git", "dist", ".next", "__pycache__"]
            .into_iter()
            .map(String::from)
            .collect(),
    }
}

fn default_command() -> CommandConfig {
    CommandConfig {
        default_timeout: 30_000,
        max_timeout: 120_000,
    }
}

fn default_exec() -> ExecConfig {
    ExecConfig {
        mode: ExecMode::Allowlist,
        extra_allowed_commands: default_extra_allowed(),
        max_sessions: 8,
        default_shell: None,
    }
}

// ─── File config (all optional) ────────────────────────────────────────

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialTree {
    default_depth: Option<usize>,
    ignore: Option<Vec<String>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialCommand {
    default_timeout: Option<u64>,
    max_timeout: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialExec {
    mode: Option<ExecMode>,
    extra_allowed_commands: Option<Vec<String>>,
    max_sessions: Option<usize>,
    default_shell: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialOpenAiTunnel {
    tunnel_id: Option<String>,
    api_key_ref: Option<String>,
    client_path: Option<String>,
    organization_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileConfig {
    api_key: Option<String>,
    port: Option<u16>,
    allowed_commands: Option<Vec<String>>,
    tree: Option<PartialTree>,
    command: Option<PartialCommand>,
    exec: Option<PartialExec>,
    project_doc: Option<ProjectDocConfig>,
    output: Option<OutputConfig>,
    memory: Option<MemoryConfig>,
    skills: Option<SkillsConfig>,
    ignore: Option<IgnoreConfig>,
    allowed_hosts: Option<Vec<String>>,
    openai_tunnel: Option<PartialOpenAiTunnel>,
    mcp_servers: Option<HashMap<String, McpServerSpec>>,
}

/// A fully-defaulted config for a given work directory, matching what
/// `load_config` produces from an empty config file. Handy for tests and for
/// embedding the server without a config file.
pub fn default_config(work_dir: std::path::PathBuf) -> AppConfig {
    AppConfig {
        work_dir,
        api_key: None,
        port: 3000,
        allowed_commands: default_allowed_commands(),
        tree: default_tree(),
        command: default_command(),
        exec: default_exec(),
        project_doc: ProjectDocConfig::default(),
        output: OutputConfig::default(),
        memory: MemoryConfig::default(),
        skills: SkillsConfig::default(),
        ignore: IgnoreConfig::default(),
        allowed_hosts: Vec::new(),
        openai_tunnel: None,
        mcp_servers: HashMap::new(),
        generated_skills_dir: None,
    }
}

/// Resolve `work_dir` against the current directory when relative. The path is
/// stored as-is (matching the TS, which keeps `cli.workDir` verbatim for display);
/// `memory_dir` normalises separately when hashing so trailing-slash variants
/// still key the same per-project state.
fn resolve_work_dir(raw: &str) -> PathBuf {
    let p = Path::new(raw);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(p)
    }
}

fn resolve_path(raw: &str) -> PathBuf {
    let path = Path::new(raw);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    }
}

fn valid_tunnel_id(value: &str) -> bool {
    value.strip_prefix("tunnel_").is_some_and(|suffix| {
        suffix.len() == 32
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

fn valid_env_name(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn resolve_api_key_ref(raw: &str) -> Result<String, String> {
    if let Some(name) = raw.strip_prefix("env:") {
        if valid_env_name(name) {
            return Ok(raw.to_string());
        }
        return Err("openaiTunnel.apiKeyRef has an invalid environment-variable name".into());
    }
    if let Some(path) = raw.strip_prefix("file:") {
        if path.trim().is_empty() {
            return Err("openaiTunnel.apiKeyRef file path is empty".into());
        }
        return Ok(format!("file:{}", resolve_path(path).display()));
    }
    Err(
        "openaiTunnel.apiKeyRef must be env:NAME or file:/path; literal API keys are rejected"
            .into(),
    )
}

fn resolve_openai_tunnel(
    file: Option<PartialOpenAiTunnel>,
    cli: &Cli,
) -> Result<Option<OpenAiTunnelConfig>, String> {
    let requested = file.is_some()
        || cli.openai_tunnel_id.is_some()
        || cli.openai_tunnel_api_key_ref.is_some()
        || cli.openai_tunnel_client.is_some()
        || cli.openai_tunnel_organization_id.is_some();
    if !requested {
        return Ok(None);
    }

    let file = file.unwrap_or_default();
    let tunnel_id = cli
        .openai_tunnel_id
        .clone()
        .or(file.tunnel_id)
        .ok_or_else(|| "openaiTunnel requires tunnelId (or --openai-tunnel-id)".to_string())?;
    if !valid_tunnel_id(&tunnel_id) {
        return Err(
            "OpenAI tunnel id must be tunnel_ followed by 32 lowercase hexadecimal characters"
                .into(),
        );
    }

    let api_key_ref = resolve_api_key_ref(
        cli.openai_tunnel_api_key_ref
            .as_deref()
            .or(file.api_key_ref.as_deref())
            .unwrap_or("env:CONTROL_PLANE_API_KEY"),
    )?;
    let client_path = cli
        .openai_tunnel_client
        .as_deref()
        .or(file.client_path.as_deref())
        .map(resolve_path);
    let organization_id = cli
        .openai_tunnel_organization_id
        .clone()
        .or(file.organization_id)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if organization_id
        .as_deref()
        .is_some_and(|value| value.chars().any(char::is_control))
    {
        return Err("openaiTunnel.organizationId must not contain control characters".into());
    }

    Ok(Some(OpenAiTunnelConfig {
        tunnel_id,
        api_key_ref,
        organization_id,
        client_path,
    }))
}

/// Load and merge config. Errors are returned as strings for the caller to
/// print and exit on, mirroring the TS which validates and `process.exit`s.
pub fn load_config(cli: Cli) -> Result<AppConfig, String> {
    let work_dir = resolve_work_dir(&cli.work_dir);

    // Validate work-dir exists and is a directory.
    match std::fs::metadata(&work_dir) {
        Ok(m) if m.is_dir() => {}
        Ok(_) => {
            return Err(format!(
                "work-dir is not a directory: {}",
                work_dir.display()
            ));
        }
        Err(_) => return Err(format!("work-dir does not exist: {}", work_dir.display())),
    }

    let config_path = cli
        .config
        .clone()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("codex.config.json"));

    // Show the absolute path of the config actually loaded, so it is obvious
    // when codexrr picked up a different file than the one being edited.
    let display_path = if config_path.is_absolute() {
        config_path.clone()
    } else {
        std::env::current_dir()
            .unwrap_or_default()
            .join(&config_path)
    };
    let file: FileConfig = match std::fs::read_to_string(&config_path) {
        Ok(text) => {
            println!("Config: {}", display_path.display());
            serde_json::from_str(&text)
                .map_err(|e| format!("invalid config file {}: {e}", config_path.display()))?
        }
        Err(_) => {
            println!(
                "Config: no file at {} — using built-in defaults (pass --config to point elsewhere)",
                display_path.display()
            );
            FileConfig::default()
        }
    };

    let mut tree = default_tree();
    if let Some(t) = file.tree {
        if let Some(d) = t.default_depth {
            tree.default_depth = d;
        }
        if let Some(ig) = t.ignore {
            tree.ignore = ig;
        }
    }

    let mut command = default_command();
    if let Some(c) = file.command {
        if let Some(d) = c.default_timeout {
            command.default_timeout = d;
        }
        if let Some(m) = c.max_timeout {
            command.max_timeout = m;
        }
    }

    let mut exec = default_exec();
    if let Some(e) = file.exec {
        if let Some(m) = e.mode {
            exec.mode = m;
        }
        if let Some(x) = e.extra_allowed_commands {
            exec.extra_allowed_commands = x;
        }
        if let Some(s) = e.max_sessions {
            exec.max_sessions = s;
        }
        if e.default_shell.is_some() {
            exec.default_shell = e.default_shell;
        }
    }

    let openai_tunnel = resolve_openai_tunnel(file.openai_tunnel, &cli)?;
    let api_key = cli.api_key.or(file.api_key);
    if api_key.is_some() && openai_tunnel.is_some() {
        return Err(
            "--api-key cannot be combined with openaiTunnel: native tunnel mode is loopback-only and does not expose the local MCP listener"
                .into(),
        );
    }

    Ok(AppConfig {
        work_dir,
        api_key,
        port: cli.port.or(file.port).unwrap_or(3000),
        allowed_commands: file
            .allowed_commands
            .unwrap_or_else(default_allowed_commands),
        tree,
        command,
        exec,
        project_doc: file.project_doc.unwrap_or_default(),
        output: file.output.unwrap_or_default(),
        memory: file.memory.unwrap_or_default(),
        skills: file.skills.unwrap_or_default(),
        ignore: file.ignore.unwrap_or_default(),
        allowed_hosts: file.allowed_hosts.unwrap_or_default(),
        openai_tunnel,
        mcp_servers: file.mcp_servers.unwrap_or_default(),
        generated_skills_dir: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cli(work_dir: &Path, config: &Path) -> Cli {
        Cli {
            work_dir: work_dir.to_string_lossy().into_owned(),
            port: None,
            api_key: None,
            config: Some(config.to_string_lossy().into_owned()),
            openai_tunnel_id: None,
            openai_tunnel_api_key_ref: None,
            openai_tunnel_client: None,
            openai_tunnel_organization_id: None,
        }
    }

    #[test]
    fn loads_native_tunnel_with_a_secret_reference_default() {
        let root = tempfile::tempdir().unwrap();
        let config_path = root.path().join("config.json");
        std::fs::write(
            &config_path,
            r#"{"openaiTunnel":{"tunnelId":"tunnel_0123456789abcdef0123456789abcdef"}}"#,
        )
        .unwrap();

        let config = load_config(cli(root.path(), &config_path)).unwrap();
        let tunnel = config.openai_tunnel.unwrap();
        assert_eq!(tunnel.tunnel_id, "tunnel_0123456789abcdef0123456789abcdef");
        assert_eq!(tunnel.api_key_ref, "env:CONTROL_PLANE_API_KEY");
        assert!(tunnel.client_path.is_none());
    }

    #[test]
    fn rejects_literal_tunnel_api_keys() {
        let root = tempfile::tempdir().unwrap();
        let config_path = root.path().join("config.json");
        std::fs::write(
            &config_path,
            r#"{"openaiTunnel":{"tunnelId":"tunnel_0123456789abcdef0123456789abcdef","apiKeyRef":"sk-literal-secret-value"}}"#,
        )
        .unwrap();

        let error = load_config(cli(root.path(), &config_path)).unwrap_err();
        assert!(error.contains("literal API keys are rejected"));
    }

    #[test]
    fn rejects_local_bearer_auth_in_native_tunnel_mode() {
        let root = tempfile::tempdir().unwrap();
        let config_path = root.path().join("config.json");
        std::fs::write(
            &config_path,
            r#"{"apiKey":"local-token","openaiTunnel":{"tunnelId":"tunnel_0123456789abcdef0123456789abcdef"}}"#,
        )
        .unwrap();

        let error = load_config(cli(root.path(), &config_path)).unwrap_err();
        assert!(error.contains("cannot be combined with openaiTunnel"));
    }

    #[test]
    fn cli_tunnel_fields_override_the_file() {
        let root = tempfile::tempdir().unwrap();
        let config_path = root.path().join("config.json");
        std::fs::write(
            &config_path,
            r#"{"openaiTunnel":{"tunnelId":"tunnel_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","apiKeyRef":"env:OLD_KEY"}}"#,
        )
        .unwrap();
        let mut args = cli(root.path(), &config_path);
        args.openai_tunnel_id = Some("tunnel_0123456789abcdef0123456789abcdef".to_string());
        args.openai_tunnel_api_key_ref = Some("env:NEW_KEY".to_string());
        args.openai_tunnel_client = Some("bin/tunnel-client".to_string());

        let config = load_config(args).unwrap();
        let tunnel = config.openai_tunnel.unwrap();
        assert_eq!(tunnel.api_key_ref, "env:NEW_KEY");
        assert_eq!(
            tunnel.client_path.unwrap(),
            std::env::current_dir().unwrap().join("bin/tunnel-client")
        );
    }

    #[test]
    fn validates_the_native_tunnel_id_shape() {
        let root = tempfile::tempdir().unwrap();
        let config_path = root.path().join("config.json");
        std::fs::write(
            &config_path,
            r#"{"openaiTunnel":{"tunnelId":"tunnel_NOT_HEX"}}"#,
        )
        .unwrap();

        let error = load_config(cli(root.path(), &config_path)).unwrap_err();
        assert!(error.contains("32 lowercase hexadecimal characters"));

        std::fs::write(
            &config_path,
            r#"{"openaiTunnel":{"tunnelId":"tunnel_gggggggggggggggggggggggggggggggg"}}"#,
        )
        .unwrap();
        let error = load_config(cli(root.path(), &config_path)).unwrap_err();
        assert!(error.contains("32 lowercase hexadecimal characters"));
    }
}

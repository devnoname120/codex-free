//! The tool registry. Ports `src/registry.ts`.
//!
//! `load_tools` returns every registered tool and enforces that names are
//! unique, panicking on a duplicate (a programming error, as in the TS which
//! throws at startup). The order mirrors the TypeScript registry.

use crate::tool::Tool;
use crate::tools;

pub fn load_tools() -> Vec<Box<dyn Tool>> {
    let all: Vec<Box<dyn Tool>> = vec![
        Box::new(tools::read_file::ReadFile),
        Box::new(tools::write_file::WriteFile),
        Box::new(tools::run_command::RunCommand),
        Box::new(tools::git_status::GitStatus),
        Box::new(tools::git_push::GitPush),
        Box::new(tools::git_commit::GitCommit),
        Box::new(tools::git_log::GitLog),
        Box::new(tools::glob::Glob),
        Box::new(tools::grep::Grep),
        Box::new(tools::list_directory::ListDirectory),
        Box::new(tools::tree::Tree),
        // Ported from Codex (codex-rs/core/src/tools). Names use underscores
        // because MCP tool names must match ^[a-zA-Z0-9_-]{1,64}$.
        Box::new(tools::apply_patch::ApplyPatch),
        Box::new(tools::exec_command::ExecCommand),
        Box::new(tools::write_stdin::WriteStdin),
        Box::new(tools::view_image::ViewImage),
        Box::new(tools::update_plan::UpdatePlan),
        Box::new(tools::clock_curr_time::ClockCurrTime),
        Box::new(tools::clock_sleep::ClockSleep),
        // None of these three is a Codex tool: get_environment, get_project_doc
        // and get_agent_brief surface facts Codex sends through channels an MCP
        // server does not have.
        Box::new(tools::get_environment::GetEnvironment),
        Box::new(tools::get_project_doc::GetProjectDoc),
        Box::new(tools::get_agent_brief::GetAgentBrief),
        // Persistent working memory: what a chat window loses between conversations.
        Box::new(tools::remember::Remember),
        Box::new(tools::recall::Recall),
        // Codex's skills.list / skills.read.
        Box::new(tools::skills_list::SkillsList),
        Box::new(tools::skills_read::SkillsRead),
    ];

    let mut seen = std::collections::HashSet::new();
    for tool in &all {
        if !seen.insert(tool.name()) {
            panic!("Duplicate tool name: {}", tool.name());
        }
    }
    all
}

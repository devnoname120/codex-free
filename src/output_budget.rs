//! Ceilings on what a single tool call may return. Ports `src/output-budget.ts`.
//!
//! Every cut is announced in the tool's own text with the argument that
//! continues from where it stopped; silent truncation reads as "that was the
//! whole file", which is worse than no cap at all.

use crate::types::AppConfig;

pub const DEFAULT_MAX_FILE_LINES: usize = 1_000;
pub const DEFAULT_MAX_FILE_BYTES: usize = 131_072;
pub const DEFAULT_MAX_ENTRIES: usize = 500;
pub const DEFAULT_MAX_TREE_NODES: usize = 1_000;

#[derive(Debug, Clone, Copy)]
pub struct FileBudget {
    pub max_lines: usize,
    pub max_bytes: usize,
}

pub fn file_budget(config: &AppConfig) -> FileBudget {
    FileBudget {
        max_lines: config
            .output
            .max_file_lines
            .unwrap_or(DEFAULT_MAX_FILE_LINES),
        max_bytes: config
            .output
            .max_file_bytes
            .unwrap_or(DEFAULT_MAX_FILE_BYTES),
    }
}

pub fn entry_budget(config: &AppConfig) -> usize {
    config.output.max_entries.unwrap_or(DEFAULT_MAX_ENTRIES)
}

pub fn tree_node_budget(config: &AppConfig) -> usize {
    config
        .output
        .max_tree_nodes
        .unwrap_or(DEFAULT_MAX_TREE_NODES)
}

#[derive(Debug, Clone)]
pub struct FileWindow {
    /// The lines actually returned.
    pub lines: Vec<String>,
    /// 0-based index of the first returned line.
    pub start: usize,
    /// Total lines in the file, before any windowing.
    pub total: usize,
    /// Human-readable note about what was cut, or `None` when nothing was.
    pub notice: Option<String>,
}

/// Take the first `max_bytes` bytes of `s`, decoding lossily so a multibyte
/// character straddling the cut becomes U+FFFD — matching Node's
/// `Buffer.subarray(0, n).toString("utf8")`.
fn byte_prefix(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    String::from_utf8_lossy(&s.as_bytes()[..max_bytes]).into_owned()
}

/// Slice a file to a window that fits both budgets.
///
/// The byte cap is not redundant with the line cap: a minified bundle is often
/// one line several megabytes long, which a line cap alone would return in full.
pub fn window_file_lines(
    lines: &[&str],
    offset: usize,
    requested_limit: Option<usize>,
    budget: FileBudget,
) -> FileWindow {
    let total = lines.len();
    let start = offset.min(total);
    let limit = requested_limit
        .unwrap_or(budget.max_lines)
        .min(budget.max_lines);

    let mut kept: Vec<String> = Vec::new();
    let mut bytes = 0usize;
    let mut cut_on_bytes = false;

    let slice_end = start.saturating_add(limit).min(total);
    for line in &lines[start..slice_end] {
        let size = line.len() + 1;
        if bytes + size > budget.max_bytes {
            if kept.is_empty() {
                // A single line larger than the whole budget: return a prefix so
                // the caller sees something rather than an empty window.
                kept.push(byte_prefix(line, budget.max_bytes));
            }
            cut_on_bytes = true;
            break;
        }
        kept.push((*line).to_string());
        bytes += size;
    }

    let end = start + kept.len();
    if start == 0 && end == total && !cut_on_bytes {
        return FileWindow {
            lines: kept,
            start,
            total,
            notice: None,
        };
    }

    let reason = if cut_on_bytes {
        ", cut at the byte budget"
    } else {
        ""
    };
    let more = if end < total {
        format!(" — call again with offset={end} for the rest")
    } else {
        String::new()
    };
    let notice = format!(
        "(showing lines {}-{} of {}{}{})",
        start + 1,
        end,
        total,
        reason,
        more
    );
    FileWindow {
        lines: kept,
        start,
        total,
        notice: Some(notice),
    }
}

/// Cut a list to `max`, reporting how many entries were dropped.
pub fn limit_list<T>(mut items: Vec<T>, max: usize) -> (Vec<T>, usize) {
    if max == 0 || items.len() <= max {
        return (items, 0);
    }
    let dropped = items.len() - max;
    items.truncate(max);
    (items, dropped)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn budget(max_lines: usize, max_bytes: usize) -> FileBudget {
        FileBudget {
            max_lines,
            max_bytes,
        }
    }

    #[test]
    fn whole_small_file_has_no_notice() {
        let lines = vec!["a", "b", "c"];
        let w = window_file_lines(&lines, 0, None, budget(1000, 1000));
        assert_eq!(w.lines, vec!["a", "b", "c"]);
        assert!(w.notice.is_none());
    }

    #[test]
    fn line_cap_windows_and_notices() {
        let lines = vec!["a", "b", "c", "d"];
        let w = window_file_lines(&lines, 0, None, budget(2, 1000));
        assert_eq!(w.lines, vec!["a", "b"]);
        let n = w.notice.unwrap();
        assert!(n.contains("offset=2"), "{n}");
    }

    #[test]
    fn offset_windows() {
        let lines = vec!["a", "b", "c", "d"];
        let w = window_file_lines(&lines, 2, None, budget(1000, 1000));
        assert_eq!(w.lines, vec!["c", "d"]);
    }

    #[test]
    fn byte_cap_on_single_huge_line() {
        let huge = "x".repeat(100);
        let lines = vec![huge.as_str()];
        let w = window_file_lines(&lines, 0, None, budget(1000, 10));
        assert_eq!(w.lines[0].len(), 10);
        assert!(w.notice.unwrap().contains("byte budget"));
    }

    #[test]
    fn limit_list_reports_dropped() {
        let (items, dropped) = limit_list(vec![1, 2, 3, 4, 5], 3);
        assert_eq!(items, vec![1, 2, 3]);
        assert_eq!(dropped, 2);
    }
}

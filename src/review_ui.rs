use rmcp::model::{MetaObject, Resource, ResourceContents};
use serde_json::json;

pub const REVIEW_UI_URI: &str = "ui://codex-free/review/mcp-app.html";
pub const REVIEW_UI_MIME_TYPE: &str = "text/html;profile=mcp-app";
pub const MCP_APPS_EXTENSION_ID: &str = "io.modelcontextprotocol/ui";

pub fn tool_meta() -> MetaObject {
    serde_json::from_value(json!({
        "ui": { "resourceUri": REVIEW_UI_URI },
        "ui/resourceUri": REVIEW_UI_URI
    }))
    .expect("static review tool metadata must be an object")
}

pub fn resource_meta() -> MetaObject {
    serde_json::from_value(json!({
        "ui": { "prefersBorder": true }
    }))
    .expect("static review resource metadata must be an object")
}

pub fn resource() -> Resource {
    Resource::new(REVIEW_UI_URI, "codex-free-review")
        .with_title("Code review")
        .with_description("Interactive rendering of Codex Free review checkpoints")
        .with_mime_type(REVIEW_UI_MIME_TYPE)
        .with_size(REVIEW_UI_HTML.len() as u64)
        .with_meta(resource_meta())
}

pub fn contents() -> ResourceContents {
    ResourceContents::text(REVIEW_UI_HTML, REVIEW_UI_URI)
        .with_mime_type(REVIEW_UI_MIME_TYPE)
        .with_meta(resource_meta())
}

pub const REVIEW_UI_HTML: &str = r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Code review</title>
<style>
:root {
  color-scheme: light dark;
  --bg: var(--color-background-primary, light-dark(#ffffff, #171717));
  --panel: var(--color-background-secondary, light-dark(#f6f7f8, #222222));
  --text: var(--color-text-primary, light-dark(#171717, #f4f4f4));
  --muted: var(--color-text-secondary, light-dark(#62666d, #a7a7a7));
  --border: var(--color-border-primary, light-dark(#d9dce1, #3a3a3a));
  --added-bg: light-dark(#e7f7ed, #163321);
  --added-text: light-dark(#145c2e, #8ee4aa);
  --deleted-bg: light-dark(#fceaea, #421d1d);
  --deleted-text: light-dark(#8a1f1f, #f2a0a0);
  --accent: light-dark(#2457c5, #8db4ff);
  --tap-target: 44px;
  font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}
* { box-sizing: border-box; }
html, body { max-width: 100%; overflow-x: hidden; }
body { margin: 0; background: var(--bg); color: var(--text); }
main { display: grid; width: 100%; min-width: 0; gap: 12px; padding: clamp(8px, 2.5vw, 14px); }
header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px 16px; }
h1 { margin: 0; font-size: 16px; line-height: 1.35; }
.subhead { margin-top: 3px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.badge { border: 1px solid var(--border); border-radius: 999px; padding: 4px 8px; color: var(--muted); font-size: 11px; white-space: nowrap; }
.summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.metric { border: 1px solid var(--border); border-radius: 10px; padding: 9px 10px; background: var(--panel); }
.metric strong { display: block; font-size: 16px; font-variant-numeric: tabular-nums; }
.metric span { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .055em; }
section { min-width: 0; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.section-title { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; padding: 9px 11px; background: var(--panel); border-bottom: 1px solid var(--border); font-size: 12px; font-weight: 650; }
.section-hint { color: var(--muted); font-size: 11px; font-weight: 400; text-align: right; }
.files { display: grid; }
.file-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px 10px; min-height: var(--tap-target); padding: 8px 11px; border-top: 1px solid var(--border); font-size: 12px; }
.file-row:first-child { border-top: 0; }
.diff-file { min-width: 0; border-top: 1px solid var(--border); }
.diff-file:first-child { border-top: 0; }
.diff-summary { display: grid; grid-template-columns: 10px auto minmax(0, 1fr) auto; align-items: center; gap: 8px 10px; min-height: var(--tap-target); padding: 8px 11px; cursor: pointer; list-style: none; font-size: 12px; -webkit-tap-highlight-color: transparent; }
.diff-summary::-webkit-details-marker { display: none; }
.diff-summary::before { content: ""; width: 7px; height: 7px; border-right: 1.5px solid var(--muted); border-bottom: 1.5px solid var(--muted); transform: rotate(-45deg); transition: transform 120ms ease; }
.diff-summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.diff-file[open] > .diff-summary { background: var(--panel); }
.diff-file[open] > .diff-summary::before { transform: rotate(45deg); }
.status { justify-self: start; border: 1px solid var(--border); border-radius: 999px; padding: 2px 6px; color: var(--muted); font-size: 10px; line-height: 1.3; text-transform: capitalize; white-space: nowrap; }
.path { min-width: 0; overflow-wrap: anywhere; font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
.stats { font-variant-numeric: tabular-nums; white-space: nowrap; }
.add { color: var(--added-text); }
.del { color: var(--deleted-text); margin-left: 7px; }
.empty, .notice { padding: 18px 12px; color: var(--muted); font-size: 12px; text-align: center; }
.warning { border: 1px solid var(--border); border-radius: 10px; padding: 9px 11px; color: var(--muted); font-size: 12px; }
.diff-body { min-width: 0; max-width: 100%; border-top: 1px solid var(--border); }
pre { max-width: 100%; margin: 0; overflow-x: auto; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; font: 11px/1.55 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); tab-size: 4; }
.line { display: block; width: max-content; min-width: 100%; padding: 0 11px; white-space: pre; }
.line.added { background: var(--added-bg); color: var(--added-text); }
.line.deleted { background: var(--deleted-bg); color: var(--deleted-text); }
.line.hunk { color: var(--accent); background: var(--panel); }
.line.meta { color: var(--muted); }
@media (max-width: 520px) {
  main { padding: 8px; }
  header { display: grid; }
  .badge { justify-self: start; }
  .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .section-title { align-items: flex-start; flex-wrap: wrap; }
  .section-hint { text-align: left; }
  .file-row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 4px; padding: 8px; }
  .file-row .status { grid-column: 1; grid-row: 1; }
  .file-row .stats { grid-column: 2; grid-row: 1; }
  .file-row .path { grid-column: 1 / 3; grid-row: 2; }
  .diff-summary { grid-template-columns: 10px minmax(0, 1fr) auto; row-gap: 4px; padding: 8px; }
  .diff-summary::before { grid-row: 1 / span 2; }
  .diff-summary .status { grid-column: 2; grid-row: 1; }
  .diff-summary .stats { grid-column: 3; grid-row: 1; }
  .diff-summary .path { grid-column: 2 / 4; grid-row: 2; }
  pre { font-size: 10px; }
  .line { padding: 0 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .diff-summary::before { transition: none; }
}
</style>
</head>
<body>
<main id="root" aria-live="polite">
  <div class="notice">Preparing review…</div>
</main>
<script>
(() => {
  "use strict";
  const root = document.getElementById("root");
  let nextId = 1;
  const pending = new Map();
  let resizeObserver;

  function post(message) {
    window.parent.postMessage(message, "*");
  }

  function request(method, params) {
    const id = nextId++;
    post({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  function notify(method, params) {
    post({ jsonrpc: "2.0", method, params });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function metric(value, label) {
    const node = el("div", "metric");
    node.append(el("strong", "", value), el("span", "", label));
    return node;
  }

  function splitPatch(patch) {
    const chunks = [];
    let current = null;
    for (const line of patch.split("\n")) {
      if (line.startsWith("diff --git ")) {
        current = { heading: line.slice(11), lines: [line] };
        chunks.push(current);
      } else {
        if (!current) {
          current = { heading: "Patch", lines: [] };
          chunks.push(current);
        }
        current.lines.push(line);
      }
    }
    return chunks;
  }

  function displayPath(file, chunk) {
    if (file && file.path) return file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
    return chunk && chunk.heading ? chunk.heading : "Patch";
  }

  function fileStats(file) {
    const stats = el("span", "stats");
    if (!file) return stats;
    if (file.binary) stats.append(el("span", "", "binary"));
    else stats.append(
      el("span", "add", `+${file.additions || 0}`),
      el("span", "del", `-${file.deletions || 0}`)
    );
    return stats;
  }

  function renderDiffLines(lines, container) {
    const pre = el("pre");
    for (const text of lines) {
      let className = "line";
      if (text.startsWith("+") && !text.startsWith("+++")) className += " added";
      else if (text.startsWith("-") && !text.startsWith("---")) className += " deleted";
      else if (text.startsWith("@@")) className += " hunk";
      else if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(text)) className += " meta";
      pre.append(el("span", className, text + "\n"));
    }
    container.append(pre);
  }

  function scheduleSizeReport() {
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(reportSize);
    else reportSize();
  }

  function diffDetails(file, chunk, unavailableReason) {
    const details = el("details", "diff-file");
    details.open = false;
    const summary = el("summary", "diff-summary");
    summary.append(
      el("span", "status", file && file.status ? file.status : "changed"),
      el("span", "path", displayPath(file, chunk)),
      fileStats(file)
    );
    details.append(summary);

    let rendered = false;
    details.addEventListener("toggle", () => {
      if (details.open && !rendered) {
        rendered = true;
        const body = el("div", "diff-body");
        if (chunk) renderDiffLines(chunk.lines, body);
        else body.append(el("div", "empty", unavailableReason || "No textual diff is available for this file."));
        details.append(body);
      }
      scheduleSizeReport();
    });
    return details;
  }

  function fileRow(file) {
    const row = el("div", "file-row");
    row.append(
      el("span", "status", file.status || "changed"),
      el("span", "path", displayPath(file)),
      fileStats(file)
    );
    return row;
  }

  function renderFiles(data, container) {
    const files = Array.isArray(data.files) ? data.files : [];
    const patchAvailable = Boolean(data.patchIncluded && typeof data.patch === "string" && data.patch);
    const chunks = patchAvailable ? splitPatch(data.patch) : [];

    if (patchAvailable) {
      const count = Math.max(files.length, chunks.length);
      for (let index = 0; index < count; index += 1) {
        container.append(diffDetails(files[index], chunks[index], data.patchOmittedReason));
      }
    } else {
      for (const file of files) container.append(fileRow(file));
    }

    if (!files.length && !chunks.length) {
      const hasChanges = data.summary && data.summary.files;
      container.append(el("div", "empty", hasChanges
        ? "File metadata was omitted from this result."
        : "The scoped working tree matches the selected checkpoint."));
    }
    if (data.filesOmitted) {
      container.append(el("div", "empty", `${data.filesOmitted} additional file${data.filesOmitted === 1 ? "" : "s"} omitted from structured metadata.`));
    }
  }

  function render(data) {
    if (!data || typeof data !== "object") return;
    root.replaceChildren();
    const summary = data.summary || {};
    const header = el("header");
    const heading = el("div");
    heading.append(
      el("h1", "", summary.files ? `Changed ${summary.files} file${summary.files === 1 ? "" : "s"}` : "No changes"),
      el("div", "subhead", `Since ${String(data.since || "last_review").replaceAll("_", " ")} · scope ${data.scope || "."}`)
    );
    const badgeText = data.advanceRequested
      ? (data.checkpointAdvanced ? "Checkpoint advanced" : "Checkpoint unchanged")
      : "Read-only review";
    header.append(heading, el("div", "badge", badgeText));
    root.append(header);

    const metrics = el("div", "summary");
    metrics.append(
      metric(summary.files || 0, "Files"),
      metric(`+${summary.additions || 0}`, "Additions"),
      metric(`-${summary.deletions || 0}`, "Deletions"),
      metric(summary.binaryFiles || 0, "Binary")
    );
    root.append(metrics);

    const patchAvailable = Boolean(data.patchIncluded && typeof data.patch === "string" && data.patch);
    const filesSection = el("section");
    const filesTitle = el("div", "section-title");
    filesTitle.append(
      el("span", "", "Changes"),
      el("span", "section-hint", summary.files
        ? (patchAvailable ? "Select a file to view its diff" : "File summary only")
        : "No files")
    );
    filesSection.append(filesTitle);
    const files = el("div", "files");
    renderFiles(data, files);
    filesSection.append(files);
    root.append(filesSection);

    if (!patchAvailable && summary.files) {
      root.append(el("div", "warning", `Patch not shown: ${data.patchOmittedReason || "no textual patch was returned"}`));
    }
    for (const warning of data.warnings || []) root.append(el("div", "warning", warning));
    reportSize();
  }

  function toolResultPayload(params) {
    return params && (params.structuredContent || params.structured_content);
  }

  window.addEventListener("message", event => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    const hasResult = Object.prototype.hasOwnProperty.call(message, "result");
    const hasError = Object.prototype.hasOwnProperty.call(message, "error");
    if (Object.prototype.hasOwnProperty.call(message, "id") && (hasResult || hasError)) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      hasError ? waiter.reject(message.error) : waiter.resolve(message.result);
      return;
    }
    if (message.method === "ui/notifications/tool-result") {
      render(toolResultPayload(message.params));
    } else if (message.method === "ui/notifications/host-context-changed") {
      applyHostContext(message.params);
    } else if (message.method === "ui/resource-teardown" && message.id !== undefined) {
      post({ jsonrpc: "2.0", id: message.id, result: {} });
    }
  });

  function applyHostContext(context) {
    if (context && context.theme) document.documentElement.dataset.theme = context.theme;
  }

  function reportSize() {
    notify("ui/notifications/size-changed", {
      width: Math.ceil(document.documentElement.clientWidth || root.getBoundingClientRect().width),
      height: Math.ceil(document.documentElement.scrollHeight)
    });
  }

  function startSizeReporting() {
    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(reportSize);
      resizeObserver.observe(document.documentElement);
    }
    reportSize();
  }

  const legacy = window.openai && window.openai.toolOutput;
  if (legacy) render(legacy);
  window.addEventListener("openai:set_globals", event => {
    const output = event.detail && event.detail.globals && event.detail.globals.toolOutput;
    if (output) render(output);
  });

  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "codex-free-review", version: "1.0.0" },
    appCapabilities: {}
  }).then(result => {
    applyHostContext(result && result.hostContext);
    notify("ui/notifications/initialized", {});
    startSizeReporting();
  }).catch(error => {
    if (!legacy) root.replaceChildren(el("div", "notice", `Review UI could not initialize: ${error && error.message ? error.message : String(error)}`));
  });
})();
</script>
</body>
</html>
"##;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_metadata_carries_current_and_compatibility_resource_keys() {
        let meta = tool_meta();
        assert_eq!(
            meta.get("ui")
                .and_then(|value| value.get("resourceUri"))
                .and_then(serde_json::Value::as_str),
            Some(REVIEW_UI_URI)
        );
        assert_eq!(
            meta.get("ui/resourceUri")
                .and_then(serde_json::Value::as_str),
            Some(REVIEW_UI_URI)
        );
    }

    #[test]
    fn resource_uses_the_mcp_apps_mime_type() {
        let resource = resource();
        assert_eq!(resource.uri, REVIEW_UI_URI);
        assert_eq!(resource.mime_type.as_deref(), Some(REVIEW_UI_MIME_TYPE));
        let contents = contents();
        let value = serde_json::to_value(contents).unwrap();
        assert_eq!(value["uri"], REVIEW_UI_URI);
        assert_eq!(value["mimeType"], REVIEW_UI_MIME_TYPE);
    }

    #[test]
    fn embedded_view_implements_the_standard_handshake_and_safe_rendering() {
        assert!(REVIEW_UI_HTML.contains("ui/initialize"));
        assert!(REVIEW_UI_HTML.contains("ui/notifications/initialized"));
        assert!(REVIEW_UI_HTML.contains("ui/notifications/tool-result"));
        assert!(REVIEW_UI_HTML.contains("ui/notifications/size-changed"));
        assert!(REVIEW_UI_HTML.contains("event.source !== window.parent"));
        assert!(REVIEW_UI_HTML.contains("hasOwnProperty.call(message, \"result\")"));
        assert!(REVIEW_UI_HTML.contains("textContent"));
        assert!(!REVIEW_UI_HTML.contains("<script src="));
        let initialized = REVIEW_UI_HTML
            .find("notify(\"ui/notifications/initialized\", {});")
            .unwrap();
        let size_reporting = REVIEW_UI_HTML.find("startSizeReporting();").unwrap();
        assert!(initialized < size_reporting);
    }

    #[test]
    fn embedded_view_is_mobile_bounded_and_lazy_collapsed_by_file() {
        assert!(REVIEW_UI_HTML.contains("@media (max-width: 520px)"));
        assert!(REVIEW_UI_HTML.contains("el(\"details\", \"diff-file\")"));
        assert!(REVIEW_UI_HTML.contains("details.open = false"));
        assert!(REVIEW_UI_HTML.contains("details.addEventListener(\"toggle\""));
        assert!(REVIEW_UI_HTML.contains("renderDiffLines(chunk.lines, body)"));
        assert!(REVIEW_UI_HTML.contains("document.documentElement.clientWidth"));
        assert!(!REVIEW_UI_HTML.contains("document.documentElement.scrollWidth"));
    }
}

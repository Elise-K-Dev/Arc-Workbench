# Arc Workbench

Arc Workbench is a lightweight, terminal-first desktop workbench. Its primary
workspace objects are dockable panes rather than files or IDE tool windows.

This repository contains the MVP 0 and MVP 1 foundation: a Tauri v2 desktop
shell, a React/TypeScript floating workspace, and real local PTY-backed
terminals.

## Requirements

- Node.js 20.19 or newer
- npm 10 or newer
- Current stable Rust toolchain
- Tauri v2 platform prerequisites

On Linux, install the WebKitGTK and system packages listed in the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Development

```bash
conda activate norm-dev
npm install
npm run tauri dev
```

The current development environment uses Node.js and WebKitGTK from the
`norm-dev` conda environment. On a fresh copy of that environment:

```bash
conda install -n norm-dev -c conda-forge "nodejs>=20.19,<23" webkit2gtk4.1
conda env config vars set -n norm-dev \
  PKG_CONFIG_PATH="$CONDA_PREFIX/lib/pkgconfig:$CONDA_PREFIX/share/pkgconfig" \
  LD_LIBRARY_PATH="$CONDA_PREFIX/lib"
conda deactivate
conda activate norm-dev
```

The deactivate/activate cycle applies the native library paths after first-time
setup.

Build the frontend only:

```bash
npm run build
```

Build desktop bundles:

```bash
npm run tauri build
```

## Implemented

Current pane types:

- Terminal
- Browser
- Editor
- File explorer
- Git
- Agent

- Draggable, resizable floating terminal windows
- Floating iframe-based browser panes for localhost and development tools
- Floating CodeMirror editor panes with common language highlighting
- Pane focus and z-index management
- Canvas-relative maximize and restore
- Layout persistence in browser local storage
- Default terminal layout and layout reset
- Independent local PTY sessions for every terminal pane
- Keyboard input, streamed output, and responsive terminal resizing
- PTY termination when a terminal pane closes
- Compact browser URL bar, reload, and system-browser open action
- Native file open/save dialogs with dirty-buffer protection
- Persistent workspace root with a lazy-loading file explorer
- Read-only Git status, branch, changed-file, and diff visibility
- Local OpenAI-compatible assistant with opt-in workspace context
- Unix shell selection through `$SHELL`, `/bin/bash`, then `/bin/sh`
- Windows shell selection through `%COMSPEC%`, then PowerShell

## Roadmap

Future releases may add SSH, problems, and logs panes.
Agent work will use an approval-based, patch-oriented workflow with a local
model as the primary router and optional Codex escalation.

Arc Workbench does not currently include LSP diagnostics or completion, Git
write workflows, autonomous AI actions, SSH support, debugger, notebooks,
cloud login, or VS Code extension compatibility. There is also no command
palette yet.

## Local Preview Pane v0

Use **New Preview** to open a floating iframe preview. It defaults to
`http://localhost:5173` and is intentionally limited to local development
origins: `localhost`, `*.localhost`, `127.0.0.1`, and `::1`.

Local Preview is intended for Vite/React servers, FastAPI docs, local
dashboards, and similar development workflows. External URLs do not create an
iframe. Instead, Arc explains that CSP, `X-Frame-Options`, or
`frame-ancestors` commonly blocks embedding and provides **Open External**.
Local previews show their URL, a loading state, Reload, and a timeout diagnostic
when the development server is unavailable.

Existing persisted panes with kind `"browser"` remain compatible and restore
through the Local Preview renderer. Native Browser is an experimental future
path for general browsing using a Tauri child webview or `WebviewWindow`; it is
not enabled in the pane system. Arc does not bundle Chromium or attempt to
bypass site iframe policies.

## Editor Pane v0

Use **New Editor** to open an untitled CodeMirror buffer. **Open** reads a local
text file through the Rust backend, and **Save** writes to the existing path or
opens a native save dialog for untitled buffers. Closing a modified editor or
resetting the layout requires confirmation.

Untitled and modified buffers are retained in layout storage. Clean buffers
with a file path restore by reading the file again, which avoids duplicating
their contents in local storage. Editor Pane v0 provides syntax highlighting
for JavaScript/TypeScript, Rust, Python, Markdown, JSON, YAML, and TOML, but no
LSP features.

## File Explorer Pane v0

Use **Open Folder** to select the current workspace root and open or focus its
floating file explorer. Directories load only when expanded. Selecting a text
file opens it in an editor, while selecting an already-open file focuses the
existing editor instead of creating a duplicate.

The workspace root, expanded directories, selected file, and explorer layout
persist across restarts. Large files over 5 MB and binary/non-UTF-8 files are
rejected with an editor error. The explorer does not yet provide search, Git
status badges, or file create, delete, and rename actions. **Reveal** expands
the active editor's parent directories and selects its file when it is inside
the workspace root.

## Git Pane v0

Use **Git** after opening a workspace folder. The floating Git pane uses the
local Git CLI to show the repository root, current branch, and porcelain status
entries. Selecting a changed file loads its diff; **Open** or double-clicking
opens the working-tree file through the shared editor-opening path.

Git Pane v0 is read-only. It does not stage, commit, push, pull, switch branches,
resolve conflicts, or handle credentials. Explorer Git badges and agent review
are also not implemented.

## Agent Pane v0

Use **Agent** to open a local-first chat pane. It calls a configurable
OpenAI-compatible `/chat/completions` endpoint through the Rust backend, avoiding
browser CORS restrictions. The default configuration targets
`http://127.0.0.1:8000/v1`, model alias `gemma4-26b-a4b`, temperature `0.2`,
and 4096 output tokens.

Context chips explicitly control Active Editor, Open Editors, Git Status,
Selected Git Diff, Workspace, and Browser URL attachments. Editor content,
diffs, and workspace file lists are bounded and secret-looking values are
redacted.

Streaming responses are enabled by default. The **Stream** toggle is persisted
with the endpoint, model, temperature, and token settings. While a response is
active, assistant text appears incrementally and **Send** becomes **Stop**.
Stopping cancels the backend stream and retains any partial response. Disabling
the toggle uses the existing non-streaming request path as a fallback.

Streaming targets OpenAI-compatible SSE `data:` responses and a `[DONE]`
terminator. Local servers with different event formats may not work without an
adapter. Streaming requests have a 300-second limit; non-streaming requests keep
the 120-second timeout. Patch detection runs once after completion or
cancellation, not for every token. The model has no tool calls, cannot execute
commands itself, does not apply patches automatically, and cannot escalate to
Codex.

One compatible local server example is:

```bash
llama-server \
  -m /path/to/model.gguf \
  --host 127.0.0.1 \
  --port 8000 \
  --alias gemma4-26b-a4b
```

## Terminal Command Proposal v0

Assistant responses are scanned after completion for fenced `bash`, `sh`,
`shell`, `zsh`, `fish`, `powershell`, and `pwsh` blocks, plus explicitly marked
single-line `Command:` suggestions. Other code fences such as Rust, TypeScript,
Python, JSON, and diff are not treated as commands.

Each proposal is shown as an editable command card with Copy, terminal target,
Run, and Run in New Terminal actions. Nothing runs automatically. Run wraps the
approved text with Arc-owned start/end markers and writes it through the
existing PTY input path of a visible terminal pane; Arc does not create a
hidden command process.

A coarse classifier labels proposals low, medium, high, or blocked. Medium
commands require confirmation, high commands show a stronger destructive-state
warning, and blocked patterns such as `mkfs`, `dd if=`, download-to-shell pipes,
power commands, and fork bombs expose Copy only. This classifier is a UX safety
layer, not a complete shell security parser, and it does not restrict commands
the user types manually.

The **Terminal Output** context chip is disabled by default. When enabled, Arc
attaches up to 20k ANSI-stripped characters from the most recently focused
terminal. Runtime buffers retain at most 50k characters per terminal in memory
and are never stored in layout localStorage.

There is no autonomous command loop, automatic test execution, command retry,
tool-calling protocol, or Codex routing.

## Command Result Feedback v0

When a command proposal is sent to a visible terminal, Arc records an in-memory
run marker containing the command, terminal/session IDs, risk level, timestamp,
source proposal IDs, and the terminal output offset immediately before the PTY
write. A compact **Command result** card then appears below that proposal.

**Capture Output** refreshes output produced since the run marker. **Copy
Output** copies the sanitized capture, **Open Terminal** focuses the visible
target pane, and **Send Output to Agent** explicitly submits the command and
captured output as a new user message through the normal streaming or
non-streaming Agent path. Output is never submitted automatically.

Captured output is ANSI-stripped, redacted for likely tokens, passwords,
secrets, bearer credentials, API keys, and private-key blocks, and limited to
20k characters with a truncation marker. Terminal buffers and command run
records remain in memory only and are not written to layout localStorage.

## Command Completion / Exit Code v0

Commands launched from Agent proposal cards include unique plain-text start and
end markers in the same visible PTY input. Arc parses those markers from the
existing terminal output stream, including markers split across output chunks,
and updates the result card to pending, running, completed, or failed. Completed
runs show their exit code and elapsed duration.

POSIX shells use the command's `$?` value. PowerShell and pwsh use
`$LASTEXITCODE` on a best-effort basis. Manually typed commands are not wrapped
or tracked. Captured output excludes Arc markers and retains the existing ANSI
stripping, secret redaction, 20k feedback limit, and 50k in-memory terminal
buffer limit.

Explicit Agent feedback now includes status, exit code, and duration. The
opt-in Terminal Output context also includes metadata for the latest tracked
command in the active terminal. Arc still does not parse structured test
results, retry commands, start test/fix loops, run hidden processes, or route
work to Codex.

## Agent Task Card v0

Top-level Agent requests now create compact in-memory task cards. A task groups
its user and assistant messages with extracted patches, command proposals, and
visible-terminal command results. Command-result feedback stays in the
originating task, so the follow-up response remains next to the command and
output that prompted it.

Task status follows the latest meaningful manual action: patch or command
available, command running/completed/failed, patch applied, or rolled back.
Closing a task hides it from the Agent pane but only marks it `closed`; its
messages and artifact references remain in memory for the current app session.
Patch Preview, explicit apply/rollback approval, command risk checks, visible
PTY execution, and explicit output submission are unchanged.

Task cards are not persisted across restarts. There is no autonomous command
loop, automatic output submission, automatic patch application, hidden
execution, or Codex routing.

## Agent Patch Preview v0

Assistant responses are scanned for fenced `diff`/`patch` blocks and common raw
unified diffs. Detected patches produce compact cards with file, addition, and
deletion counts. **Preview** opens a read-only floating patch pane with file
sections, hunks, line numbers, and added/removed line styling.

**Copy Patch** copies the original unified diff. **Open Files** opens or focuses
existing affected files inside the current workspace, skipping new, deleted,
missing, absolute, and traversal paths. Patch text is held only in memory and
is not stored in layout persistence. Applying remains a separate, explicit
approval action; patch detection and preview alone never modify files.

## Patch Apply v0

Eligible existing-file patches can be applied from Patch Preview only after
frontend validation, backend `git apply --check --whitespace=nowarn`, and an
explicit confirmation dialog. The backend repeats path and patch-type checks
before both check and apply operations and passes patch text through stdin
without shell interpolation.

Apply is blocked for dirty affected editors, missing workspace roots, unsafe or
outside paths, new/deleted/renamed files, binary diffs, combined diffs, empty
patches, and files without hunks. Before confirmation, Arc snapshots the exact
UTF-8 contents and SHA-256 hashes of affected files. After success, clean
affected editor panes reload from disk and Git panes refresh status/diff.

## Patch Snapshot + Rollback v0

Successful Arc-applied patches expose **Rollback Patch** in their open Patch
Preview. Rollback is always user initiated and requires a second confirmation.
The backend restores snapshot contents only when the workspace root still
matches, every target still exists inside that root, and every current SHA-256
matches the recorded post-apply hash. Dirty affected editors block rollback.

Snapshots are JSON records under the platform application data directory at
`arc-workbench/patch-snapshots/`; they are not written into the workspace or
layout local storage. Snapshot creation rejects non-UTF-8 files, files over
5 MB, and snapshots over 20 MB. This mechanism supports only existing text-file
modifications and does not add new/delete/rename/binary patch support.

Patch apply and rollback do not run tests, stage or commit files, execute model
commands, or call Codex.

Current limitations: there is no full Patch History pane, rollback is unavailable
after an affected file changes post-apply, new/delete/rename rollback is
unsupported, and there is no Git commit/revert integration or automatic test
execution.

See [docs/architecture.md](docs/architecture.md) for architectural boundaries
and non-goals.

## Platform Notes

- PTY behavior is provided by `portable-pty` and can differ slightly by shell.
- A restored terminal pane starts a fresh shell. Process state is not persisted.
- Closing the app relies on operating-system process cleanup for any remaining
  child shells; closing an individual pane explicitly kills its PTY process.

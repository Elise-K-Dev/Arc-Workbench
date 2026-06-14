# Arc Workbench Architecture

## Pane-First Model

The workspace layout is the primary application model. Each internal window has
an explicit pane kind, position, size, z-index, and window state. The current
implementation renders terminal, browser, editor, file explorer, Git, and Agent
panes, while `PaneKind` reserves stable names for future pane families.

The frontend owns presentation layout and persists a serializable floating pane
array in local storage. Pointer-driven transforms provide bounded dragging and
`re-resizable` provides pane resizing. Restoring a layout restores pane
definitions, not running processes. A terminal component creates a new backend
PTY when mounted and kills that session when unmounted.

The Rust backend owns all local processes. `TerminalManager` maps opaque session
IDs to PTY masters, writers, and child processes. Tauri commands provide
create/write/resize/kill operations; output and exit notifications flow back as
window events.

## Current Pane Types

- `TerminalPane`: an independent local PTY session rendered with xterm.js
- `BrowserPane`: a localhost-only iframe surface presented as Local Preview
- `EditorPane`: a CodeMirror text buffer backed by explicit Rust read/write
  commands and native file dialogs
- `FileExplorerPane`: a persisted workspace-root tree that requests one
  directory level at a time from Rust
- `GitPane`: read-only branch, status, and per-file diff visibility backed by
  explicit Git CLI commands
- `AgentPane`: local OpenAI-compatible chat with user-selected context

The persisted pane kind remains `"browser"` for layout compatibility, but its
product role is Local Preview. A URL policy permits only `localhost`,
`*.localhost`, `127.0.0.1`, and `::1` over HTTP or HTTPS. Other URLs never reach
an iframe and render an explicit external-browser fallback. This treats CSP,
`X-Frame-Options`, and `frame-ancestors` failures as an expected browser
boundary rather than a loading bug.

Local Preview remains useful because local Vite, React, FastAPI, documentation,
and dashboard servers usually permit embedding and benefit from living beside
terminal and editor panes. Loading is observable and bounded by a short timeout
diagnostic instead of leaving a silent blank region.

General browsing requires a separate Native Browser concept. The current spike
is limited to frontend type stubs and architecture boundaries; no child webview
is created. A future implementation may use a Tauri child webview or
`WebviewWindow`, but must address Linux X11/Wayland positioning, WebKitGTK
multiwebview layout behavior, focus transfer, z-index, pane bounds, teardown,
and IPC capability isolation. Chromium/CEF embedding, browser tabs, history,
bookmarks, extensions, and iframe-policy bypasses are out of scope.

Editor pane layout metadata and necessary unsaved content are stored in local
storage. Clean buffers with a file path omit their content and reload from disk
when restored. The editor does not receive arbitrary filesystem access; file
operations cross the Tauri command boundary with explicit paths selected by the
user.

The global workspace state currently contains an optional `rootPath`, stored
separately from pane layout. Opening a folder updates that root and creates or
focuses the explorer pane. Explorer expansion state and selection remain pane
payload data so they restore with the floating layout.

Directory loading is lazy. The Rust `read_dir` command returns direct children
only, sorts directories before files, and omits known heavy generated
directories such as `.git`, `node_modules`, `target`, and virtual environments.
Permission and missing-path errors stay local to the explorer UI.

Git Pane v0 invokes `git` with explicit process arguments and a controlled
working directory; it never constructs shell command strings. Status parsing
uses porcelain v1 output and keeps index/worktree state separate. Diffs are
loaded on selection and are not persisted. The Git CLI keeps the first version
small and aligned with users' installed Git behavior; libgit2 is deferred until
the product needs deeper repository operations or a stable cross-platform
credential layer.

Agent Pane v0 is local-model first. The frontend context builder receives a
read-only pane snapshot and workspace root, then collects only enabled sections:
active editor, editor paths, Git status, selected diff, bounded workspace file
paths, and browser URLs. Content limits and basic secret redaction are applied
before the request crosses the Tauri boundary.

The Rust agent client owns HTTP transport, timeout handling, optional bearer
authentication, and OpenAI-compatible response parsing. Non-streaming requests
remain available as a fallback with a 120-second timeout. Streaming requests
set `stream: true`, use a 300-second timeout, and parse SSE from a byte buffer so
JSON lines and UTF-8 text can span network chunk boundaries.

`agent_chat_stream` registers a generated stream ID in backend state and starts
an asynchronous HTTP task. Parsed content is delivered through
`agent_stream_delta`; completion, errors, and cancellation use dedicated Tauri
events. The frontend installs listeners before starting the request, creates an
empty assistant message immediately, and appends only matching stream-ID
deltas. Settings that affect the request are disabled for its lifetime.

`agent_cancel_stream` removes the active entry, sets its cancellation flag, and
emits cancellation immediately. The HTTP connect/read loop selects against that
flag, dropping the request promptly instead of waiting for the total timeout.
All terminal states remove backend stream state and frontend event listeners.
Settings persist separately from chat history so endpoint configuration and the
streaming toggle survive while large conversations do not enter layout storage.

Agent responses pass through a frontend patch extraction pipeline. Fenced
`diff`/`patch` blocks and common raw unified diff markers are isolated, then a
small parser converts file headers, hunks, context lines, additions, removals,
and line numbers into typed patch objects. Parsing errors retain raw text for
review instead of discarding the model output. During streaming, extraction runs
only after completion or cancellation with non-empty partial content; it is
never invoked for individual deltas.

Tool calls and autonomous command execution remain deferred because they require
separate workspace trust, argument review, approval, cancellation, and
output-limiting boundaries. Streaming text does not grant the model any file or
process tools.

Terminal Command Proposal v0 is a frontend post-processing path alongside patch
extraction. Only explicitly supported shell fences and marked `Command:` lines
become proposal objects. A coarse classifier re-evaluates the editable command
text before every run: low commands can proceed, medium and high commands
require escalating confirmations, and blocked patterns expose Copy only.

Proposal cards receive visible terminal pane IDs from workspace state. Running
a command resolves that pane's registered PTY session, wraps the approved text
with unique start/end markers, and calls the existing `terminal_write` command.
Run in New Terminal creates a normal floating terminal pane, waits for its
public PTY session registration, then uses the same write path. There is no
hidden child process or separate command backend.

Terminal panes publish session IDs and recent output to an in-memory frontend
runtime registry. Output is capped at 50k characters per pane and is not
persisted. Pane focus raises z-index, so the highest focused terminal is both the
default proposal target and the source for the opt-in Terminal Output context
chip. Agent context strips ANSI sequences, limits output to 20k characters, and
marks truncation.

Future command workflow may add structured result capture, explicit output
attachment back to the Agent, an approval-based test/fix loop, and optional
Codex fallback. None of those loops run automatically in v0.

Command Result Feedback v0 extends the same in-memory terminal runtime registry
with command run markers. A marker is created immediately before an approved
PTY write and records the absolute output offset, command/risk metadata,
terminal and session IDs, timestamp, and source Agent proposal IDs. Absolute
offsets are retained separately from the 50k rolling string buffer so capture
can identify when older output was already discarded.

The result card reads output from the marker offset to the current buffer end.
It strips terminal ANSI control sequences, applies the shared Agent secret
redactor, limits the result to the most recent 20k characters, and marks output
that was truncated by either buffer retention or feedback limits. Capture and
command history are not persisted because terminal output can contain secrets
and has no durable-session semantics in v0.

The feedback loop remains user driven:

```txt
proposal card -> approved terminal_write -> run marker -> manual capture
-> explicit Send Output to Agent -> normal Agent request
```

Arc does not send output when a command starts or when terminal bytes arrive.
For Agent-launched commands only, the terminal runtime scans its rolling output
for line-delimited Arc markers. Start markers move the run's capture boundary
past the marker. End markers provide the exit code, completion timestamp, and
final capture boundary. Parsing the rolling buffer makes marker recognition
robust to output chunk boundaries without changing the Rust PTY backend.

POSIX wrappers capture `$?`; PowerShell wrappers use `$LASTEXITCODE` with a zero
fallback when it is unset. Commands that terminate or replace the shell before
the wrapper finishes may remain running/unknown. Capture Output remains a
point-in-time, explicit user action, removes marker text, and preserves the
existing redaction and size limits. Future work may add structured test result
parsing, failed-command classification, an explicitly approved test/fix loop,
and a separately approved Codex fallback worker.

Agent Task Card v0 adds an in-memory coordination model above chat messages and
artifacts. Each top-level user request creates a task ID and title. User and
assistant messages carry that ID; extracted patch IDs and command proposal IDs
are registered on the same task. Command run source metadata inherits the task
ID, allowing terminal completion events and explicit result feedback to update
and continue the originating task.

The task store is a small external frontend store with stable snapshots and a
`useSyncExternalStore` subscription. This lets terminal output parsing and
Patch Preview apply/rollback callbacks publish status changes even though those
events occur outside the Agent pane's React event tree. Status is intentionally
simple and latest-event based rather than a formal workflow state machine.

Closing a task sets `closed` and filters it from the open task list. It does not
delete messages, patches, proposals, or run references. Task state and chat
content remain process memory only because v0 has no retention, migration,
privacy review, or durable terminal-session semantics.

Future task work may add persisted history, generated summaries, explicit
command/test/fix loops, per-task Codex fallback approval, and task export. None
of those capabilities are active in v0.

Patch cards store raw and parsed content in an in-memory patch store. A
`PatchPreviewPane` persists no patch text and is excluded from layout storage;
it renders file sections and hunks by an opaque patch ID. A restart therefore
invalidates open previews by design. Opening affected files accepts only
relative paths under the current workspace and reuses the normal editor-open
path.

## Future Pane Types

- `SshPane`: explicitly configured remote terminal sessions
- `ProblemsPane`: diagnostics produced by future language tooling
- `LogsPane`: application and task output

Each pane should own a narrow lifecycle and communicate through typed services.
Long-running resources must be created and released with pane lifecycle events.

A future LSP bridge should live behind typed Tauri commands and events rather
than inside `EditorPane`. It will translate editor document changes, language
selection, diagnostics, and completion requests without coupling CodeMirror to
a specific language server.

Future context collection may add selected editor text and explicit file
attachments. Editor contents remain controlled by context toggles, and any
external escalation must remain user-controlled.

Future explorer work includes file and folder creation, rename, delete, context
menus, Git status badges, workspace search, and configurable ignored-file
rules. File mutation is deferred until Git visibility exists so users can see
the repository impact of those operations before broader write actions are
introduced.

Future Git work includes stage/unstage all, commits, branch switching, explorer
badges, a structured diff editor, agent-assisted diff review, and an explicit
patch workflow. Push, pull, credentials, and destructive history operations
require separate lifecycle and approval designs.

A future agent tool loop may propose read operations, command cards, and unified
patches, but execution and patch application require explicit preview and user
approval. Codex can later serve as an optional heavier worker after local-model
routing, cost boundaries, context disclosure, and approval UX are defined.
Escalation is deferred because v0 must first establish predictable local
context handling and error behavior. File modifications are not automatic
because model output is untrusted until reviewed as a concrete patch.

Broader patch application remains deferred. New/delete/rename support, partial
hunks, and temporary worktrees require stronger conflict semantics.
Previewing model text remains separate from approving a filesystem write.

Patch Apply v0 introduces the first explicit write boundary. The frontend
rejects unsupported patch metadata, unsafe relative paths, missing workspace
roots, and dirty affected editors. The Rust backend independently canonicalizes
the workspace and existing target files, validates every raw patch header and
hunk, then pipes patch text to `git apply --check --whitespace=nowarn` using
explicit process arguments. The apply command repeats validation and the check
before running `git apply --whitespace=nowarn`.

No apply starts without a user confirmation showing files and line counts.
After success, clean affected editor buffers reload from disk and a refresh
token causes Git panes to reload status and their selected diff. Dirty buffers
are never saved or overwritten automatically.

Patch Snapshot + Rollback v0 stores durable JSON records in the Tauri
application data directory, outside both workspace repositories and pane layout
storage. Snapshot creation records exact pre-apply UTF-8 content and SHA-256
values for the validated existing-file path set. Before applying, the backend
rechecks that the snapshot path list matches the patch and disk content still
matches every pre-apply hash.

File-content snapshots are used instead of `git apply -R` because a workspace
may already contain unstaged changes and reverse hunk matching cannot guarantee
restoration of the exact pre-apply bytes. Snapshot creation rejects any file
over 5 MB and any record whose captured content exceeds 20 MB.

After apply, the backend records post-apply SHA-256 values and marks the record
available. Explicit rollback canonicalizes the same workspace root and targets,
requires current content to match every post-apply hash, then restores exact
pre-apply content and marks the record rolled back. Missing, malformed,
oversized, cross-root, changed-file, and dirty-editor cases are blocked rather
than repaired automatically.

Automatic test execution is deferred because it requires a separate,
approval-based command model, timeout and cancellation behavior, and clear
workspace trust boundaries. Codex escalation remains deferred for the same
context disclosure and approval reasons documented for Agent v0.

Future rollback work may add a Patch History pane, rollback diff preview,
retention policies, temporary worktree strategies, and Git-based revert
options. New/delete/rename, binary, combined, and partial-hunk application
remain unsupported until their rollback and conflict semantics are defined.

## Future Agent Routing

A local LLM is intended to be the default worker and routing layer. Expensive
or complex tasks may be proposed for Codex escalation, but escalation requires
user approval. Agent changes should be represented as reviewable patches before
application. Destructive actions must never run automatically, and neither a
local agent nor Codex receives implicit approval to apply a patch.

## Non-Goals

The initial product is not a VS Code clone and does not implement extension
compatibility, a marketplace, LSP support, Git write operations, SSH panes,
cloud model routing, Codex CLI integration, automatic or unsupported patch
workflows, cloud login, debugging, or notebooks.

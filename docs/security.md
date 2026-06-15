# Security Model

- No hidden shell execution: approved commands are written only to visible PTY
  terminal panes.
- No browser session hijacking or access to ChatGPT, Codex, cookie, OAuth, or
  session tokens.
- Read-only tools are workspace-bounded, reject traversal and symlink escapes,
  skip binary and oversized files, bound output, and redact likely secrets.
- Unknown workspaces are untrusted. Trust can relax read and inspection
  confirmations but never enables silent modifying or dangerous execution.
- Modifying commands require confirmation; dangerous commands require typed
  `RUN`.
- Patch apply and rollback each require explicit approval. Apply retains
  snapshot validation and rollback safety.
- The optional Agent tool loop is read-only, disabled by default, bounded,
  stoppable, and unable to invoke shell, patch, rollback, or file-write paths.
- Arc does not silently edit files, rerun failed commands, or automatically
  apply or roll back patches.

The user remains final authority over execution and workspace mutation.

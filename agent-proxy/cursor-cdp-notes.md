# Cursor IDE CDP Notes

Captured on 2026-05-25 from CDP port **9227** (Cursor **3.5.33**, Electron 39 / Chrome 142, elevated Administrator instance).

## Launcher and CDP

- **Canonical launcher:** pinned taskbar `Cursor.lnk` with `--remote-debugging-port=9227 --remote-debugging-address=127.0.0.1` and LNK flag `0x20` (Run as administrator). Do not replace with a `.bat`.
- **Verify:** `http://127.0.0.1:9227/json/list`
- **CDP is not blocked** (unlike Claude Desktop MSIX guard).
- **Elevation:** Cursor runs elevated; the standalone proxy runs non-elevated. CDP HTTP + `Runtime.evaluate` worked in discovery with no permission errors. `spawnCursor()` from a non-elevated proxy may fail silently if used as fallback — prefer the user’s elevated shortcut.
- **Proxy env:** `CDP_PORTS` includes `9227` alongside `9223,9225,9226`.

## Targets (saved: `cursor-cdp-targets.json`)

| Type | Count | Notes |
|------|-------|-------|
| `page` | 2 | One per open workspace window |
| `worker` | 2 | Empty URL/title — ignore for agent integration |

### Workbench pages observed

| Title | Target ID (prefix) |
|-------|-------------------|
| `remote-agent-chat (Workspace) - Cursor [Administrator]` | `D947691B…` |
| `GWA Censured X BotsHub - Cursor [Administrator]` | `2A1EAEB0…` |
| `cursor-test - Cursor [Administrator]` (throwaway probes) | `99D49855…` / session `a3a0c862…` |

Both pages share:

```
vscode-file://vscode-app/.../workbench/workbench.html
```

There are **no** separate CDP targets for Chat vs Composer vs Agent panes.

## Eval model: `evalInPage` (not `evalInFrame`)

| Check | Result |
|-------|--------|
| `document.querySelectorAll('iframe')` | `[]` on both workspaces |
| `Page.getFrameTree()` | Single top-level frame only |
| Webview host elements | `0` |
| Chat/agent UI location | Embedded in workbench page DOM |

**Integration choice:** mirror `codex-desktop` — use `evalInPage` for all `cursor` selector paths:

```js
const evalFn = agentType === 'codex-desktop' || agentType === 'cursor' ? evalInPage : evalInFrame;
```

Antigravity extension iframe strategies do **not** apply.

## Session model (one proxy session per Cursor window)

- Match CDP `page` targets where URL contains `workbench.html` and title contains `Cursor`.
- **Do not** split Chat / Composer / Agent into separate CDP sessions — they are not separate targets.
- Cursor 3.5.x uses a unified **Agents** UX: the active agent transcript lives in the **editor group** (`has-composer-editor`), not the empty auxiliary bar.
- **Two windows ⇒ two sessions** (e.g. `remote-agent-chat` and `GWA Censured X BotsHub`). Thread switching must be scoped per window/target ID.
- When no agent chat is open (GWA idle probe), auxiliary bar shows welcome copy (`New Agent`, `Plan, Build…`) and **no** `.conversations` root — session should still register but message reads may be empty until an agent is opened.

## Workbench layout (relevant parts)

| Part ID | Role |
|---------|------|
| `workbench.parts.editor` | Hosts `editor-group-container has-composer-editor active` — **primary agent transcript + composer** |
| `workbench.parts.auxiliarybar` | Often `empty`; may show tab label / preview text, not the live agent stream |
| `workbench.parts.sidebar` | File explorer + agent sidebar area |
| `workbench.parts.panel` | Bottom panel (terminal when opened) — was empty (`nopanel`) during probes |

Body classes when agent UI active: `sidebarvisible unifiedsidebarhidden chat-editor-group-enabled`.

## Transcript DOM

| Item | Selector / attribute | Notes |
|------|---------------------|-------|
| Transcript root | `.conversations` | Present only when an agent session has messages |
| Message bubble | `.composer-rendered-message` | Class also includes `composer-message-blur`, `hide-if-empty` |
| Role attribute | `data-message-role` | **`human`** = user, **`ai`** = assistant (sample: 1 human, 15 ai) |
| Messages container wrapper | `.composer-messages-container` > `.scrollable-div-container` | Holds scrollable transcript |
| Thinking blocks | `.ui-collapsible-header` with text like `Thought…`, `Explored N files` | Tool/thinking UI, not plain markdown bubbles |
| Tool calls | `.ui-tool-call-card`, `.ui-shell-tool-call`, `.ui-edit-tool-call` | File edits + shell commands inline in transcript |
| Read-only prompt display | `.aislash-editor-input-readonly` | Shows pasted prompt text (e.g. user query header), separate from live input |

**Not observed:** ProseMirror composer (unlike Codex Desktop). Input uses **AISlash** editor classes.

## Composer input and send (verified 2026-05-25 Phase 2)

| Item | Selector | Notes |
|------|----------|-------|
| Live input | TipTap `.ui-prompt-input-editor__input[contenteditable="true"]` (Agents window) or `.aislash-editor-input` (classic workbench) | Skip readonly mirrors (`.ui-prompt-input-tiptap-readonly`, `.aislash-editor-input-readonly`) |
| **Do not** use `.composer-bar.editor` for broad queries | That variant wraps the **entire** transcript | Scope to `.agent-prompt-input-root` / `.ui-prompt-input` / footer input |
| Clear before send | `selectAll` + `delete` + remove children + `textContent=''` | Do **not** assign `innerHTML` (TrustedHTML error in Cursor 3.5) |
| Model picker | `button.ui-model-picker__trigger` (or toolbar model text) | Present near TipTap submit |
| Send | TipTap `.ui-prompt-input-submit-button` when not Stop; else CDP Enter | Verified `submit_button` / `cdp_enter` |
| Interrupt | Submit button aria `Stop generation`, else Escape | Shell stop remains separate (`Stop command`) |
| Shell tool stop | `button[aria-label="Stop command"].ui-shell-tool-call__glass-stop` | Stops in-flight **shell command** only |

## Streaming / idle detection (verified Phase 2)

| Signal | Selector / behavior |
|--------|---------------------|
| Agent generating (scoped) | Last `.composer-rendered-message[data-message-role="ai"]` with `[class*="streaming"]`, `[aria-busy="true"]`, or `.codicon-loading` | Used by `detectCursorThinking` — **not** workbench-wide `[class*="thinking"]` |
| Composer stop | `button` in `.composer-bar` / footer with `aria-label` containing `stop` (≠ `Stop command`) | Rarely visible; prefer CDP Escape fallback |
| Shell stop | `button[aria-label="Stop command"]` in `.ui-shell-tool-call` | Only stop control seen during streaming probe |
| Global stop generation | **Not in DOM** during Phase 2 probes | `interruptCursor` clicks composer stop if present, else **CDP Escape** |

**Idle false-positive fix:** Workbench chrome shows 34× `[class*="thinking"]` while idle — ignore outside `.conversations` / last AI bubble.

## Agent sidebar / threads (updated 2026-07-09)

Cursor 3.5+ exposes agents on multiple surfaces. `readCursorAgentList` is still
**read-only** (no poll-time clicks) and merges:

| Source | Selector | Notes |
|--------|----------|-------|
| Glass Agents window | `.glass-sidebar-agent-menu-btn` | Standalone "Cursor Agents" page |
| Unified workbench sidebar | `.agent-sidebar-cell` / `.agent-sidebar-cell-text` | Classic IDE Agents sidebar |
| Editor tabs | `.tabs-container .tab .label-name` | Open agent transcripts as tabs |
| Title tab fallback | `.chat-title-tab-title` | At least the active agent when lists are empty |

Active agent is inferred from `.chat-title-tab-title` or selected editor tabs.
IDs remain stable `agent-{slug}` (age suffixes like `19d` stripped).

## Mode controls

| Surface | Finding |
|---------|---------|
| GWA welcome auxiliary text | Shows `Agent` + model `Auto` in empty state |
| Menu “Edit” | Menubar item — **not** Ask/Edit/Agent mode toggle |
| Dedicated Ask/Edit/Agent/Composer toggle | **Not found** in page-level DOM during probes |

Cursor may encode mode in model picker or agent type rather than Antigravity-style mode tabs. `_buildCapabilities().set_mode` may need settings-storage fallback or `false` with comment until confirmed.

## Permission dialogs (Composer + Agent view — same CDP page)

Agent view (`.agent-sidebar` + editor-group transcript) and regular Composer/Chat use the **same** `.conversations` + `.composer-bar` DOM. There is no separate approval surface per view.

### Detection strategies (`CURSOR_PERMISSION_EXPR`, 2026-05-25)

| # | Surface | When it fires |
|---|---------|----------------|
| 1 | Modal `[role="dialog"]` / `.pretty-dialog` | Visible dialog with **both** Allow and Deny/Skip buttons (excludes model picker / palette) |
| 2 | Inline text in permission bubble | Last AI bubble (or prior AI bubble if user typed `run it` while card still pending) matches `Pending command`, `Reply with approval`, `Not in allowlist`, `Run command?`, etc. |
| 3 | Pending shell card | `.ui-shell-tool-call--pending` inside the permission bubble with visible **Allow** + **Skip** (or Run + Skip) buttons |

**Do not scan transcript history.** Resolved shell cards use `ui-shell-tool-call--expandable` and may still show Run/retry controls — only `--pending` cards count.

### Pending vs resolved shell card (throwaway probe 2026-05-25)

| State | className | Buttons | Text signals |
|-------|-----------|---------|--------------|
| **Pending** | `ui-shell-tool-call ui-shell-tool-call--pending` (+ nested `.ui-tool-call-card.ui-shell-tool-call__card`) | `Allow`, `Skip`, `Run`, `Allowlist` (link) | `Not in allowlist: <cmd>`, `Reason:` |
| **Resolved** | `ui-shell-tool-call ui-shell-tool-call--expandable` | `Shell command options`, output preview | `Exit code: 0`, command output block |

`:last-of-type` on `[data-message-role="ai"]` is **wrong** for permission reads — use the last `.composer-rendered-message` (or walk back one AI bubble when the user already sent `run it`).

### Respond order (`respondCursorPermissionDialog`)

1. Click Allow/Deny/Skip/Run in visible modal  
2. Click matching button on `.ui-shell-tool-call--pending`  
3. Composer text fallback: `run it` / `no, do not run the command`

### Auto-approve

`auto_approve_permissions_toggle` (workspace preference `cursor|<path>` in `session-store.json`). Proxy `_selectAutoApproveChoice` prefers Allow/Run on pending shell cards; does not click “Always allow” / Allowlist.

**Probes:** `probe-cursor-permission-surface.js` (pending + resolved DOM dump), `probe-cursor-stability.js` (idle false-positive + ID stability).

## File changes / diff

- Live pending edits show a compact bar (`1 File Undo Keep Review`) near the composer — **not** the whole `.composer-bar.editor` (that includes transcript text).
- `readCursorFileChanges` / `respondCursorFileChange` climb from Keep to that short bar; Keep→accept, Undo→reject.
- Transcript `.ui-edit-tool-call` cards remain a fallback for older layouts.
- Relay must forward `change_id` + `action` on `file_change_response`.

## Terminal

- `writeCursorTerminalInput` opens the panel via `ensureCursorTerminalVisible` (user-triggered only — **never** from poll).
- After write on throwaway (2026-05-25): `.xterm-rows` child count **0**; `.xterm-screen` may contain only injected **CSS** (not command output).
- `readCursorTerminalOutput` reads `.xterm-rows` text and scoped `.integrated-terminal` screens; filters CSS-like content.
- **`terminal_output` capability is `false` for cursor** in `_buildCapabilities()` — xterm canvas has no accessible buffer via CDP.
- `terminal_input` remains **true** (CDP can focus `.xterm-helper-textarea` and inject keys).
- Probe: `probe-cursor-terminal-read.js` (throwaway only).

## Rules / automation

- Status bar: `Continue YOLO` (Continue extension), not Cursor rules.
- No `.cursorrules` surface found in DOM text/aria during probes.
- `AGENTS.md` visible in explorer only.

## Rate limits

- Body scan: **no** `rate limit` / `fast request` / `quota` strings in active session.

## Cross-elevation CDP

Non-elevated Node CDP client successfully:

- Listed targets
- Connected to elevated Cursor pages
- Ran `Runtime.evaluate` across all probe scripts

No CDP eval permission errors observed.

## Probe scripts

| Script | Purpose |
|--------|---------|
| `probe-cursor-panels.js` | Targets, iframes, workbench parts, aria hints |
| `probe-cursor-dom.js` | Broad DOM survey (pass workspace title substring) |
| `probe-cursor-streaming.js` | Time-series streaming signals |
| `probe-cursor-targeted.js` | Conversations, composer-bar, tool cards, auxiliary bar |
| `probe-cursor-send.js` | Message roles + send candidates |
| `probe-cursor-icons.js` | Icon/button search near input |
| `probe-cursor-live-send.js` | Mutating send test (throwaway via `cursor-probe-guard.js`) |
| `probe-cursor-streaming-live.js` | Send + time-series AI bubble growth |
| `probe-cursor-terminal-read.js` | Terminal write + read diagnostic |
| `probe-cursor-permission-surface.js` | Shell approval pending vs resolved DOM (throwaway) |
| `probe-cursor-stability.js` | Idle permission false-positive + agent/message stability |

All mutating probes require throwaway session `a3a0c862…` (`cursor-probe-guard.js`).

Optional captured stdout: `probe-cursor-*-output.txt` (local diagnostics, not required for integration).

## Capability parity — `_buildCapabilities('cursor')` vs probes (throwaway 2026-05-25)

| Capability | Advertised | Verified | Notes |
|------------|------------|----------|-------|
| `interrupt` | yes | **yes** | `cdp_escape`; composer stop rare |
| `set_model` | yes | **yes** | `setCursorModel` + footer trigger |
| `set_mode` | **no** | n/a | No mode toggle in DOM |
| `permission_dialogs` | yes | **yes** | Chat approval + optional inline buttons; `tools/cursor-permission-e2e.js` |
| `auto_approve_permissions_toggle` | yes | **yes** | Per-workspace preference; `tools/cursor-auto-approve-e2e.js` |
| `new_chat` / `new_thread` | yes | **yes** | `newCursorAgent` click |
| `chat_list` / `thread_list` / `switch_*` | yes | **yes** | Glass / `.agent-sidebar-cell` / editor tabs; stable `agent-{slug}` IDs |
| Structured `content_blocks` | yes | **yes** | Thinking / tool_call / file_changes from pair-scoped cards (2026-07-09) |
| `terminal_input` | yes | **yes** | Write ok |
| `terminal_output` | **no** | n/a | xterm canvas — no DOM/buffer read; capability gated in proxy |
| `file_changes` | yes | **yes** | Read + Undo/Keep via `file_change_response`; `tools/cursor-filechange-e2e.js` |
| `send_attachment` | **no** | n/a | Codex-only in proxy |
| `switch_workspace` | **no** | n/a | Desktop codex/claude only |
| `native_window` | yes | **yes** | Per-window CDP target |
| `open_panel` | **no** | n/a | |
| `branch_*` / `file_browser` | yes | **default** | VS Code chrome |
| `skill_list` / `automation_view` | **no** | n/a | |

## Validation commands (throwaway `a3a0c862…`, CDP 9227)

```bash
python proxy_restart_lock.py --agent "cursor-validate"
node tools/cursor-phase2-smoke.js
node tools/cursor-web-e2e.js
node tools/cursor-permission-e2e.js
node tools/cursor-filechange-e2e.js
node tools/cursor-agent-switch-e2e.js
node tools/cursor-auto-approve-e2e.js
node tools/cursor-auto-approve-restore-test.js
node tools/cursor-soak.js --minutes 10
node tools/cursor-capabilities-check.js
```

See `CURSOR_SUPPORT_TEST_RESULTS.md` for full matrix.

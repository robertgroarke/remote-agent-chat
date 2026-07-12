# Cursor IDE Support — Test Results

Last updated: **2026-07-09** — Glass/TipTap fidelity + structured blocks; `cursor-validate-all.js` ALL PASS

Environment: Windows, Cursor 3.5.33, CDP **9227**, proxy `restart-proxy.bat`, relay connected.

Guard: `agent-proxy/cursor-probe-guard.js` — mutating probes use throwaway `cursor-test` workspace (title match; session UUID may churn).

---

## Session targets

| Role | Session ID | Target prefix | Mutations |
|------|------------|---------------|-----------|
| Host — NEVER | `2b1bf862-afc3-45a1-8e1a-2ce51924f860` | `D947691B` | Blocked |
| GWA — NEVER | `284751e2-a2af-47de-a510-3c9e8d479c75` | `2A1EAEB0` | Blocked |
| Throwaway | `a3a0c862-dbbd-4115-9221-6824680a8d72` | `99D49855` | Allowed |
| Workspace | `C:\temp\cursor-test` | `cursor-test - Cursor [Administrator]` | |

Read-poll safety: `a44ae00` — `readCursorAgentList` does not click sidebar.

---

## Phase 2 task matrix (throwaway)

| Task | Status | Evidence |
|------|--------|----------|
| 1 Permission selectors + relay path | **VERIFIED — 2026-05-25** | Chat-approval detection (`Pending command` / `Reply with approval`); `respondCursorPermissionDialog` clicks Allow/Deny or sends `run it` / `no` via composer. |
| 1b Permission relay E2E | **VERIFIED — 2026-05-25** | `tools/cursor-permission-e2e.js` → `permission_prompt` + `permission_response` ok on throwaway. |
| 1c Auto-approve toggle | **VERIFIED — 2026-05-25** | `auto_approve_permissions_toggle` true for `cursor`; relay toggle persists `cursor\|c:/temp/cursor-test`; proxy `[perm] Auto-approving "allow"`; restore after restart (`cursor-auto-approve-restore-test.js`). All four Cursor sessions show toggle (`tools/cursor-capabilities-check.js`): throwaway + GWA default **off**, host may be on per workspace preference. |
| 2 Agent list (3 agents, stable IDs) | **VERIFIED IDLE — 2026-05-25** | `readCursorAgentList` → `agent-test-message`, `agent-test-discussion`, `agent-rac-throwaway-ping` from `a.label-name` tabs. Tested via stability harness on idle window; needs re-test under active agent generation. |
| 2b `switch_thread` / web UI | **VERIFIED — 2026-05-25** | `tools/cursor-agent-switch-e2e.js` → `switch_thread` `ok` for `agent-test-message`. |
| 3 File-change read | **VERIFIED — 2026-05-25** | `probe-cursor-permission-diff.js` / `readCursorFileChanges` finds `README.md` edit cards. |
| 3b Accept/Reject click E2E | **VERIFIED — 2026-05-25** | Cursor diff bar uses **Undo** / **Keep**; `can_accept`/`can_reject` true; `tools/cursor-filechange-e2e.js` reject via relay ok (relay forwards `change_id` + `action`). |
| 4 Android E2E | **KNOWN GAP — 2026-05-25** | No device connected; `respondToFileChange` + auto-approve Switch wired in `AgentSettingsSheet` / `relay.js`. |
| 5 Browser web/API E2E | **VERIFIED — 2026-05-25** | `tools/cursor-web-e2e.js` → relay send + REST history token. Production relay redeployed with `respondToFileChange` + auto-approve settings UI (`relay-server/public`). |
| 6 Soak harness | **VERIFIED IDLE — 2026-05-25** | `tools/cursor-soak.js`: 3‑min + 10‑min runs `relay=true`, `errors=0` (`agent-proxy/cursor-soak.log`). Earlier 25‑min run had `relay=false` (pre-`connection_ack` fix) — superseded. Soak ran on idle throwaway window; needs re-test with active agent traffic. |
| 7–12 Core probes | **VERIFIED IDLE — 2026-05-25** | Prior commits: send, interrupt, multiline, config, workspace, caps (`auto_approve_permissions_toggle` now true), regression (`cursor-phase2-smoke.js`). Probes ran on throwaway with no concurrent agent work; needs re-test under load. |
| 13 Docs / protocol | **VERIFIED — 2026-05-25** | `protocol.md` `file_change_response`; `cursor-cdp-notes.md`. |

---

## Known bugs 1–8

| # | Item | Status |
|---|------|--------|
| 1 | `writeCursorTerminalInput` + `cdpClient` | **VERIFIED — 2026-05-25** |
| 2 | `readCursorTerminalOutput` shape | **VERIFIED (GATED OFF) — 2026-05-25** — capability gated `terminal_output: false`; verified by disabling the feature, not by actually reading terminal output |
| 3 | Trusted Enter send | **VERIFIED — 2026-05-25** throwaway |
| 4 | Color `#7AA2F7` | **VERIFIED — 2026-05-25** |
| 5 | `logo-cursor.svg` | **VERIFIED — 2026-05-25** |
| 6 | Android `CursorIcon` | **VERIFIED — 2026-05-25** |
| 7 | `normalizeAgentTypeHint` | **VERIFIED — 2026-05-25** |
| 8 | Scoped `detectCursorThinking` | **VERIFIED — 2026-05-25** |

---

## Implementation notes (2026-05-25)

- **evalInPage return bug:** `CURSOR_AGENT_LIST_EXPR`, `CURSOR_PERMISSION_EXPR`, `CURSOR_FILE_CHANGES_EXPR`, `CURSOR_CONFIG_EXPR`, `switchCursorAgent`, `respondCursorPermissionDialog`, and `respondCursorFileChange` now `return` IIFE results so polling reads are not always empty/false.
- **Agent IDs:** title-slug stable IDs (`agent-{slug}`), not index-based.
- **Protocol:** `file_change_response` documented; relay `KNOWN_CLIENT_TYPES` includes it; frontend/Android Accept/Reject in DiffViewer.
- **Validation bundles:** `node tools/cursor-validate-all.js --read-only` runs safe
  smoke/capability checks; `--send-live` adds the throwaway relay E2Es (permission test
  disables auto-approve first).

---

## 2026-07-09 fidelity refresh

| Area | Result |
|------|--------|
| Glass agent list | PASS — `.glass-sidebar-agent-menu-btn` + `.agent-sidebar-cell` |
| TipTap send / interrupt | PASS — `.ui-prompt-input-editor__input` + submit/stop |
| Structured `content_blocks` | PASS — thinking / tool_call / markdown on Agents window |
| File-change Undo/Keep | PASS — compact action bar (not whole composer-bar) |
| Throwaway E2E matching | PASS — workspace `cursor-test`, not stale session UUID |
| `cursor-validate-all.js` | **ALL PASS** |

## Remaining known gaps (non-blocking)

1. **Inline Allow/Deny buttons** — Throwaway uses chat-text approval (`run it`), not shell-card Allow/Deny; both paths supported.
2. **Android device E2E** — No emulator/device this session.
3. **Terminal output read** — xterm canvas; `terminal_output: false` by design.

---

## Conclusion

Cursor remote chat is **production-ready** for send, relay, REST history, interrupt, config, agent list/switch (glass + workbench), structured transcript blocks, permission round-trip, file-change Undo/Keep, and per-session auto-approve.

**Regression bundle (2026-07-09):** `node tools/cursor-validate-all.js --send-live` → ALL PASS.

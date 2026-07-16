# Harness Fidelity Ceilings

This document defines the deliberate visual boundary between native-harness fidelity and
Remote Agent Chat's shared product surface. It is a drift-review contract, not permission
to omit transcript information. Native content, order, semantic type, state, and default
expansion remain fidelity requirements even where the surrounding pixels are unified.

## Global contract

Remote Agent Chat must preserve the native transcript's recognizable text treatment,
semantic hierarchy, tool/result distinction, message order, and expanded state. The
per-harness theme may approximate colors where native tokens are inaccessible, but it must
keep typography, density, code treatment, and semantic tones recognizably harness-specific.

The following are intentionally shared or adaptive instead of pixel-cloned:

- The sidebar, workspace grouping, session cards, composer, settings, connection state,
  and notification controls use one Remote Agent Chat product language.
- Desktop transcripts reflow at mobile widths. Mobile usability and zero horizontal page
  overflow take precedence over reproducing a fixed native desktop geometry.
- Icons may use accessible equivalents. Proprietary icon artwork, transient animations,
  shimmer timing, caret blink, and subpixel antialiasing are not golden-image contracts.
- Native host chrome that is not part of the conversation—title bars, editor tabs, menus,
  activity rails, task explorers, and terminal-window frames—is not reproduced.
- A native surface that is unavailable, signed out, onboarding-gated, or unsupported is
  shown as a truthful capability/status gate. The web UI must never invent a visual clone
  for a surface that has not been observed.

The standing automated baseline remains desktop plus 390-pixel crops for every canonical
semantic block. Native side-by-side evidence is required before freezing or materially
changing a harness-specific theme. Reviewers should reject a change that makes two
harnesses visually interchangeable even if the generic component tests pass.

## Per-harness ceilings

| Harness | agentType | Must remain recognizably native | Intentionally not pixel-cloned | Reason / review boundary |
|---|---|---|---|---|
| Claude Code extension | `claude` | Compact system typography, restrained user treatment, Claude thinking/tool hierarchy, Markdown and code density | VS Code workbench, center-editor tabs, extension launcher, host menus, transient streaming animation | The transcript is the remote product surface; cloning the changing editor host adds maintenance cost without improving conversation recognition. |
| Codex extension | `codex` | Segoe WPC-sized transcript text, Codex task/notice/queue hierarchy, tool and file cards, code palette | VS Code workbench, right-pane container chrome, account task explorer, onboarding and speed-dialog pixels | Semantic task state and Codex text treatment carry recognition; account and host chrome are outside the selected conversation. |
| Antigravity Chat | `antigravity_panel` | Theme remains provisional until a real Antigravity IDE 9228 transcript is probed | No Gemini- or Claude-model styling is inferred, and no absent pane is fabricated | Model choice does not define the surface. Freeze the ceiling only after the native right-hand pane is available. |
| Antigravity v2 Agent Manager | `antigravity-v2` | Italic/dim thinking, dense combined execution disclosures, code and artifact treatment, Agent Manager transcript rhythm | Separate result/terminal cards, Manager canvas, outer agent cards, navigation shell, window chrome, exact progress animation | Current retained native steps keep call metadata, file/result content, command output, and exit state inside one execution disclosure; no separate result or terminal transcript surface is invented. Conversation and lifecycle recognition matter remotely, while the wider orchestration workspace does not belong inside chat. |
| Codex Desktop | `codex-desktop` | System-font transcript, Codex reasoning/tool/file hierarchy, notices, task-state language, code density | Electron title bar, navigation rail, task explorer, Plugins/Sites/Pull requests screens, window geometry | Remote transcript fidelity should survive desktop app restyles without cloning unrelated application navigation. |
| Cursor IDE | `cursor` | Compact Cursor transcript, applied-change cards, thinking/tool hierarchy, native message ordering and virtualization semantics | Cursor editor shell, Review/Commit workspace, xterm canvas, activity rail, exact virtualized DOM geometry | Cursor's semantic cards and density identify it; editor and terminal canvases are separate products and are not reliably serializable. |
| Claude CLI | `claude_cli` | Terminal-inspired monospace transcript, Claude reasoning/tool/result distinction, ordered JSONL content | Terminal window frame, prompt cursor, spinner frames, full ANSI edge cases, broken upstream 2.1.207 resume UI | A stable readable TUI treatment has higher recognition value than emulator-specific chrome; upstream-unavailable visuals stay gated. |
| Codex CLI | `codex_cli` | Cascadia-style terminal text, reasoning/tool/result/plan/notice hierarchy, status tone, ordered rollout content | Terminal frame, cursor/blink, rotating tips, native-only `/usage` chrome, exact ANSI animation | Parsed semantic content is durable; ephemeral TUI decorations vary by terminal and Codex version. |
| Cursor CLI | `cursor_cli` | Terminal-inspired monospace transcript, thinking/tool/result hierarchy, and unboxed errors with an amber warning line plus ordinary remediation text | Terminal frame, prompt cursor, exact ANSI animation, headless approval dialog that the CLI does not expose | The remote view mirrors the available transcript and truthfully gates approval UI instead of simulating it. |
| Gemini Code Assist extension | `gemini` | No theme ceiling is frozen while the disposable profile is signed out | No authenticated transcript, model response, or permission surface is fabricated from login/onboarding chrome | Authentication is the observation gate. Probe and add native side-by-side evidence before promoting visual claims. |
| Continue extension | `continue` | Current model/mode identity, compact agent transcript, real tool/terminal lifecycle, permission state | VS Code shell, Continue settings/onboarding, terminal webview pixels, unobserved native history browser | The transcript and tool lifecycle are the portable surface; host/settings chrome changes independently and native history remains gated. |
| Roo Code extension | `roo_code` | No task-transcript ceiling is frozen while the disposable profile remains on Get Started | No provider response, task lifecycle, or permission visuals are inferred from onboarding | Provider/onboarding completion is the observation gate. Existing welcome text is status evidence, not a production transcript theme. |

## Drift review procedure

1. Re-run the native theme probe for reachable CDP harnesses and capture the same message,
   code, and semantic block surfaces used by the web fixture.
2. Compare the native and web transcript side by side at desktop and 390-pixel width.
3. Update theme tokens and visual goldens only when the native change affects recognition,
   readability, semantic hierarchy, or default expansion—not for host-shell churn.
4. Record unavailable surfaces as gates. Never replace missing native evidence with a
   screenshot from a different harness or from the same pane using a different product.
5. Run `node tools/fidelity-ceiling-smoke.js` and `node tools/visual-regression.js`.

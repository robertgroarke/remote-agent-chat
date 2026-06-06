# Antigravity v2 CDP Notes

Captured on 2026-05-22 from CDP port 9226.

## Target

- Port: `9226`
- Target type: top-level `page`
- Target title during probe: `Fixing Catalyst Events API`
- Target URL: `https://127.0.0.1:55953/c/4fe356d9-7107-4fab-90c2-ee9d0c1fd534?section=294ec273-7f79-42b4-80b7-321ced995b93`
- Stable active conversation id: path UUID `4fe356d9-7107-4fab-90c2-ee9d0c1fd534`
- Section id: query param `section=294ec273-7f79-42b4-80b7-321ced995b93`
- App architecture: standalone React/Vite Agent Manager page. Use page-level CDP evaluation (`evalInPage`), not VS Code iframe traversal.

## Conversation List

- Conversation pills are exposed as spans matching `[data-testid^="convo-pill-"]`.
- The pill `data-testid` suffix is the conversation UUID.
- The clickable target is an ancestor with `role="button"`.
- The active conversation can be derived reliably from the route UUID. Visual active state was observed on the ancestor button with `bg-sidebar-secondary`; the pill itself did not expose `aria-current` or `aria-selected`.
- Project headers are exposed as `[data-project-card][role="button"][aria-expanded]` and appeared above the group. Observed groups included `GWA Censured X Bot Hub`, `Market Tracker Project`, and `Remote Agent Chat`.
- The active conversation pill belonged to the `Market Tracker Project` group.

## Transcript DOM

- Main transcript root: `[data-testid="conversation-view"]`
- Assistant turns: `[role="article"][aria-label="Agent response"]`
- User turns: `[data-testid="user-input-step"]`
- The probed active conversation contained one completed assistant turn and no visible user turns.
- Assistant turn content included:
  - collapsible work/thinking header: `Worked for 5m`
  - markdown heading text
  - regular paragraphs and lists
  - one GitHub-style table
  - artifact/action chips: `Verify Fix`, `Task`, `Walkthrough`, `Review`
  - file-change summary text: `2 files changed`, `+52`, `-5`
  - footer controls: timestamp, `Copy`, `Good response`, `Bad response`

## Composer And Send

- Composer selector: `[role="combobox"][aria-label="Message input"][data-lexical-editor]`
- Empty composer button selector: `[data-testid="send-button"]`, `aria-label="Record voice memo"`
- After real Lexical insertion, the same button changes to `aria-label="Send message"`.
- `document.execCommand('insertText')` returned true but did not update visible Lexical state on its own.
- Working insertion method:
  1. Focus the Lexical editor.
  2. Clear via the exposed `editor.__lexicalEditor.update(() => root.splice(0, root.__size, []))`.
  3. Dispatch a `ClipboardEvent('paste')` with `text/plain` content on the Lexical editor.
  4. Wait briefly and verify `innerText` contains the exact text.
  5. Click `[data-testid="send-button"][aria-label="Send message"]`.
- Runtime-only clearing via DOM selection and `execCommand('delete')` did not work reliably. Lexical root splice did.

## Config And Controls

- Model selector: `button[aria-label^="Select model, current:"]`
- Observed current model: `Claude Opus 4.6 (Thinking)`
- Opening the model selector produced a dialog with visible options:
  - `Gemini 3.5 Flash (High)`
  - `Gemini 3.5 Flash (Medium)`
  - `Gemini 3.1 Pro (High)`
  - `Gemini 3.1 Pro (Low)`
  - `Claude Sonnet 4.6 (Thinking)`
  - `Claude Opus 4.6 (Thinking)`
  - `GPT-OSS 120B (Medium)`
- Other visible top-level controls included sidebar toggle, back/forward, display options, new conversation, auxiliary pane toggle, add context, worktree indicator, copy, response feedback, and review/artifact chips.

## Dynamic States

- Streaming assistant text, active tool-call execution, terminal/shell output blocks, permission prompts, and error/retry states were not present in the sampled completed conversation.
- Stop/cancel was not visible because the sampled conversation was idle.
- The live E2E runner must create a harmless prompt and validate:
  - user turn appears in the native DOM
  - send result is delivered through the relay path
  - assistant text streams into WebUI history before final stabilization
  - final assistant response contains the requested token
  - WebUI replay preserves `content_blocks`
- States that cannot be produced safely in the active account should be represented by fixture transcripts and marked as fixture-covered in verification output.

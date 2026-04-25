@echo off
REM ============================================================
REM  Claude Desktop CDP — BLOCKED BY ANTHROPIC
REM ============================================================
REM  Claude Desktop (MSIX) intentionally exits when launched
REM  with --remote-debugging-port unless a valid CLAUDE_CDP_AUTH
REM  env var (Ed25519-signed token from Anthropic's server) is
REM  present. Without that token the app calls process.exit(1).
REM
REM  Source: app.asar contains:
REM    kV(process.argv) ^&^& !Hg() ^&^& process.exit(1)
REM  where kV checks for --remote-debugging-port and Hg() validates
REM  the signed CLAUDE_CDP_AUTH token.
REM
REM  CDP access to Claude Desktop is not available to third parties.
REM  Use the Claude Code extension inside Antigravity (port 9223)
REM  for remote chat access instead.
REM ============================================================
echo [claude-desktop] CDP access is blocked by Anthropic auth token requirement.
echo [claude-desktop] Use Claude Code in Antigravity (port 9223) instead.

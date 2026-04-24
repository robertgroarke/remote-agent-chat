# Claude Desktop — CDP Access Blocked by Anthropic

**Date investigated:** 2026-03-20
**Conclusion:** CDP remote debugging is intentionally gated behind a signed auth token. Third-party access is not possible without Anthropic's private key.

---

## What Was Tried

| Method | Result |
|---|---|
| `Start-Process 'claude.exe' --remote-debugging-port=9224` | Access Denied — MSIX WindowsApps exe can't be launched directly from a subprocess |
| `ShellExecute` via Win32 API | Returns error code 5 (Access Denied) |
| `IApplicationActivationManager::ActivateApplication` with debug args | App launches (returns PID), then immediately exits |
| `argv.json` with `{"remote-debugging-port": 9224}` | Ignored — Claude Desktop is not a VS Code app and does not read argv.json |
| Explorer `shell:AppsFolder\Claude_pzs8sxrjxfjjc!Claude` (no args) | App runs normally, but no CDP port exposed |
| Windows Scheduled Task launching the exe | MSIX activation fails — exe can't be run directly from schtasks |

---

## Root Cause: Intentional Auth Guard in app.asar

Decompiling `app.asar` (at `C:\Program Files\WindowsApps\Claude_1.1.6679.0_x64__pzs8sxrjxfjjc\app\resources\app.asar`) reveals a startup guard on the main Electron process:

```javascript
kV(process.argv) && !Hg() && process.exit(1);
```

Where:

```javascript
// kV: returns true if --remote-debugging-port or --remote-debugging-pipe is in argv
function kV(t) {
  return t.some(e =>
    e.startsWith("--remote-debugging-port") ||
    e.startsWith("--remote-debugging-pipe")
  );
}

// Hg: validates CLAUDE_CDP_AUTH env var using an Ed25519 public key
function Hg() {
  const token    = process.env.CLAUDE_CDP_AUTH;
  const userData = process.env.CLAUDE_USER_DATA_DIR;
  if (!token || !userData) return false;

  // Token format: "<timestamp>.<base64-userData-path>.<ed25519-signature>"
  const [timestamp, encodedPath, signature] = token.split(".");
  if (Buffer.from(encodedPath, "base64").toString() !== userData) return false;

  const age = Date.now() - parseInt(timestamp, 10);
  if (age < 0 || age > 300_000) return false;  // token expires in 5 minutes

  const pubKey = crypto.createPublicKey(`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEApH/vaEiLV0sNY/eS+Ct/IMbMqw8i/vC/cNC84BAbBq8=
-----END PUBLIC KEY-----`);

  return crypto.verify(null, Buffer.from(`${timestamp}.${encodedPath}`), pubKey, Buffer.from(signature, "base64"));
}
```

**Logic:** If `--remote-debugging-port` is present in argv **and** `Hg()` returns false → `process.exit(1)`.

This is why `IApplicationActivationManager` with debug args launches a process (PID returned) that immediately exits — the auth check fires and kills it before the window appears.

---

## The Auth Token

`CLAUDE_CDP_AUTH` must be a valid Ed25519 signature over `"<timestamp>.<base64(userDataDir)>"` using Anthropic's **private key**. The public key embedded in the app is:

```
MCowBQYDK2VwAyEApH/vaEiLV0sNY/eS+Ct/IMbMqw8i/vC/cNC84BAbBq8=
```

There is no way to generate a valid token without the private key, which only Anthropic holds. The token also expires after 5 minutes, so it cannot be extracted from a legitimate session and reused.

The same check exists in the renderer process (a second copy of the validation function at a different offset in the asar).

---

## Why There Is No Workaround

- **Patching app.asar**: Would require removing the `process.exit(1)` call and re-signing the package. MSIX signature verification would reject a modified package.
- **Environment variable injection**: `CLAUDE_CDP_AUTH` requires a valid signature — cannot be forged.
- **UI Automation (Windows UIA)**: Theoretically possible but fragile; not pursued since the Antigravity Claude Code extension already provides full CDP access.
- **Electron `--remote-debugging-pipe`**: Also blocked by `kV()`.
- **`--inspect` / Node.js inspector**: Unrelated to Chromium remote debugging; does not expose the renderer.

---

## Practical Impact

Claude Desktop as a session source is **not available**. The proxy's `CDP_PORTS` env var should use `9223,9225` (drop 9224).

For Claude access, use the **Claude Code extension inside Antigravity IDE** (port 9223), which has no such restriction and is the primary supported path.

---

## Codex Desktop (port 9225) — Works Fine

For reference: Codex Desktop (`OpenAI.Codex_2p2nqsd0c76g0`) has **no CDP auth guard** in its app.asar. It can be launched with debug args via `IApplicationActivationManager` and exposes a standard CDP `page` target. See `launch-codex-desktop-cdp.bat`.

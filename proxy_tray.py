"""
proxy_tray.py — System tray icon for the Agent Proxy.

Reads proxy.log to show live proxy status in the Windows system tray.
Right-click for a menu with quick actions.

Requires: pip install pystray pillow
Or:       pip install -r requirements-tray.txt
"""

import os
import re
import subprocess
import sys
import threading
import webbrowser
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

import pystray
from PIL import Image, ImageDraw, ImageFont

# ─── Paths ────────────────────────────────────────────────────────────────────

ROOT       = Path(__file__).parent
LOG_FILE   = ROOT / "proxy.log"
ERR_FILE   = ROOT / "proxy-err.log"
LOCK_PY    = ROOT / "proxy_restart_lock.py"
PYTHON     = sys.executable
WEB_UI_URL = os.environ.get("PUBLIC_URL", "http://localhost:3500")

# ─── Log parsing ──────────────────────────────────────────────────────────────

STATUS_RE  = re.compile(
    r'\[status\] (\S+) \((\w+)\): (\d+) msgs, relay (up|down), status=(\w+)'
)
DUP_RE     = re.compile(r'WARNING: \d+ session\(s\) already registered under a different proxy')
RELAY_RE   = re.compile(r'\[relay\] (?:Handshake OK|Socket open|Closed|Error)')
STALE_SECS = 90   # if log not modified in this many seconds, proxy is probably dead


def _tail(path: Path, n_bytes: int = 12_000) -> list[str]:
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - n_bytes))
            return f.read().decode('utf-8', errors='replace').splitlines()
    except (FileNotFoundError, IOError):
        return []


def parse_proxy_state() -> dict:
    """Return dict: status, sessions (Counter by type), relay, duplicate_warning."""
    lines = _tail(LOG_FILE)

    # Check log freshness
    try:
        mtime = LOG_FILE.stat().st_mtime
        age   = datetime.now().timestamp() - mtime
        log_fresh = age < STALE_SECS
    except FileNotFoundError:
        return {'status': 'offline', 'sessions': Counter(), 'relay': 'down',
                'duplicate_warning': False, 'log_age': 9999}

    if not log_fresh:
        return {'status': 'offline', 'sessions': Counter(), 'relay': 'down',
                'duplicate_warning': False, 'log_age': int(age)}

    # Parse most recent [status] block (the last full set of status lines)
    sessions  = {}   # sid → agent_type
    relay     = 'unknown'
    dup_warn  = False

    for line in reversed(lines):
        m = STATUS_RE.search(line)
        if m:
            sid, atype, _msgs, relay_state, _status = m.groups()
            if sid not in sessions:
                sessions[sid] = atype
            relay = relay_state

        if DUP_RE.search(line):
            dup_warn = True

    type_counts = Counter(sessions.values())

    if dup_warn:
        status = 'warning'
    elif relay == 'up' and type_counts:
        status = 'live'
    elif relay == 'up':
        status = 'starting'
    else:
        status = 'offline'

    return {
        'status':            status,
        'sessions':          type_counts,
        'relay':             relay,
        'duplicate_warning': dup_warn,
        'log_age':           int(age),
    }

# ─── Icon generation ──────────────────────────────────────────────────────────

# Status → (fill_color, ring_color)
ICON_PALETTE = {
    'live':     ('#1a1a2e', '#4ade80'),   # dark bg, bright green ring
    'starting': ('#1a1a2e', '#facc15'),   # yellow
    'warning':  ('#1a1a2e', '#fb923c'),   # orange (duplicate proxy)
    'offline':  ('#1a1a2e', '#f87171'),   # red
    'unknown':  ('#1a1a2e', '#94a3b8'),   # grey
    'restarting': ('#1a1a2e', '#60a5fa'), # blue
}

AGENT_INITIALS = {'claude': 'C', 'gemini': 'G', 'codex': 'X', 'antigravity': 'A'}
AGENT_COLORS   = {
    'claude':      '#d97706',
    'gemini':      '#2563eb',
    'codex':       '#16a34a',
    'antigravity': '#7c3aed',
}


def _make_icon(status: str, session_count: int = 0) -> Image.Image:
    size = 64
    img  = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    bg, ring = ICON_PALETTE.get(status, ICON_PALETTE['unknown'])

    # Outer ring
    draw.ellipse([2, 2, size - 2, size - 2], fill=ring)
    # Inner filled disc (dark bg)
    pad = 6
    draw.ellipse([pad, pad, size - pad, size - pad], fill=bg)

    # Session count badge (white text centred)
    if session_count > 0:
        label = str(session_count)
        try:
            font = ImageFont.truetype("arial.ttf", 24)
        except Exception:
            font = ImageFont.load_default()
        bbox   = draw.textbbox((0, 0), label, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        tx = (size - tw) // 2 - bbox[0]
        ty = (size - th) // 2 - bbox[1]
        draw.text((tx, ty), label, fill='#ffffff', font=font)
    else:
        # Show a small "no signal" dash
        cx, cy = size // 2, size // 2
        draw.line([cx - 8, cy, cx + 8, cy], fill='#6b7280', width=3)

    return img

# ─── Tray application ─────────────────────────────────────────────────────────

class ProxyTray:
    def __init__(self):
        self._state      = {'status': 'unknown', 'sessions': Counter(), 'relay': 'unknown',
                            'duplicate_warning': False, 'log_age': 0}
        self._restarting = False
        self._icon       = None
        self._stop_evt   = threading.Event()

    # ── Status helpers ───────────────────────────────────────────────────────

    def _status_line(self) -> str:
        s = self._state
        if self._restarting:
            return "⟳  Restarting proxy…"
        st = s['status']
        if st == 'live':
            counts = ', '.join(
                f"{v}× {k.title()}" for k, v in sorted(s['sessions'].items())
            )
            return f"●  Relay live — {sum(s['sessions'].values())} sessions  ({counts})"
        if st == 'starting':
            return "●  Relay connected — discovering sessions…"
        if st == 'warning':
            return "⚠  Duplicate proxy detected — session conflict"
        if st == 'offline':
            age = s.get('log_age', 0)
            return f"✗  Proxy offline  (log {age}s old)"
        return "?  Status unknown"

    def _tooltip(self) -> str:
        return f"Agent Proxy\n{self._status_line()}"

    # ── Icon / menu builders ─────────────────────────────────────────────────

    def _current_icon(self) -> Image.Image:
        if self._restarting:
            status = 'restarting'
        else:
            status = self._state['status']
        count = sum(self._state['sessions'].values())
        return _make_icon(status, count)

    def _build_menu(self):
        status_text = self._status_line()

        def open_web(_):
            webbrowser.open(WEB_UI_URL)

        def restart_proxy(_):
            if self._restarting:
                return
            threading.Thread(target=self._do_restart, daemon=True).start()

        def view_log(_):
            subprocess.Popen(['notepad.exe', str(LOG_FILE)])

        def view_err_log(_):
            subprocess.Popen(['notepad.exe', str(ERR_FILE)])

        def on_exit(_):
            self._stop_evt.set()
            self._icon.stop()

        return pystray.Menu(
            pystray.MenuItem(status_text, None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open Web UI",     open_web),
            pystray.MenuItem(
                "Restart Proxy",
                restart_proxy,
                enabled=not self._restarting,
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("View proxy.log",     view_log),
            pystray.MenuItem("View proxy-err.log", view_err_log),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit tray (proxy keeps running)", on_exit),
        )

    # ── Restart logic ────────────────────────────────────────────────────────

    def _do_restart(self):
        self._restarting = True
        self._refresh_icon()
        try:
            subprocess.run(
                [PYTHON, str(LOCK_PY), '--agent', 'proxy-tray'],
                timeout=60,
                creationflags=_NO_WINDOW,
            )
        except Exception as e:
            print(f"[tray] Restart error: {e}")
        finally:
            self._restarting = False
            self._refresh_icon()

    # ── Update loop ──────────────────────────────────────────────────────────

    def _refresh_icon(self):
        if self._icon:
            self._icon.icon  = self._current_icon()
            self._icon.title = self._tooltip()
            self._icon.menu  = self._build_menu()

    def _poll_loop(self):
        while not self._stop_evt.wait(timeout=3):
            new_state = parse_proxy_state()
            if new_state != self._state:
                self._state = new_state
                self._refresh_icon()

    # ── Entry point ──────────────────────────────────────────────────────────

    def run(self):
        self._state = parse_proxy_state()

        self._icon = pystray.Icon(
            name  = "agent-proxy",
            icon  = self._current_icon(),
            title = self._tooltip(),
            menu  = self._build_menu(),
        )

        threading.Thread(target=self._poll_loop, daemon=True).start()
        self._icon.run()


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    ProxyTray().run()

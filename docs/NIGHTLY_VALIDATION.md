# Nightly Harness Validation

The Windows task `Remote Agent Chat Nightly Validation` runs every
`tools/*-validate-all.js` entry point once per night. Every invocation receives
`--read-only`; it may inspect installed applications, transcripts, configuration,
and relay state, but it must not send prompts, create or switch chats, change app
settings, restart a service, or open a visible window.

## Install or refresh the task

From a background PowerShell process in the repository root:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\install-nightly-validation-task.ps1
```

The task launches `nightly-validation-hidden.vbs` through `wscript.exe`, with no
console window. It runs daily at 02:30 local time, starts when available after a
missed trigger, ignores overlapping starts, and has a three-hour execution limit.

## Ledger and alerts

Each completed validator immediately appends one JSON line to
`data/nightly-validation-ledger.jsonl`. A line includes the run ID, harness,
pass/fail/timeout status, installed app version, validator path, duration, exit
code, completion time, and bounded output tail. The runtime ledger and lock file
are gitignored.

Every read-only validator has a hard **60-second total runtime budget** enforced
by the orchestrator. `--timeout-ms` may lower that budget for diagnostics but
cannot raise it. Ledger rows record `runtime_budget_ms` and `budget_exhausted`,
so a hung parser or live-read stage is a visible timeout rather than an
unbounded nightly task.

The runner also authenticates to the relay and updates the latest status for that
harness. A failed or timed-out latest result appears as a persistent warning in
the web UI and Android session list. A later passing result automatically clears
that harness from the warning. Each publication gets three bounded attempts; an
exhausted publication is appended as a separate failure record and makes the task
fail even though the local validation record remains durable.

## Manual read-only run

```powershell
node .\tools\nightly-validation-ledger.js
```

For an offline diagnostic that writes a separate ledger but does not publish:

```powershell
node .\tools\nightly-validation-ledger.js --no-publish --only cursor --ledger .\evidence\cursor-nightly.jsonl
```

Never add a mutating test to a validator's read-only stage set. Put it behind an
explicit live/mutating mode and keep the nightly runner on `--read-only`.

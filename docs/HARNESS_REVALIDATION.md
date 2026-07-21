# Harness update revalidation program

Remote Agent Chat treats every harness update as a write-safety boundary. The hidden app-update
sentinel continuously inventories installed versions. A changed version is persisted as `pending`
before any validator runs, so the proxy immediately removes write capabilities while transcript
and inventory reads remain available.

## Coverage contract

`config/harness-revalidation-program.json` is the authoritative matrix. Every tracked or supported
harness must have all four cells populated:

1. an installed-version fixture under `tests/fixtures/harness-revalidation/`, or an explicit
   not-installed/unavailable gate;
2. a read-only tier-1 `*-validate-all.js` command, or an explicit product gate;
3. a guarded tier-2 command for an owned disposable target, or an explicit no-safe-target gate;
4. `capability_gate: true`, which binds the matrix row to proxy fail-closing.

The sentinel refuses to validate an updated version when its fixture still names the old version.
That failure is intentional: it produces the expected-versus-observed fixture diff and keeps writes
closed until the repair is understood and captured.

## Cadence

- Continuous: the hidden App Update Drift Sentinel watches stable install parents and polls the full
  inventory every 60 seconds.
- Nightly: the existing validation task runs every tier-1 entry point in read-only mode.
- Weekly: `Remote Agent Chat Harness Revalidation Weekly` invokes
  `tools/harness-revalidation-weekly.js` daily at 03:15. The runner executes only rows whose
  staggered weekly due timestamp has elapsed, so missed logons recover without a burst.
- Update-triggered: after fixture coverage and tier-1 pass for a changed version, tier-2 runs
  immediately when `RAC_TIER2_OWNED_TARGETS_JSON` contains an owned disposable target. Without one,
  the row records a truthful gate and changed-version write controls remain closed.

The program state records `last_validated_version`, `last_tier2_pass`, `last_tier2_status`,
`next_tier1_at`, and `next_tier2_at` per harness. Web and Android expose that state from the
Validation health view.

## Guarded tier-2 targets

The scheduled environment may provide a JSON object keyed by harness:

```text
RAC_TIER2_OWNED_TARGETS_JSON={"cursor":{"session_id":"owned-disposable-id"}}
```

The runner exports only the selected value as `RAC_TIER2_OWNED_SESSION` to the harness command. A
protected or ordinary user session must never appear in this mapping. Commands launch headless with
`windowsHide: true`; UI-dependent targets remain explicitly gated until a disposable profile exists.

## Repair loop

Each drift failure writes the failing stage, fixture diff, and this playbook to the ledger and the
maturity backlog:

1. Probe an owned disposable surface without focusing a protected session.
2. Record the expected versus observed selector, store, or event contract.
3. Repair the adapter and refresh the installed-version fixture.
4. Rerun tier-1 and the guarded tier-2 definition.
5. Restore write capabilities only after both required tiers pass.
6. Record `validated <harness> <old> -> <new>` in the ledger.

Useful deterministic checks:

```text
node tools/app-update-drift-sentinel-smoke.js
node tools/harness-revalidation-program-smoke.js
node tools/harness-revalidation-weekly-smoke.js
```

The program smoke rehearses detect -> fail-close -> fixture repair -> tier-1 -> tier-2 -> restore
against isolated files. It never opens a native harness or browser.

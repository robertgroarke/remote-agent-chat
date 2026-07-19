# Native-grounded visual golden approvals

The pixel suite protects rendering stability, but a web-derived golden is not evidence that
the rendering resembles its native harness. The machine-readable schema-v5 ledger at
`evidence/harness-maturity/native-golden-approvals.json` closes that loophole incrementally.
Every approval names and hashes a real native screenshot, records its observed theme and
surface inventory, and hashes the exact web goldens reviewed against it.

Approval is deliberately narrower than pixel equality. Native windows and Remote Agent Chat
are different products, so review checks recognizable typography, color, density, hierarchy,
radius/border treatment, and semantic placement. Approved mobile goldens represent a faithful
reflow of the same visual language; they do not imply that a desktop harness has a native
mobile layout. Theme approvals never cross-infer: a dark source cannot approve light goldens
or vice versa.

Each per-harness semantic family must be exactly one of:

- `approved`: visibly present in a hashed, same-theme native source and manually reviewed;
- `pending`: supported or plausible, but not yet grounded by a matching native source; or
- `natively inapplicable`: impossible to ground on the supported native surface, with a
  substantive reason and existing evidence paths.

An inapplicable classification is not an approval and never removes the case from the source
pixel suite. Current exclusions are limited to dark-only CLI light palettes and event families
proven absent by retained native taxonomies. The validator rejects unknown, duplicate, missing,
weakly justified, or missing-evidence exclusions. It also rejects any exclusion contradicted by
a block, live-status, layout, or composer surface recorded in a hashed native source. Native
sources, exclusion evidence, and the golden root must be repository-relative and resolve inside
the repository; absolute and traversal paths fail closed. A hashed source must inventory at
least one known surface, may only use live-status/layout/composer categories supported for its
harness, and cannot duplicate another source path within that harness.

| Harness | Hashed native sources | Native-approved surfaces | Approved cases | Genuine pending cases | Natively inapplicable cases |
|---------|-----------------------|--------------------------|---------------:|----------------------:|----------------------------:|
| Claude Code | 5 dark + 5 light screenshots | 9 dark / 9 light blocks + both-theme layout/composer | 44 | 16 | 0 |
| Codex extension | 8 dark + 4 light screenshots | 7 dark / 4 light blocks + both-theme current status/layout/composer + dark goal | 36 | 52 | 0 |
| Codex Desktop | 5 hidden light screenshots | 9 blocks + 3 live statuses + light layout/composer | 28 | 60 | 0 |
| Cursor IDE | 4 dark + 2 light screenshots | 8 dark / 3 light blocks + both-theme layout/composer | 30 | 30 | 0 |
| Continue | 1 dark + 1 light screenshot | both-theme markdown | 4 | 48 | 0 |
| Antigravity v2 | 3 dark screenshots + 22-conversation retained taxonomy | 6 blocks | 12 | 36 | 4 |
| Claude CLI | 6 dark TUI screenshots | 9 blocks | 18 | 4 | 30 |
| Codex CLI | 2 dark TUI screenshots | 5 blocks + dark layout/composer | 14 | 28 | 46 |
| Cursor CLI | 4 dark TUI screenshots | 7 blocks | 14 | 0 | 38 |
| **Per-harness total** | **50** | | **200** | **274** | **118** |

<!-- native-golden-totals approved=200 pending=274 inapplicable=118 shared=4 total=596 -->

Those 592 per-harness cases plus four shared sidebar source cases form the complete 596-case
desktop/mobile, dark/light visual matrix. All 596 source pixel comparisons currently pass.
The native ledger does not close WS4: the 274 genuinely pending cases still require matching
native references. They comprise 54 dark / 52 light block families, 19 dark / 10 light
live-status families, one dark layout family, and one dark composer family; every family has
desktop and mobile cases.

Run the fail-closed gates with:

```powershell
node tools/native-golden-exclusion-contract-smoke.js
node tools/native-golden-approval-validate-all.js --read-only
node tools/visual-regression-validate-all.js --read-only
```

Any source screenshot or approved golden change invalidates its stored SHA-256 and fails the
nightly ledger until a fresh native-versus-golden review updates the approval intentionally.
The focused negative contract separately proves that observed native surfaces cannot be hidden
inside the inapplicable category. The validator also computes the aggregate classification and
requires the machine-readable totals marker above to match, so this guide cannot silently drift
from the ledger again.

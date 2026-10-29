# v0.13.2-rinspace.22 release scope

Managed Rinspace projects now persist their canonical project route after the
workspace is resolved and materialized. Reloading the editor therefore reopens
the same managed project instead of losing it from the workspace. The managed
route is cleared only when the user explicitly exits that workspace, opens a
local project, logs out, or follows a different share target.

The Agent panel no longer shows speculative billing copy or empty technical
usage rows such as zero input/output tokens and an unavailable merit cap.
Confirmed charges and actionable task status remain visible. This is a display
change only; provider receipts, confirmed wallet entries, immutable task
bindings, and audit records are unchanged.

The exact Cline embed package, dependency lock, external assets and reviewed
TeX Live runtime are unchanged. Standalone/local mode keeps its existing
editing, compilation and Git behavior and does not acquire a managed Agent
path.

## Migration from v0.13.2-rinspace.21

- Verify the immutable archive, manifest, notices, SPDX SBOM, provenance and
  complete Corresponding Source before consumption.
- Replace the complete `/editor/` static tree atomically. Keep the reviewed
  TeX Live runtime unchanged; do not mix chunks between releases.
- Preserve local drafts, Git synchronization records, task bindings, provider
  receipts and wallet history. Existing managed project URLs remain valid.
- Product activation still requires fixed browser, business, sidecar and
  database inputs plus private integration acceptance. This tag alone is not
  deployment.

## Rollback

1. Disable new Agent runs through the product policy if required.
2. Restore the exact `.21` editor artifact and its matching private product
   lock; do not infer the active fallback from the version sequence.
3. Preserve drafts, repository history, confirmed provider receipts and wallet
   records. Do not replay an uncertain operation.
4. Recheck managed-project reload, ordinary editing, compilation, manual Git,
   and account/local modes.

## Verification boundary

Regression coverage exercises canonical managed-route persistence, explicit
route clearing, project reload, host close behavior, and the reduced Agent
usage presentation. Existing task recovery, billing, Git synchronization and
panel checks remain required. Public checks and built-artifact browser
verification must pass for the exact source. Real-account/private integration
and production acceptance remain separate gates.

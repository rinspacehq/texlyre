# v0.13.2-rinspace.21 release scope

New managed Agent tasks use the project's latest durable Git synchronization
base instead of the workspace's original import commit. After a verified Pull
or Push, starting another task does not require reopening the editor. Existing
runs keep their immutable bindings and billing records.

The binding reader checks the active workspace, managed provider, repository,
branch and object format. Missing, foreign or inconsistent synchronization
state is rejected before task creation. It does not adopt the latest remote
HEAD without synchronization, discard local drafts or unpushed commits, replay
a Push, or relax the product server's current-remote binding check.

The browser fixture now checks the requested base against its actual repository
HEAD for every task, including the task created after its approved Push. The
unchanged v20 features include numbered reads, conflict checks, explicit tool
failure feedback, per-Push approval and confirmed billing display.

The exact Cline embed package, dependency lock, external assets and reviewed
TeX Live runtime are unchanged. Standalone/local mode has no Agent path and
retains its existing editing, compilation and Git behavior.

## Migration from v0.13.2-rinspace.20

- Verify the immutable archive, manifest, notices, SPDX SBOM, provenance and
  complete Corresponding Source before consumption.
- Replace the complete `/editor/` static tree atomically. Keep the reviewed
  TeX Live runtime unchanged; do not mix chunks between releases.
- Preserve browser drafts and durable Git synchronization records. If a prior
  Push has an uncertain result, verify its remote commit and use ordinary Pull
  to reconcile before creating another task. Never automatically resend it.
- Product activation still requires fixed browser/business/sidecar/database
  inputs and private integration acceptance. This tag alone is not deployment.

## Rollback

1. Disable new Agent runs through the product policy if required.
2. Restore the exact `.20` editor artifact and its matching private product lock.
   If the product selected an older live fallback, use that separately recorded
   immutable baseline; do not infer what is deployed from this version sequence.
3. Preserve drafts, repository history, confirmed provider receipts and wallet
   records. Reconcile uncertain operations rather than replaying them.
4. Recheck ordinary editing, compilation, manual Git and account/local modes.

## Verification boundary

The regression exercises successive task creation with changed synchronized
commits, refusal of foreign or missing bindings, cancellation, and an unchanged
import context. Existing task recovery and panel checks remain required.
Public checks and built-artifact browser verification must pass for the exact
source. Real-account/private integration and production acceptance are separate.

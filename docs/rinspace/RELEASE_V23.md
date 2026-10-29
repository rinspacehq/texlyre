# v0.13.2-rinspace.23 release scope

The managed Rin Agent side panel now has one host-owned collapse state. Collapsing
the panel releases its complete resizable width instead of leaving an empty right
rail, and the editor shell retains the control that expands it again. The same
behavior applies to managed article, book and tag workspaces.

The empty task hint has been removed. Public Agent problem codes are translated
into concise, actionable messages for expired login, permissions, policy limits,
dependency outages, stale task state and project-version changes. Response parsing
is bounded and does not expose private provider, wallet or repository details.

The exact Cline embed package, dependency lock, external assets and reviewed TeX
Live runtime are unchanged. Local projects remain ineligible for the managed Agent
plugin and keep their existing editing, compilation and Git behavior.

## Migration from v0.13.2-rinspace.22

- Verify the immutable archive, manifest, notices, SPDX SBOM, provenance and
  complete Corresponding Source before consumption.
- Replace the complete `/editor/` static tree atomically. Keep the reviewed TeX
  Live runtime unchanged; do not mix chunks between releases.
- Preserve local drafts, synchronized repository state, task bindings, provider
  receipts and wallet history. No data migration is required by this release.
- Product activation still requires the fixed business route, authenticated
  project binding, wallet policy and sidecar inputs. This tag alone is not a
  deployment.

## Rollback

1. Disable new Agent runs through product policy if required.
2. Restore the exact `.22` editor artifact and its matching private product lock.
3. Preserve drafts, repository history, confirmed provider receipts and wallet
   records. Do not replay an uncertain operation.
4. Recheck panel collapse/expand, managed-project reload, ordinary editing,
   compilation, manual Git, and account/local modes.

## Verification boundary

Regression coverage exercises controlled host collapse state, zero-width panel
layout, expand recovery, empty-state removal, bounded public problem parsing and
operation-specific messages. Existing managed-only boundaries, task recovery,
billing, Git synchronization and project-route checks remain required. Public
checks and built-artifact browser verification must pass for the exact source;
real-account and production acceptance remain separate gates.

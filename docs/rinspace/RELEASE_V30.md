# v0.13.2-rinspace.30 release scope

This patch keeps the v29 TeXlyre-native Rinspace Project Home while closing
three production browser races. The create form still renders immediately
while account capability and saved-draft reads are pending. Once the user
changes project metadata, the later saved-draft result can no longer replace
those newer in-memory values. A capability GET rejected during Native cookie
rotation now rechecks the official session and retries that safe read once.
The project switcher remains on Local until an optional Rinspace account is
resolved, so an anonymous browser never restores a stale Rinspace tab choice.

Submission, cover upload, Tag operations, publication, and every other write
remain disabled until the account-scoped capability and Native identity have
resolved. No mutation is replayed. Backend authorization and the private
project-creation contract are unchanged.

## Migration from v0.13.2-rinspace.29

- Verify the exact source commit, AGPL Corresponding Source, archive, manifest,
  dependency and external notices, SPDX SBOM, provenance, and SHA-256 inventory.
- Keep the reviewed TeX Live runtime, project API route, and main-site static
  tree. The private runtime may independently normalize missing legacy project
  formats to its existing `latex` compatibility value. Replace only the
  complete `/editor/` static tree for this artifact through the protected
  product rollout.
- No database schema or data migration is required.

## Rollback

1. Restore the exact `.29` editor artifact through the protected product
   rollout; the matching private runtime does not need to change.
2. Recheck Native session restoration, anonymous Local startup, immediate
   create-dialog rendering, typing before capability resolution, cover crop,
   project management, and Local projects before declaring rollback complete.

## Verification boundary

Public checks cover the deferred-capability/saved-draft regression, safe 401
recovery, anonymous Local source policy, TypeScript, lint, package assets,
notices, release assembly, and production build. The private product fixes the
exact immutable Release, performs the protected rollout, and repeats the
recovered-account browser create/edit/delete flow. A public Release by itself
does not change production.

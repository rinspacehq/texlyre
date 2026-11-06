# v0.13.2-rinspace.30 release scope

This patch keeps the v29 TeXlyre-native Rinspace Project Home while closing a
create-dialog hydration race found by production browser acceptance. The form
still renders immediately while account capability and saved-draft reads are
pending. Once the user changes project metadata, the later saved-draft result
can no longer replace those newer in-memory values.

Submission, cover upload, Tag operations, publication, and every other write
remain disabled until the account-scoped capability and Native identity have
resolved. Backend authorization and the private project-creation contract are
unchanged.

## Migration from v0.13.2-rinspace.29

- Verify the exact source commit, AGPL Corresponding Source, archive, manifest,
  dependency and external notices, SPDX SBOM, provenance, and SHA-256 inventory.
- Keep the reviewed private v29 backend, TeX Live runtime, project API route,
  and main-site static tree. Replace only the complete `/editor/` static tree
  through the protected product rollout.
- No database schema or data migration is required.

## Rollback

1. Restore the exact `.29` editor artifact through the protected product
   rollout; the matching private runtime does not need to change.
2. Recheck Native session restoration, immediate create-dialog rendering,
   typing before capability resolution, cover crop, project management, and
   Local projects before declaring rollback complete.

## Verification boundary

Public checks cover the deferred-capability/saved-draft regression, TypeScript,
lint, package assets, notices, release assembly, and production build. The
private product fixes the exact immutable Release, performs the protected
rollout, and repeats the recovered-account browser create/edit/delete flow.
A public Release by itself does not change production.

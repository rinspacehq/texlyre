# v0.13.2-rinspace.27 release scope

This patch release keeps the v26 native Rinspace project home and corrects the
on-demand new-Tag action label. After a user enters a Tag name, the action now
combines TeXlyre's existing localized `Create` label with the actual entered
name instead of displaying an uninterpolated `{name}` placeholder. The new-Tag
form remains collapsed until that explicit action is selected.

No API, permission, project, repository, cover, Tag-operation, cache, account,
or stored-data behavior changes in this release.

## Migration from v0.13.2-rinspace.26

- Verify the exact source commit, AGPL Corresponding Source, archive, manifest,
  dependency and external notices, SPDX SBOM, provenance, and SHA-256 inventory.
- Replace the complete `/editor/` static tree atomically. Retain the reviewed
  TeX Live runtime; do not mix chunks from two editor releases.
- No private API or database migration is required. Continue using the existing
  v26-compatible private business runtime and creation mode.

## Rollback

1. Restore the exact `.26` editor artifact and consumer lock through the
   protected product rollout. Do not mix `.27` chunks with the `.26` tree.
2. No database or business-container rollback is required for this display-only
   change.
3. Recheck the Project Home, the on-demand new-Tag action, account display, and
   ordinary editing before declaring rollback complete.

## Verification boundary

Public checks cover source policy, TypeScript, changed-source lint, Jest,
package assets, notices, and the production build. The private product
separately fixes the exact immutable Release, builds from protected private
main, performs the protected rollout, and validates the label in a real Native
browser session. A public Release by itself does not change production.

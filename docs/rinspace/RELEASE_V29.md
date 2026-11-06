# v0.13.2-rinspace.29 release scope

This release aligns the managed Rinspace project actions with TeXlyre's native
Local project cards. Owner-only edit and delete actions now reuse the existing
Edit and Trash icons, button variants, tooltips, spacing, and project action
row instead of introducing separate text-button styling. The Open action,
owner gating, edit form, and explicit deletion confirmation are unchanged.

No backend, storage, identity, project metadata, or deletion contract changes
are included. Local projects and non-owner Rinspace projects retain their
existing behavior.

## Migration from v0.13.2-rinspace.28

- Verify the exact source commit, AGPL Corresponding Source, archive, manifest,
  dependency and external notices, SPDX SBOM, provenance, and SHA-256 inventory.
- Keep the reviewed private v28 project-management runtime and immutable API
  contract. This release changes only the editor presentation of existing
  owner actions.
- Replace the complete `/editor/` static tree atomically. Retain the reviewed
  TeX Live runtime and do not mix chunks from two editor releases.
- No database schema or data migration is required.

## Rollback

1. Restore the exact `.28` editor artifact through the protected product
   rollout. The matching private runtime does not need to change.
2. Project updates or deletions already accepted by the authoritative backend
   are not reverted by a UI rollback.
3. Recheck Native session restoration, Project Home catalog access, Local
   projects, owner edit/delete actions, and account display before declaring
   the rollback complete.

## Verification boundary

Public checks cover source policy, TypeScript, changed-source lint, Jest,
package assets, notices, and the production build. The private product fixes
the exact immutable Release, validates the unchanged backend contract, performs
the protected rollout, and verifies the resulting action layout and management
flows in a recovered real Native browser session. A public Release by itself
does not change production.

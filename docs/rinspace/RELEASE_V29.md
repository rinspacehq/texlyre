# v0.13.2-rinspace.29 release scope

This release completes the TeXlyre-native presentation pass for the managed
Rinspace Project Home. Owner edit and delete actions reuse the Local project
card icons and button variants. Tag search, candidate review, selected tags,
and deletion confirmation reuse the existing list, badge, warning, modal, and
danger-action primitives instead of separate Rinspace-only controls.

The create and edit forms now use concise Draft/Published and Private/Public
choices. Persistent instructional copy is removed while validation, failure,
destructive-confirmation, and operation-status messages remain. Cover upload
and fixed-ratio crop behavior are unchanged; the crop surface now uses a real
keyboard-focusable control and the visible upload/crop instructions are
reduced to the native field and action labels.

The create dialog renders its native form immediately instead of blocking the
whole modal on the account-scoped capability request. Until that read finishes,
write and upload actions remain disabled; the resolved capability still controls
the available choices and every mutation remains server-authorized.

The existing user-dropdown content remains stable while Native profile data is
loading or temporarily unavailable. Opening the Rinspace Project Home warms
the account-scoped creation capability, reuses a five-minute presentation
cache, and avoids a duplicate session lookup before the capability GET. Every
create, update, delete, Tag, cover, and publication mutation still reloads the
Native session and is authorized by the private backend.

English and Simplified Chinese coverage is complete for the Project Home, and
a source-scanning regression now rejects missing keys in either catalog.

## Migration from v0.13.2-rinspace.28

- Verify the exact source commit, AGPL Corresponding Source, archive, manifest,
  dependency and external notices, SPDX SBOM, provenance, and SHA-256 inventory.
- Keep the reviewed private v28 project-management runtime and immutable API
  contract. This release changes editor presentation and safe read prewarming;
  it does not add or relax a backend write permission.
- Replace the complete `/editor/` static tree atomically. Retain the reviewed
  TeX Live runtime and do not mix chunks from two editor releases.
- No database schema or data migration is required.

## Rollback

1. Restore the exact `.28` editor artifact through the protected product
   rollout. The matching private runtime does not need to change.
2. Project updates or deletions already accepted by the authoritative backend
   are not reverted by a UI rollback.
3. Recheck Native session restoration, Project Home catalog and create-dialog
   latency, Local projects, owner edit/delete actions, cover crop, translations,
   and account display before declaring the rollback complete.

## Verification boundary

Public checks cover source policy, TypeScript, changed-source lint, Jest,
Project Home translation coverage, package assets, notices, and the production
build. The private product fixes the exact immutable Release, validates the
unchanged backend contract, performs the protected rollout, and verifies the
resulting project actions, create prewarming, cover crop, management flows, and
account display in a recovered real Native browser session. A public Release by
itself does not change production.

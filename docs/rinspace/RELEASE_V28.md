# v0.13.2-rinspace.28 release scope

This release adds native project management to the Rinspace Project Home while
preserving TeXlyre's existing project cards, modal, field, button, sidebar,
sorting, Local-project, and theme systems. Owners can edit project title,
description, cover, canonical Tags, source visibility, and publication status,
or delete a managed project through an explicit confirmation. Collaborators do
not receive owner management controls.

Project creation now presents source visibility and publication status as two
separate choices. A requested publication starts only after the initial managed
source is ready. The cover field supports click, drop, and paste input, direct
fixed-ratio dragging, keyboard repositioning, zoom, reset, replacement, and
removal. Article covers remain 1600x900 and book covers remain 900x1350.

Native session restoration is shared across concurrent callers, and creation
capability is prefetched and cached per authenticated account. Display caches
never authorize writes; the private Main BFF still verifies the Native session,
CSRF proof, current owner, canonical Tag IDs, and operation policy for every
mutation.

## Migration from v0.13.2-rinspace.27

- Verify the exact source commit, AGPL Corresponding Source, archive, manifest,
  dependency and external notices, SPDX SBOM, provenance, and SHA-256 inventory.
- Deploy only with the reviewed private runtime that provides the matching
  owner-scoped project-management metadata and PUT/DELETE contracts. Do not
  expose the v28 client against an older private runtime.
- Replace the complete `/editor/` static tree atomically. Retain the reviewed
  TeX Live runtime and do not mix chunks from two editor releases.
- No database schema migration is required. Existing managed article and book
  identities, repository bindings, publication coordination, and soft-deletion
  coordination are reused.

## Rollback

1. Restore the exact `.27` editor artifact and its matching pre-v28 private
   runtime through the protected product rollout. Do not mix `.28` chunks with
   the `.27` tree.
2. Project updates or deletions already accepted by the authoritative backend
   are not reverted by a UI rollback. Complete or reconcile those operations
   through the existing content and repository coordinators.
3. Recheck Native session restoration, Project Home catalog access, Local
   projects, managed project opening, and account display before declaring the
   rollback complete.

## Verification boundary

Public checks cover source policy, TypeScript, changed-source lint, Jest,
package assets, notices, and the production build. The private product fixes
the exact immutable Release, validates the matching backend contracts, builds
from protected private main, performs the protected rollout, and exercises the
creation, edit, deletion, cover, cache, and session flows with a disposable
test project in a real Native browser session. A public Release by itself does
not change production.

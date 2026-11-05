# v0.13.2-rinspace.26 release scope

This release aligns the Rinspace project home with TeXlyre's native project
framework. Local and Rinspace projects retain separate state and ownership, but
share the established panel hierarchy, project cards, standard modal, grid/list
preference, and name, creation-time, and update-time sorting controls. The
Rinspace sidebar provides search, active Tag and content-type filters, and recent
projects without replacing the Local project's own controls.

Rinspace project creation is now one native form for article or book projects in
LaTeX, Markdown, or Typst. Visibility, cover crop, and Tags remain available in
the same form. Existing Tags are the primary path. A new Tag form appears only
after a user enters a new name and explicitly chooses to create it; canonical
candidate review, operation recovery, and active-before-binding rules are
unchanged.

The managed catalog renders its first page immediately and continues bounded,
serial cursor loading up to 500 projects. Short-lived account-scoped memory
caches, in-flight request sharing, and idle prefetch avoid a blank reload when
switching the Rinspace Tab repeatedly. Explicit refresh and account changes
invalidate presentation caches. Native account presentation now has an explicit
initial loading state and retains the last verified identity across transient
background refresh failures.

## Migration from v0.13.2-rinspace.25

- Verify the exact source commit, AGPL Corresponding Source, archive, manifest,
  dependency and external notices, SPDX SBOM, provenance, and SHA-256 inventory.
- Replace the complete `/editor/` static tree atomically. Retain the reviewed
  TeX Live runtime; do not mix chunks from two editor releases.
- Deploy only with the matching private Main metadata change. The private BFF
  adds repository creation time and active content Tags only after the existing
  catalog ACL, readiness, and ordering checks. It does not broaden visibility or
  change managed open intents.
- Existing Local projects, managed repositories, drafts, Tags, and idempotency
  keys require no data migration. View preference remains optional browser-local
  presentation state.

## Rollback

1. Restore the exact `.25` editor artifact and matching private consumer lock
   through the protected product rollout. Do not mix `.26` chunks or service
   worker state with the `.25` tree.
2. Keep the additive private metadata reader in place or roll the complete
   business image back through its existing immutable image path. No database
   rollback is required because this release adds no schema or stored state.
3. Preserve created drafts, repositories, covers, and canonical Tags. Resume an
   uncertain operation with its original idempotency key.
4. Recheck Local create/import/export, managed list/open/refresh, account display,
   ordinary editing, Git/PR, and Rin Agent before declaring rollback complete.

## Verification boundary

Public checks cover source policy, TypeScript, changed-source lint, Jest,
package assets, notices, and the production build. Local and managed Chromium
fixtures cover the built application. The private product separately validates
the metadata query, exact immutable Release lock, private-main runtime build,
protected rollout, live static bytes, and a real Native browser session. A
public Release by itself does not change production.

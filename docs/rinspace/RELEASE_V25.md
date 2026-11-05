# v0.13.2-rinspace.25 release scope

The project home separates Rinspace managed projects from browser local projects.
Each source has its own sidebar, search and page state, while retaining the same
resizable layout. Local new, import, filter, favorites, selection, export and
delete remain available without a Rinspace account.

The Rinspace source adds a three-step draft creation flow for article and book
projects in LaTeX, Markdown and Typst. It uses the Native session and the
private product's creation capability, canonical Tag operations, idempotent
project operation, and current Gitea ACL. It does not create repositories in
the browser or turn a new draft into a published article or book. Managed
refresh revalidates the session and repository before restoring the workspace,
file route and Rin Agent context. An empty Agent run or bill no longer displays
zero usage as a charge.

The optional cover crop follows the main-site output: 1600 x 900 for articles
and 900 x 1350 for books. Zoom and position controls preview the same crop that
is exported as JPEG. Upload occurs only after explicit confirmation through the
existing `source=cover` staging API. The host remains authoritative for owner,
MIME, size, digest and repository bytes.

## Migration from v0.13.2-rinspace.24

- Verify the exact source commit, AGPL Corresponding Source, archive, manifest,
  dependency and external notices, SPDX SBOM, provenance, and SHA-256 inventory.
- Replace the complete `/editor/` static tree atomically. Retain the reviewed
  TeX Live runtime; do not mix chunks from two editor releases.
- Activate project creation only after the matching private Main/Control Plane
  migration, fixed consumer lock, six-format same-package test, real Native
  account ACL test and protected rollout. The private creation flag is off by
  default. A public Release alone does not change product or production inputs.
- Existing Local projects and managed repository history need no browser data
  migration. The source Tab preference is optional and falls back safely if
  local storage is unavailable.

## Rollback

1. Disable the private project creation flag and stop new creation requests.
2. Restore the exact `.24` editor artifact with its matching private consumer
   lock and previous static/business combination through the protected product
   rollback path. Do not mix the `.25` static tree with the `.24` service worker.
3. Preserve already created draft content, source repositories and canonical
   Tags. Resume uncertain operations with their original idempotency keys; do
   not delete or recreate them merely to roll back the interface.
4. Recheck Local create/import/export, managed open and refresh, ordinary
   preview, Git/PR and Rin Agent. The private migration is additive and its
   rollback is handled by the private product plan.

## Verification boundary

The public source PR checks TypeScript, Jest, package assets, notices and the
production build. Isolated browser checks cover source tabs, narrow layouts,
managed recovery and cover crop. The private product has tested six formats
through Main, Control Plane and the fixed accepted Gitea image, including
initial zero Renderer jobs and private repository ACL. Formal publication
reruns source, build and asset checks on a clean public `main` commit. Real
account, exact release consumption and production acceptance remain separate
private product gates.

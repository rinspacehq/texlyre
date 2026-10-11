# Source, license and integration boundary

This is a history-preserving fork of [TeXlyre](https://github.com/TeXlyre/texlyre)
maintained at [rinspacehq/texlyre](https://github.com/rinspacehq/texlyre).
Initial development starts at `d10e020a7c6452c83dedebf943615dcecfe65919`,
four commits after upstream `v0.13.0`; it does not track mutable `main`.
The upstream application version `0.13.2` is not a Rinspace release.

The fork, Rinspace browser plugins and generic core modifications remain
`AGPL-3.0-or-later`. The original LICENSE and copyright/contribution notices
are retained. Third-party code, fonts, WASM, models and assets retain their own
licenses. Do not relabel them as AGPL or assume an upstream download grants
every redistribution right.

When conveying or operating a modified network version, provide the complete
Corresponding Source applicable to that exact version, including required
build/install scripts and notices, and a clear source retrieval opportunity.
Releases must bind the artifact, source commit, source archive, dependency lock,
asset manifest and notices by immutable identifiers/digests. A link to moving
`main`, the unmodified upstream, or only some plugins is insufficient.
Coverage of integration code is assessed from its actual relationship, not
from labels such as "plugin", "API" or "separate process".

No Rinspace version has been released or deployed from this fork yet.
No private product history, secrets, operational configuration, user repositories
or drafts are included. Product/backend contracts and exact artifact acceptance
remain with Rinspace. Gitea remains authoritative for managed committed content;
independent local projects need neither a repository nor platform identity. This
fork does not introduce another publisher or per-user compilation service.

## Local bootstrap development

The fork enables `startup.profile: 'persistent-local'` in `texlyre.config.ts`.
On the direct route it reuses or creates a browser-local owner automatically,
without a password, platform account or expiring guest session. Existing guests
are preserved in a single users-store transaction **before** expiry cleanup;
their owner IDs, project databases and preference keys are unchanged. Existing
non-guest profiles are not rewritten. An aborted migration is not acknowledged
as successful. Browser clearing, eviction and private-mode limits still apply.

An explicit `?mode=managed` is not silently opened as local; it fails closed
until a verified host adapter is implemented. Unknown or duplicate mode values
also fail closed. Omitting this optional configuration or selecting `'account'`
preserves the upstream account/guest bootstrap for an upstream-style build.

Local bootstrap blocks automatic collaboration, account synchronization and
peer-file synchronization even if old settings or room keys are present. This
is not the completed network privacy audit: plugin/network entry points and
explicit optional-tool consent still require implementation and real-browser
verification. Public asset/package acquisition is not document synchronization.
The local-owner and startup tests do not certify directory writes, browser
recovery after 24 hours, compile output, offline operation or a delivered route.

## Development checks

Local folder import now reviews filenames before creating a project. A single
recognized format is suggested; mixed projects require a choice, and unknown
or empty folders remain files-only. Entry paths are relative to the selected
root. No manifest, source-content scan, compiler job or remote binding is needed
for the review. Discovery is serial, limited to 10,000 entries / 64 levels, and
yields to input every 128 entries; exceeding a limit fails instead of silently
truncating. Cancellation leaves projects untouched. Confirmation rechecks write
permission and entry existence. If linking fails after project creation, that
browser project is kept for recovery and retries do not create duplicates.

Folder import/protection uses whole path segments: Git metadata (including
worktree pointer files), dependencies and application metadata are excluded;
`.gitignore`, `.gitattributes` and unrelated prefix-named folders are preserved.
Initial directory read failures retain the pending import rather than recording
a partial read as complete. These changes do not certify transaction durability,
binary recovery, native browser permission behavior, compilation or original
directory saving. Unsupported browsers receive an explicit warning that archive
imports/downloads are copies, not a write-back to the original folder.

Run `node scripts/rinspace/check-source.mjs` to check the fixed source baseline,
license, reviewed fork lockfile and toolchain declaration. The original upstream
lock digest remains unchanged as provenance; reviewed fork dependency repairs
have a separate digest and [change record](dependency-fixes.json). pnpm is the
declared build/check input; the inherited npm lock is not a fork build input.
Run `node --test
--test-concurrency=1 scripts/rinspace/*.test.mjs` for foundation contracts.
These checks do **not** certify assets, dependency notices, a full application
build, browser compilation, actual authorization, or private integration.
Those gates remain pending and must pass before any immutable release is accepted.

## Source preparation versus artifact construction

When intentionally changing source configuration, run `pnpm prepare:source`
in the authoring worktree before source review. Inspect and commit the generated
configuration, HTML, userdata declarations and service-worker constants with
their source change. This is not a production build or a release step.

`pnpm build:prod` consumes those reviewed files without rewriting them or
running formatters. Generated plugin copies and public asset inventories are
build outputs, not independent editable sources. The complete artifact build
and unchanged-source verification remain pending; passing foundation or package
asset tests alone is not equivalent to a successful browser build.

`pnpm check:package-assets` installs/verifies npm-provided static asset copies
against the frozen installed package bytes and produces
`public/rinspace-package-assets.json`. A polluted or incomplete existing cache
is rejected and preserved for review, not silently repaired. The inventory
records package license declarations, not an embedded-asset notice certification.

`scripts/rinspace/review-external-assets.mjs` only measures the approved public
upstream archives and checks their known metadata digests. Its acquisition-only
review file is not a release lock: extracted inventories, two measured source
archive digests and all embedded notices still require review. It does not
extract, execute, publish or install these archives into the product.

The inherited GitHub Pages job is restricted to `TeXlyre/texlyre`; it cannot
deploy this source-stage Rinspace fork on a main merge or a manual dispatch.
No fork release or product deployment path is enabled by ordinary source checks.

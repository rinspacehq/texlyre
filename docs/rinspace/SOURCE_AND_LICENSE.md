# Source, license and integration boundary

This is a history-preserving fork of [TeXlyre](https://github.com/TeXlyre/texlyre)
maintained at [rinspacehq/texlyre](https://github.com/rinspacehq/texlyre).
Initial development starts at `d10e020a7c6452c83dedebf943615dcecfe65919`,
four commits after upstream `v0.13.0`; it does not track mutable `main`.
The upstream application version `0.13.2` is not itself a Rinspace release.

Opening a managed public shared tag may request a real Gitea write collaboration
grant through a CSRF-protected host endpoint. The host verifies its canonical
binding and reads back the same actor's actual repository permissions. Listing
and searching never grant access; ordinary read-only repositories stay read-only.
The plugin does not fabricate write permission, obtain a service token, or change
repository ownership, administration or branch protections.

The first reviewed fork release was `v0.13.2-rinspace.1`. A version declaration
or published release is not evidence of Rinspace adoption: the private product
must separately accept immutable artifact hashes and complete its protected
rollout. Do not infer the version currently served by Rinspace from this file.
Releases are assembled only from a clean public `main` commit by the dedicated
release workflow.

This candidate consumes the `rinspace-editor-projects/v2` metadata catalog with
descending repository-ID continuation cursors. It requires a compatible host
catalog API; an older catalog schema fails explicitly rather than falling back
to scanning every repository. The host and its indexed catalog service must be
accepted together with this artifact before the private product activates it.
Default listing excludes shared tags; nonempty search can include visible public
shared tags. Listing remains read-only and does not grant repository access.

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

Each release record must bind its exact public source commit and
tree, a `git archive` source package, the self-contained `/editor/` static tree,
the fixed TeX Live runtime inputs and outputs, the dependency lock and notices,
every external notice, and all artifact hashes.
Publication and private product consumption remain separate operations: a tag or
asset does not by itself alter Rinspace production.
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

An explicit `?mode=managed` is never silently opened as local. It requires the
enabled Rinspace workspace plugin, a verified same-origin Native actor, an
authorized Gitea repository binding and a fixed ref; invalid or duplicate mode
values fail closed. Omitting this optional configuration or selecting
`'account'` preserves the upstream account/guest bootstrap for an upstream-style
build.

Local bootstrap blocks automatic collaboration and account synchronization even
if old room keys are present. Peer file transfer is disabled by the versioned
profile default and is available only after an explicit user opt-in on an
unbound local workspace; managed repositories remain ineligible because a
Gitea repository session is not a collaboration-room ACL. N09's fresh-profile
browser acceptance observed no external or platform API requests during local
import, editing, preview, restart, offline recovery and download. Public
asset/package acquisition is distinct from document synchronization, and
optional tools retain their own user-controlled network behavior.

## Development checks

Local folder import opens the selected directory directly. It does not inspect
filenames to require a project language, format or compilation entry before
opening: mixed, resource-only and empty directories remain editable. The neutral
`files` project metadata is only an upstream compatibility value; existing
file-based preview and main-file/compiler actions remain responsible for output.
The former format/entry discovery step has been withdrawn, not hidden behind a
default choice. No manifest, compiler job or remote binding is added by opening.
Permission is checked before creating the project, cancellation or a late result
does not open a different project, and failed linking keeps the created browser
project for recovery. Retrying that operation reuses the same project and handle.

Folder import/protection uses whole path segments: Git metadata (including
worktree pointer files), dependencies and application metadata are excluded;
`.gitignore`, `.gitattributes` and unrelated prefix-named folders are preserved.
Initial directory read failures retain the pending import rather than recording
a partial read as complete. Isolated Chromium acceptance on source `8fcf31d`
opened a PNG-only folder through the native picker and browser permission UI,
then used the unchanged upstream Image Viewer to rotate a 3x1 image to 1x3,
write changed bytes to the original folder and recover the matching preview after
reload. This does not certify every binary format, transaction durability,
browser compilation or durable recovery after a later permission loss and close.
Unsupported browsers receive an explicit warning that archive
imports/downloads are copies, not a write-back to the original folder.

Directory pickers require a secure context and a user action. Stored handles are
not unconditional or permanent permission; restoring an existing project queries
the current grant and offers reconnection when necessary rather than silently
requesting permission during startup. User revocation and browser/administrator
restrictions remain effective. Browser storage and original-directory writes are
different save destinations. The write flow must complete each write and close
before acknowledging disk success; there is no atomic transaction for a whole
directory. Availability is detected from the specific API, not just a browser
name or the existence of origin-private storage. Native picker, permission and
disk round-trip behavior still require actual browser/device acceptance.

Run `node scripts/rinspace/check-source.mjs` to check the fixed source baseline,
license, reviewed fork lockfile and toolchain declaration. The original upstream
lock digest remains unchanged as provenance; reviewed fork dependency repairs
have a separate digest and [change record](dependency-fixes.json). pnpm is the
declared build/check input; the inherited npm lock is not a fork build input.
`scripts/rinspace/source-candidate.cjs` additionally identifies a build as
either an exact clean commit or an exact base commit plus every changed path,
mode, size and SHA-256. A dirty candidate is reproducible evidence for isolated
review, but it is explicitly not described as Corresponding Source already
available from the public repository and cannot pass a release gate.

`scripts/rinspace/generate-dependency-notices.cjs` walks the installed
production dependency graph from the direct runtime dependencies, binds it to
the reviewed pnpm lock digest, and emits package metadata plus de-duplicated
package-provided license/notice texts into the static tree. Development-only
packages are excluded from that browser notice; the source lock still records
them for reproduction.
Run `node --test
--test-concurrency=1 scripts/rinspace/*.test.mjs` for foundation contracts.
These source checks do **not** by themselves certify runtime assets, a full
application build, browser compilation, actual authorization, private
integration or release acceptance. N02A–N10 record those results separately so
a source test cannot be substituted for a browser or private integration result.

## Source preparation versus artifact construction

When intentionally changing source configuration, run `pnpm prepare:source`
in the authoring worktree before source review. Inspect and commit the generated
configuration, HTML, userdata declarations and service-worker constants with
their source change. This is not a production build or a release step.

`pnpm build:prod` consumes those reviewed files without rewriting them or
running formatters. Generated plugin copies and public asset inventories are
build outputs, not independent editable sources. The N10 candidate build emits
both its exact source identity and production dependency notices. Passing
foundation or package asset tests alone is still not equivalent to a successful
browser build or an accepted release.

`pnpm check:package-assets` installs/verifies npm-provided static asset copies
against the frozen installed package bytes and produces
`public/rinspace-package-assets.json`. A polluted or incomplete existing cache
is rejected and preserved for review, not silently repaired. The inventory
records package license declarations, not an embedded-asset notice certification.

`scripts/rinspace/review-external-assets.mjs` measures the approved public
upstream archives and checks exact URL, size and SHA-256. All seven archive byte
locks are now populated. `scripts/download-core-assets.cjs` streams those bytes
into a private staging directory, validates the archive and a separately
reviewed extracted-tree summary, then atomically installs it; a nonempty folder
is no longer accepted as a cache proof. All six default trees and the optional
grammar variant have reviewed extraction summaries. The font tree is additionally reconstructed from
its fixed upstream tag commit and official build script, then compared by output
inventory. The exact notice-source review is recorded in
`config/rinspace/external-assets.notices.json`. It found that tex-fmt and the
vendored TeX Live subset carry their reviewed notices, while the installed
Draw.io, TikZ editor, BusyTeX and font trees omit required source license
material and the grammar tree carries only its per-grammar subset. The formal
release assembler now fetches those missing texts from full immutable source
commits, verifies every size and SHA-256, and packages the complete set under
`/editor/notices/external`. Any missing or changed text fails the release; the
runtime archive locks remain separate and unchanged.

The Rinspace default profile uses the reviewed browser-only BusyTeX XeTeX
engine. Missing TeX files are fetched by the BusyTeX worker from the fixed
same-origin `/editor/texlive/2026` endpoint. The endpoint serves an immutable,
indexed copy of every regular file in the reviewed TeX Live 2026 `texmf-dist`
runtime archive: 180,810 files, including ctex, xeCJK, Fandol, Libertinus,
TeX Gyre, Latin Modern, STIX/XITS and the other fonts and packages present in
that archive. Files are transferred only when the browser compiler requests
them; opening the editor does not transfer the roughly 2 GB pack. The server
does not compile documents and limits runtime decompression to one active file,
so document compilation and scheduling remain owned by unmodified BusyTeX in
the user's browser.

This is complete coverage of the fixed upstream runtime tree, not a promise that
arbitrary native TeX programs, unrestricted shell escape, commercial fonts,
system fonts or packages absent from that immutable TeX Live archive can run in
a browser. The upstream archive intentionally excludes TeX Live documentation,
source, scripts, native binaries and `tlpkg`; the public source review records
that boundary and preserves the original archive and tree-list digests. TeX Live
files retain their own package-specific licenses and are not relicensed as AGPL.
The earlier reviewed 20-file ctex/xeCJK/Fandol set remains a fixed fallback only
for profiles with no runtime endpoint; it is not the production package source.
Neither path infers or changes project language, compiler choice or compile
schedule.

The upstream SwiftLaTeX implementation remains in source for compatibility, but
the Rinspace engine selectors expose only BusyTeX engines backed by the complete
fixed runtime. Userdata version 1.3.8 migrates saved global engine choices to
BusyTeX XeTeX, and legacy per-project `pdftex` or `xetex` metadata is normalized
when compiling or exporting. This prevents an apparently equivalent legacy XeTeX choice from
bypassing the complete package endpoint. The SwiftLaTeX Flask/kpathsea service
is not introduced as a production dependency. Local development retains its
explicit localhost endpoints. Typst
compiler and renderer fonts are loaded from the application origin with the
library's remote default assets disabled. The separate mirror review records
the actual one-byte Range and browser CORS probes plus timeout, 404, wrong-byte,
no-Range and no-CORS decisions. Alibaba and Tencent CTAN remain build-only;
Huawei CTAN remains disabled because its operator-index/terms and the TeXlyre
filename protocol are not established. No unqualified mirror is requested
before the reviewed Rinspace runtime.

The unmodified downloaded BusyTeX worker is still checked against SHA-256
`80eca56a2eb015bdfbebff26e539dd793407b73b6c1cd351170e6fdb6e17c39a`.
After Vite has produced `dist`, `scripts/rinspace/apply-runtime-overlays.cjs`
adds the corresponding-source CacheStorage adapter to that one generated worker.
When BusyTeX is actually initialized, the page stores its two fixed WASM engines
in a release-scoped same-origin cache; it does not download them merely because
the editor opened. Chromium failed when the same large streaming response was
cloned into this cache while traversing the application service worker, so the
fixed response is fully read before the CacheStorage write. This is needed
because dedicated-worker WASM fetches are not reliably populated by the
controlling service worker. Normal worker compilation,
engine selection, cancellation, retry and TeX Live data-package caching remain
owned by BusyTeX. The source tree and production artifact therefore have distinct,
recorded worker hashes; rebuilding an unreviewed upstream worker fails closed.

The separate `scripts/rinspace/apply-busytex-rerun-overlay.cjs` source overlay
checks the original BusyTeX 1.4.0 pipeline against SHA-256
`4855e8fec24e8df952e1080d902791752bcdf283f4fae15811c371dd3ba3389e`.
It removes the bare `rerunfilecheck` package-name match, not actual outline or
reference warnings. It retains the initial pass and at least one final-output
pass, including when a new contents, bibliography or index file emits no
warning. Further genuine warnings retain the existing three-extra-pass bound.
Every extra pass emits final output rather than running pdfTeX once more after
convergence. Bibliography/index processing, source files, compiler binaries and
TeX Live inputs are unchanged. The build runs this overlay after Vite; it never
edits downloaded archives, dependencies or live assets. Both overlay sources are
included in the complete Corresponding Source archive. A changed input or patch
anchor fails the build instead of silently patching an unknown runtime.

The Rinspace release assembly uses the single `/editor/` base for Vite assets,
PWA scope, manifest actions, service-worker navigation and the content-addressed
`/editor/assets/<asset-set>/<digest>/...` tree. `config/rinspace/release.json`
fixes the public tag, archive root and complete immutable notice inputs. The
release workflow additionally binds the actual clean source commit/tree and the
packaged static inventory; the private product must still lock and verify those
exact output hashes before any rollout.

The inherited GitHub Pages job is restricted to `TeXlyre/texlyre`; it cannot
deploy this source-stage Rinspace fork on a main merge or a manual dispatch.
Ordinary source checks cannot publish. Only an explicit manual dispatch of the
formal release workflow on public `main` may create the reviewed Release; it has
no production credentials and cannot modify the Rinspace product or route.

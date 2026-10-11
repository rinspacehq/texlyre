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
remain with Rinspace. Gitea remains authoritative for committed content; this
fork does not introduce another publisher or per-user compilation service.

## Development checks

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

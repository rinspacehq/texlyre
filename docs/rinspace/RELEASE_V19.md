# v0.13.2-rinspace.19 release scope

This candidate adds the managed Rinspace Agent workspace described in public
PR #38. The Agent is lazy-loaded only for an authenticated, account-managed
project when the host explicitly enables it. Standalone/local TeXlyre keeps the
same editor, compilation and Git behavior and neither renders the Agent entry
nor sends Agent requests.

The release consumes the exact reviewed `@rinspacehq/cline-embed`
`v0.1.0-rinspace.3` package. Its production JSX and package SHA-256 are checked
before the application build. The browser Agent exposes only the reviewed
project-scoped tools; Push remains approval-gated and provider credentials stay
behind the same-origin Rinspace API.

## Migration from v0.13.2-rinspace.18

- Replace the complete `/editor/` static tree atomically; do not mix chunks
  from `.18` and `.19`.
- Keep the existing reviewed TeX Live 2026 runtime reference. This release does
  not rebuild or upload a second copy of the runtime pack.
- Enable the Agent only after the private product pins this exact Release,
  configures the same-origin Agent API, applies its database migrations and
  adopts the matching immutable `rinspace-rin` sidecar digest.
- Keep the Agent disabled until policy, wallet and provider receipt checks pass.
  Ordinary editor, compilation and manual Git paths do not require the Agent.
- Verify the attached `SHA256SUMS`, SPDX SBOM, in-toto/SLSA provenance, release
  manifest and complete Corresponding Source archive before consumption.

## Rollback to v0.13.2-rinspace.18

1. Disable new Agent runs through the private policy before changing static
   bytes. Do not rewrite or delete already settled Agent billing evidence.
2. Atomically restore the exact `.18` editor artifact and its existing product
   lock. Keep the unchanged TeX Live runtime bytes in place.
3. Roll back the private service and sidecar only through their separately
   reviewed immutable rollback inputs. Do not replay unknown provider
   operations or reverse completed Git commits and Pushes.
4. Verify ordinary editing, compilation, collaboration and manual Git against
   `.18`, then retain `.19` run, receipt and audit rows for reconciliation.

Rollback of the browser artifact is therefore independent of historical
accounting and repository effects. Publication of `.19` alone does not change
the private product lock or production.

## Verification evidence

Exact source head, public CI run, final release workflow run, attachment
digests and anonymous download verification are recorded only after the normal
PR merge and separately authorized formal release. The fixed `.18` release
remains the executable static rollback baseline.

The fork remains AGPL-3.0-or-later. Dependency and external-asset licenses are
carried in the artifact notices and the complete source archive.

# v0.13.2-rinspace.20 release scope

This release fixes Agent tool failure feedback from public PR #39. Project
reads include numbered source; invalid edit ranges return bounded reread hints
and explicit UTF-16 column bounds. The patch tool describes exclusive end
positions and insertion semantics. Existing SHA-256 conflict checks continue
to protect concurrent user edits.

Structured tool failures are marked as errors in the Cline runtime. Three
consecutive failed tools stop the next model dispatch; a successful tool or a
new run resets that counter. The panel displays the runtime stop reason and a
readable iteration-limit message. Push still requires explicit approval.

The managed Agent panel also displays the service's confirmed bill: actual SG
charged, model and frozen price version, per-turn input/cached/output tokens,
provider cost, revenue, profit and receipt identifiers. Monetary decimal strings
retain integer precision, including negative profit. Pending turns are separate;
missing billing is shown as unconfirmed rather than zero. Refresh reads the
server again, including for a terminal task, without restoring a writable runtime.
A failed refresh labels the retained last-confirmed bill. Older services that
omit the additive `billing` field remain compatible.

The exact `@rinspacehq/cline-embed` v0.1.0-rinspace.3 package, dependency lock,
external assets and reviewed TeX Live runtime are unchanged. Standalone/local
TeXlyre retains its existing editor, compilation and Git behavior.

## Migration from v0.13.2-rinspace.19

- Verify the original artifact digest, manifest, notices, SPDX SBOM,
  provenance and complete Corresponding Source archive before consumption.
- Replace the complete `/editor/` static tree atomically, without mixing
  chunks from different releases. Keep the reviewed TeX Live bytes in place.
- Keep the Agent disabled until the private product has validated its fixed
  browser, business API, database migration, policy and sidecar inputs.
- This browser update does not settle, replay or discard provider operations,
  change wallet balances, or automatically commit or Push existing drafts.

## Rollback

1. Disable new Agent runs through the product policy.
2. Restore the exact `.19` editor artifact and its product lock atomically.
   Retain the `.18` pre-Agent fallback where specified by the product's
   accepted rollback plan; do not infer a production baseline from this tag.
3. Preserve user drafts, committed repository history and settled billing
   evidence. Reconcile unknown provider operations rather than resending them.
4. Recheck ordinary editing, collaboration, compilation and manual Git using
   the selected immutable fallback and unchanged TeX Live runtime.

## Verification boundary

PR #39's exact source passed the public test workflow before merge. Regression
coverage includes incorrect text coordinates, preservation of concurrent text,
structured failure flags, reset behavior and visible runtime errors. The
managed browser fixture additionally checks that the built application's real
Cline runtime persists three failed tool results, shows the reason and stops
before a fourth model request. This browser fixture must pass against the
built artifact before product integration; its presence is not a passing result.

Final source SHA, release workflow, artifact digests and anonymous download
verification are recorded after publication. A published release does not
change the private consumer lock or deploy production automatically.

The fork remains AGPL-3.0-or-later with dependency-specific and external-asset
notices preserved in the artifact and complete source archive.

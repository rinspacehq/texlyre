# v0.13.2-rinspace.24 release scope

The editor workbench now has one auxiliary sidebar for the managed Rin Agent,
bibliography providers including Rin Cite, comments and review changes. These
tools use a shared activity rail and one resizable content surface instead of
competing as independent horizontal panels. Project Chat remains in the footer.

Switching auxiliary tools preserves the mounted Agent instance, including its
messages, approvals, composer and active run. Existing bibliography, comment
and review toolbar controls continue to select their corresponding panel. The
activity rail remains available when auxiliary content is closed.

At laptop widths an expanded auxiliary tool yields the primary file sidebar.
At narrow and mobile widths it becomes a bounded right-side overlay, retaining
the editor work area and avoiding horizontal document overflow. The exact Cline
embed package, Agent API, billing, repository, dependency and reviewed TeX Live
inputs are unchanged.

## Migration from v0.13.2-rinspace.23

- Verify the immutable archive, manifest, notices, SPDX SBOM, provenance and
  complete Corresponding Source before consumption.
- Replace the complete `/editor/` static tree atomically. Keep the reviewed TeX
  Live runtime unchanged; do not mix chunks between releases.
- Preserve local drafts, synchronized repository state, Agent task bindings,
  provider receipts and wallet history. No data migration is required.
- Recheck existing bibliography, comment and review toolbar controls after the
  shared sidebar is activated. Product activation still requires the fixed
  private consumer and protected rollout.

## Rollback

1. Disable new Agent runs through product policy if required.
2. Restore the exact `.23` editor artifact and matching private product lock.
3. Preserve drafts, repository history, confirmed provider receipts and wallet
   records. Do not replay an uncertain operation.
4. Recheck managed Agent collapse/expand, tool switching, ordinary editing,
   compilation, manual Git, Project Chat and account/local modes.

## Verification boundary

Focused component coverage verifies one activity rail, mutually exclusive tool
selection, external toolbar opening, collapse behavior and mounted Agent state.
The production build and managed browser fixture exercise 48 theme/layout
combinations, three repository formats, Agent read/write/compile/commit/Push,
recovery, billing and failure protection. Real-account and production
acceptance remain separate private-product gates.

# v0.13.2-rinspace.32 release scope

Opening or refreshing a managed project leaves Rin closed in the editor's
activity rail. Selecting Rin opens the panel and connects to the assistant.
Closing and reopening Rin within the same project preserves the current draft
and task. This release includes the composer and tool-card improvements from
v0.13.2-rinspace.31.

## Migration from v0.13.2-rinspace.31

- Verify the release archive, source, SHA-256 inventory, SPDX SBOM,
  provenance, dependencies and external notices.
- Adopt the complete editor tree through the protected product rollout and
  reuse the reviewed TeX Live runtime.
- Open or refresh a managed project in Chromium. Verify that the editor
  displays the Rin entry and connects to the assistant only after selection.

## Rollback

Restore the exact editor artifact and runtime binding that served production
before the rollout. The current product baseline is v0.13.2-rinspace.30.
Verify the editor entry, project access and LaTeX compilation after restoration.

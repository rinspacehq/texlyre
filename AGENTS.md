# Rinspace TeXlyre fork

This is the public `rinspacehq/texlyre` fork of `TeXlyre/texlyre`.
Preserve upstream history, attribution and `AGPL-3.0-or-later` licensing.
The baseline in `config/rinspace/upstream-baseline.json` is immutable research
input, not a product release or a moving upstream branch.

## Scope and authority

- Author TeXlyre extensions here; do not copy the workbench into Rinspace Web
  or the private product repository. Product contracts and integration decisions
  remain with the private product. Existing Web/Gitea/Renderer authority is unchanged.
- Rinspace-specific behavior belongs in `extras/`. Add narrowly scoped generic
  hooks to core only when necessary and record them in `docs/rinspace/core-patches.json`.
- `src/plugins/` implementations are generated from `extras/`; edit neither
  generated copies nor generated indices as independent sources.
- Standalone local mode and existing providers must keep working. Managed mode
  must not silently fall back to API history reconstruction or a saved fake token.
- Keep all covered fork, plugin and core changes open under the upstream license.
  Retain dependency-specific notices; review actual integration relationships when
  determining Corresponding Source. Never export credentials or user data.

## Working discipline

- Use named branches/worktrees, preserve unrelated changes, and check fetch and
  push remote URLs before remote operations. Upstream is fetch-only.
- Tests/builds use no production credentials, mounts, runner or Docker socket.
  Use at most one CPU and one test worker. Do not build arbitrary external PRs
  with privileged self-hosted runners or deploy credentials.
- Before a release, validate exact dependency/asset digests, notices, complete
  Corresponding Source, clean input and unchanged reviewed source after build.
  The foundation check alone is not full application or integration acceptance.
- Current authorization covers reviewed source PRs and ordinary checks only.
  Do not publish a release, change product locks, alter main-site entry points
  or deploy without a separately accepted batch.

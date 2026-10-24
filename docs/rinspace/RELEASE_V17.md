# v0.13.2-rinspace.17 release scope

The unchanged TeX Live runtime is verified against the published
`v0.13.2-rinspace.3` assets and referenced by exact asset IDs and SHA-256 values.
The editor release does not upload a second copy of the 2 GiB runtime pack.
It runs on a dedicated one-job public TeXlyre runner with only the reviewed
public asset caches mounted inside its sandbox.

This batch packages the browser storage and project isolation fixes from
[PR #31](https://github.com/rinspacehq/texlyre/pull/31) and
[PR #32](https://github.com/rinspacehq/texlyre/pull/32).

- Keep each project in its own storage scope so a full browser store cannot
  silently replace another project's files or discard edits.
- Preserve text detection for `main.tex` and other source files, and retain
  autosave flush behavior for existing callers.
- Permit overwriting an existing file when storage estimates are low, while
  still reporting a real failed write to the author.

Both merged changes passed their final public checks, and public main
`c9c2be0fa2cf739b30629e6c09ca46a20a9b5fc3` passed its test check.
The formal release and private fixed-consumer acceptance must use the exact
new release commit. Live account editing, Push and browser storage recovery
remain production acceptance steps before the Rinspace rollout.

Dependency locks, external notices, TeX Live bytes and the upstream 0.13.2
application version are unchanged. The fork remains AGPL-3.0-or-later.

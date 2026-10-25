# v0.13.2-rinspace.18 release scope

The unchanged TeX Live runtime is verified against the published
`v0.13.2-rinspace.3` assets and referenced by exact asset IDs and SHA-256 values.
The editor release does not upload a second copy of the 2 GiB runtime pack.
It runs on a dedicated one-job public TeXlyre runner with only the reviewed
public asset caches mounted inside its sandbox.

This batch packages the managed Gitea session fix from
[PR #36](https://github.com/rinspacehq/texlyre/pull/36).

- Opening a known article, book or shared-tag repository validates the managed
  browser session directly instead of probing the unrelated project catalog.
- A catalog-listing failure can no longer turn a valid exact project route into
  `The current Gitea browser session is unavailable`.
- Repository binding, Commit and Push behavior are unchanged.

PR #36 and public main `82a051538c7b1f08dc08416d0af7dac2d4290941`
passed the complete public test workflow in run
[40171815221](https://github.com/rinspacehq/texlyre/actions/runs/40171815221).
The formal release and private fixed-consumer acceptance must use the exact new
release commit. Live article, book and shared-tag opening plus Push remain
production acceptance steps before the Rinspace rollout.

Dependency locks, external notices, TeX Live bytes and the upstream 0.13.2
application version are unchanged. The fork remains AGPL-3.0-or-later.

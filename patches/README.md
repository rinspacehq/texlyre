# BusyTeX worker compilation budget

`texlyre-busytex@1.4.0.patch` is a pnpm-managed patch of the existing
AGPL-3.0-or-later dependency, not an additional package or toolchain fork.
It edits the package's readable `dist/index.js` and its public declaration.
Those patch hunks are the preferred editable source of these local changes;
the package's original license, authorship and repository reference are retained.

The patch adds a validated finite `compileTimeoutMs` option (upstream-compatible
three-minute default), and settles/cleans up one worker job on success, error,
timeout or manual termination. Timeout and cancellation terminate the worker;
one runner cannot run overlapping compilations. It does not alter WASM, engines,
TeX Live data, initialization deadlines or global timers. The TeXlyre adapter
explicitly selects 45 minutes for book compilation.

Install with the pinned pnpm version and `pnpm install --frozen-lockfile`.
The package-manager lock includes the patch hash; do not edit installed
`node_modules` or apply an untracked post-install text replacement.
`scripts/rinspace/busytex-compilation.test.mjs` exercises the actual installed
patched runner with deterministic clocks and a worker protocol fixture, not the
Jest module mock. Its synthetic PDF bytes verify protocol lifecycle only, not
real LaTeX compilation or real-book compatibility.

Upstream source: <https://github.com/TeXlyre/texlyre-busytex>.
Remove this patch when an accepted upstream release offers equivalent timeout,
cancellation and single-flight guarantees and passes the same regressions.

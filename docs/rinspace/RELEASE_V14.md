# v0.13.2-rinspace.14 release scope

This release packages the reviewed font-family resolution and fatal compilation
result handling merged in PR #26. It adds on-demand access to 60 text families
(14 Chinese and 46 Latin families, 189 real styles) from the existing sealed
TeX Live 2026 runtime. No font files, runtime digests, external asset inputs,
license notices or dependency locks change in this release.

Author-provided fontspec configuration takes precedence. Family lookup stays
inside the reviewed runtime, does not persist generated configuration into a
project, and does not change standalone local behavior. Available fonts remain
subject to each package's existing license; no proprietary font aliases or
synthetic font styles are added.

Fatal TeX errors and nonzero TeX compiler WASM status reject partial PDF/Synctex
output even if the final PDF conversion step succeeds. Ordinary warnings and
the existing nonfatal empty-BibTeX probe retain their established behavior.

The formal workflow must repeat source, dependency, type, test, asset and full
editor build checks, include corresponding source and notices, and bind the
new tag to its exact source and artifact digests. This version declaration is
not evidence of publication, private integration or production deployment.

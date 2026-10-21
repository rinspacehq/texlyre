# v0.13.2-rinspace.16 release scope

This candidate packages the input-boundary and account-pagination changes in
[PR #30](https://github.com/rinspacehq/texlyre/pull/30).

- Keep burst syntax detachment and idle reattachment outside the complete
  composition lifetime. Cancel asynchronous work when its view is destroyed;
  do not force the user's selection or disable ordinary typing optimizations.
- Show the account catalog in replacement pages of 12 projects, with previous
  and next navigation. Reset cursor history on search, refresh and account
  changes. Do not accumulate all cards, scan the catalog for a total, or change
  the default exclusion and searchable visibility of shared tags.

Isolated source checks passed 122 suites / 1,405 tests, with the same four
inherited skipped suites / 16 skipped tests, 149 foundation tests, both
TypeScript projects and strict lint on touched implementation/test files.
Normal public checks, formal construction and private acceptance remain gates.

Real account Linux Edge/system Pinyin testing observed retained preedit text
and subsequent out-of-order input on the deployed baseline while mixing
Chinese, English and inline TeX in the middle of an existing document. The
application candidate retained the exact text and insertion boundary over
three rounds, 81 checkpoints, automatic saves and reload, with MathLive previews
enabled. A separate real catalog test checked replacement pages, previous/next,
refresh and search reset against actual bounded API responses. Test drafts and
preferences were restored; no repositories were created for these checks.

These are laboratory application-candidate results, not evidence of deployment
or a normal installed service-worker upgrade. Windows Microsoft Pinyin, the
entire spontaneous caret-relocation report and all possible data-loss paths are
not certified by these checks. Existing console errors and failed observer
attempts were retained. Production validation must not be replaced by these
source or candidate results.

Only the release declaration and documentation change after the functional
source. Dependency locks, runtime/compiler assets, fonts, external notices,
TeX Live bytes, host API contracts and permissions remain unchanged. The
upstream application version stays 0.13.2 and the fork stays AGPL-3.0-or-later.

The formal workflow must bind complete Corresponding Source, notices and
artifacts to an exact clean public main commit/tree and immutable hashes.
Private fixed consumption and protected rollout remain separate requirements.
Never replace the already-published `.15` assets with this candidate.

# v0.13.2-rinspace.15 release scope

This candidate packages the editor durability and native-input fixes merged in
[PR #28](https://github.com/rinspacehq/texlyre/pull/28):

- Capture changed text before view disposal; serialize save snapshots, bound
  continuous-input save delay, and retain and report failed saves.
- Bind asynchronous navigation to its original file/project intent. Retain
  unsaved project/file text, selection and undo across view reconstruction,
  including manual-save mode, without implicitly saving or pushing.
- Initialize MathLive widgets on their documented mount event. A floating
  formula preview/editor no longer changes source bidi spans that an operating
  system input method may own or steals focus from a different input.
- Preserve an explicitly requested file when reopening the same managed project
  instead of silently activating the manifest's main entry.

The corresponding functional source passed both TypeScript projects and the
normal PR checks, including 121 suites / 1,397 tests with V8 coverage. The four
inherited skipped suites / 16 skipped tests remain unchanged. All 149 foundation
tests pass. A single test worker now recycles between files after a 768 MB heap
threshold; test inputs, coverage inputs and CPU/memory limits are unchanged.

Real account browser checks include manual-mode draft/selection/undo retention
and actual headed Linux Edge with Fcitx5 Pinyin, native keyboard input and
candidate selection. With formula previews enabled, the final mixed-language
input, explicit Save and reload retained exact source bytes and the same file
route. Test files and preferences were restored without Push. Earlier failed
checks remain recorded separately. Windows Microsoft Pinyin and the normal
installed service-worker upgrade are not yet validated; these results do not
claim that every possible cause of spontaneous bulk text loss is resolved.

Only the version declaration and release documentation change after PR #28.
Dependencies, compiler/runtime assets, fonts, external notices, TeX Live hashes,
host API contracts and repository permissions do not change. The upstream
application version remains 0.13.2; the fork remains AGPL-3.0-or-later.

The formal workflow must repeat source, dependency, type, test, asset and full
editor build checks, package complete Corresponding Source and notices, and bind
the tag to its exact clean main commit/tree and artifact hashes. Private fixed
consumption, candidate browser/upgrade acceptance and protected deployment are
separate required steps. This declaration is not evidence of publication or
production deployment, and must not replace the already-published `.14` assets.

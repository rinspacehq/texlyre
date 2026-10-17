# Long-book compilation regression

The BusyTeX 1.4.0 pipeline treated the bare package name `rerunfilecheck` as
a request to rerun TeX. Normal package-loading and unchanged-outline messages
therefore forced four full TeX passes. The reviewed source overlay removes that
false positive and emits final output on each rerun, avoiding pdfTeX's additional
post-convergence pass. It preserves the initial pass, one mandatory subsequent
pass for contents/bibliography/index files, and the existing bound of three
extra passes when genuine warnings persist.

## Complete-source browser checks, 2026-10-18

These are actual PDF page counts, not source lines or synthetic blank pages.
Each original ZIP was imported through the ordinary browser-local project UI;
the main source was unchanged. Compilation used the actual candidate application,
unchanged pinned WASM/TeX Live inputs and the real read-only package endpoint.
All three PDFs were displayed by the editor, not merely captured from a worker.

| Complete upstream source | Engine | PDF pages | TeX passes |
| --- | --- | ---: | ---: |
| [CLP1, `9f029593`](https://github.com/arechnitzer/CLP1/tree/9f0295936d395bec68dab7915057135a2c7f0414), 1,723 files | XeTeX | 422 | 2 |
| Same CLP1, author-requested engine | pdfLaTeX | 426 | 2 |
| [Think Bayes, `b0bc09df`](https://github.com/AllenDowney/ThinkBayes/tree/b0bc09df2defeb3fbdaf2e6f7ddf9471db1dacc4), 193 files | XeTeX | 210 | 2 |

CLP1's full XeTeX PDF text and page layout extraction matched the former
four-pass output exactly: 1,052,267 characters, SHA-256
`8c499a1d4eeb95a7fced9109ba3b1c938b79b1c2383a0f71545506b509bf2265`.
The rendered formula/theorem page 100 was also byte-identical. References and
outlines converged; Think Bayes additionally exercised real index generation.
No browser page or console errors occurred in the three successful runs.

Tests ran serially under one allowed CPU at a 50% CPU quota, 2,200 MiB per
browser and no swap. This is evidence for these complete books, not a universal
speed guarantee. Earlier local-server MIME and project-opening harness failures
were preserved separately and are not counted as successful UI checks.
The books retain their CC BY-NC-SA 4.0 licenses and are not shipped in the editor.

## Finite budget and cancellation

The editor opts into a 45-minute worker compilation budget. Progress does not
reset it. The pinned dependency patch terminates workers and settles pending
jobs on timeout, cancellation or worker errors, rejects overlapping compile
requests, and prevents old jobs from changing replacement-engine state.
The dependency's default remains three minutes for other hosts that do not opt
in. Initialization has its existing separate deadline.

Actual-dependency virtual-clock tests cover completion beyond both three and
thirty minutes, the 45-minute deadline, cancellation and reuse. They are not
claimed as a 45-minute wall-clock book test. Nearby engine tests, both TypeScript
projects, full runtime-asset verification, Vite assembly and all 131 foundation
checks passed. Actual CLP1 UI cancellation also passed twice: each real TeX
process was stopped through the editor, Chrome's target list independently
confirmed destruction of its dedicated Worker, and the second start created
a fresh Worker without a late result or browser error.
This patch does not enlarge browser memory or add server-side
compilation, shell-escape tools or automatic retries.

Source verification and browser acceptance do not update production. The
candidate still requires an immutable public release, exact private consumption
and the protected rollout gates.

# Browser font-family resolution

BusyTeX XeTeX runs in WebAssembly, not against the user's operating-system font
registry. A font may be present in the immutable TeX Live runtime and load by
filename while `fontspec` fails to resolve its family name.

For the reviewed `/editor/texlive/2026` endpoint, the workspace supplies transient
`.fontspec` files using fontspec's documented per-family configuration mechanism.
They map 60 exact family names to their actual OTF/TTF files and available styles:

- Chinese: FandolSong, FandolHei, FandolKai and FandolFang.
- Additional Chinese families (use the exact English family name in fontspec):
  LXGW WenKai GB Lite (霞鹜文楷 GB 轻便版), LXGW ZhenKai GB (霞鹜臻楷 GB),
  LXGW Neo XiHei / LXGW Neo XiHei Screen (霞鹜新晰黑及屏幕阅读版),
  LXGW Neo ZhiSong / LXGW Neo ZhiSong Screen (霞鹜新致宋及屏幕阅读版),
  AR PL SungtiL GB / AR PL KaitiM GB (文鼎简报宋、简中楷),
  AR PL Mingti2L Big5 / AR PL KaitiM Big5 (文鼎细上海宋、中楷).
  GB and Big5 fonts have different character repertoires; no claim is made that
  each covers every simplified/traditional or rare character.
- English: Libertinus Serif/Sans/Mono; Latin Modern Roman/Sans/Mono; TeX Gyre
  Adventor/Bonum/Cursor/Heros/Pagella/Schola/Termes/Chorus; Noto Sans/Serif/Sans Mono;
  DejaVu Sans/Serif/Sans Mono; FreeSerif/FreeSans/FreeMono; STIX Two Text.
- Additional English families: Source Sans Pro / Source Serif Pro / Source Code
  Pro; IBM Plex Serif/Sans/Mono; Roboto / Roboto Condensed / Roboto Mono /
  Roboto Serif; Lato; Open Sans; EB Garamond; Inter; Fira Sans/Mono; JetBrains Mono;
  Cascadia Code; Carlito; Caladea; Arimo; Tinos.

For example, use `\setCJKmainfont{LXGW WenKai GB Lite}` with XeLaTeX and
xeCJK/ctex, or `\setmainfont{EB Garamond}` with fontspec. Font names are not
translated or aliased to unavailable proprietary system fonts. The six LXGW
and four AR PL additions have only their actual regular style; no bold or
italic style is invented.

No absent style is synthesized by mapping to a different font. No font binary,
dependency or document is changed. Font bytes are still fetched only on demand;
opening the editor does not download all fonts. The
existing immutable runtime retains the fonts and their license notices.

Author-supplied `.fontspec` files take precedence. Generated configurations are
compile inputs only: not user source, not committed and not saved to work-file
storage. Standalone and other endpoints receive no generated family configurations. This does not install or
substitute unavailable fonts such as SimSun or Times New Roman, and does not
make fontspec compatible with pdfTeX.

Regression evidence uses the real published BusyTeX worker and WASM, actual
runtime requests, and the candidate configuration helper in isolated Chromium.
Before the change, Libertinus loaded by filename but not family name; default
ctexart compiled correctly. With configurations, the complete 60-family sample
compiled Chinese and English text with all 189 declared styles. Each source font
was hash-checked against the immutable runtime index and its actual PostScript
name read from the font metadata. Independent PDF inspection confirmed all 189
embeddings and no missing-character warnings in the tested GB/Big5 samples. This engine-level evidence is
not a claim of an editor UI release or production rollout.

The compiler adapter also rejects fatal TeX/fontspec logs even if the WASM runner
reports a successful final PDF conversion. Partial PDFs from failed TeX runs are
not delivered as successful output. Routine font warnings and BusyTeX's existing
empty-BibTeX probe remain nonfatal; retained successful CLP1/Think Bayes logs and
a real fatal-fontspec partial-PDF result were independently checked against this
decision.

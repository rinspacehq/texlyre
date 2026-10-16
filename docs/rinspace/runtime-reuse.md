# Exact TeX Live runtime reuse

Editor-only releases default to reusing the four original runtime artifacts
from the reviewed public release ID, tag commit and immutable asset IDs.
Every source-input review byte, asset size/digest, runtime manifest/source,
file count and checksum-file line is verified. The output still contains the
same four runtime files and the formal release still publishes all ten assets.
Application checks, full source/notices and private immutable integration remain
required. There is no main/latest lookup and no change to browser compilation.

An isolated runner may receive a read-only cache containing only these four
already-public, independently verified files. It must not receive production
storage mounts, credentials or browser profiles. Without the cache, download
only the fixed public asset IDs and verify the same bytes.

Set workflow input reuse_texlive_runtime=false for the original complete
source rebuild. Changing runtime inputs requires reviewing a new reuse record
or explicitly selecting that full rebuild; mismatched inputs fail closed.

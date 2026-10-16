# Managed reopening and account-menu presentation

Reopening an existing managed project must not reseed its initial import
commit over a newer successful Git synchronization. The Rinspace adapter now
leaves a saved base to the existing binding service only when its managed
provider, repository and branch match exactly. An absent or mismatched binding
uses the original import fallback, never pending local HEAD or observed remote
HEAD. Reopening does not fetch, reset, discard drafts or weaken Push checks.

The verified host avatar/nickname labels the existing user dropdown instead
of appearing next to a second browser-local username. Without a host identity,
the original local/guest trigger remains. Persistent-local menu actions are
grouped under Browser Storage; their existing callbacks still affect only
browser data, not the host account or remote repositories. No authentication,
local ownership or upload behavior changes.

Regressions: `RinspaceManagedGit.test.ts`, `UserDropdown.test.tsx`, plus existing
GitSyncService, RinspaceManagedWorkspace and WorkspaceAccountIndicator suites.
Source checks and a locally served browser candidate do not themselves prove
a production release or deployment.

## Cached same-session reopening must also restore the project route

Returning to the project homepage clears the URL hash and current-project
session marker but leaves the verified host connection cached. Reopening that
same connection previously skipped materialization and therefore skipped route
activation. File tabs then appended `&file:...` to an empty base; the router
treated `#&file:...` as no project and returned to the homepage. Switching to a
different project avoided that cached path, explaining the apparent recovery.

The cached Open path now restores its own bound workspace route and session
marker without fetching, resetting or rewriting files. An already matching
project route retains its document/file/compile fragments. A route belonging
to another project is not carried across. Unit regressions cover all three
unbound/mismatched hash shapes and preservation of an already correct route.

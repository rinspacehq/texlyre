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

# Account presentation and catalog lifecycle

The optional Rinspace catalog account-display hook reads the existing Native
session and matching `/api/profile`. It displays the platform nickname/avatar
separately from browser-local account controls. It does not change local project
ownership, provide Git credentials, create a second login or persist profile data.
Profile mismatch/unavailability is not converted into a fake authenticated user.

Explicit `mode=local` / `mode=local-unbound`, invalid modes and local/offline
origins do not enable the Rinspace adapter, including when old settings request
integration. The existing production entry remains account-capable; an existing
disabled integration preference remains disabled.

The catalog loads on entry, search, user-requested continuation/refresh and real
account/integration changes. Focus and visibility events do not reload the list.
Connecting/connected/error workspace events do not invalidate unrelated catalog
metadata. The account indicator can recheck identity on focus without fetching
the project list again for the same actor. Stale aborted account results cannot
restore the previous user's display.

Focused component/service/route regressions, application/workspace types and
strict touched-source lint are required. A package build and real production
Open/Edit/Commit/Push verification remain separate release/rollout gates.

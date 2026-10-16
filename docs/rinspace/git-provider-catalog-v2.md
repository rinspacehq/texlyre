# Managed Git catalog compatibility

The indexed project catalog uses `rinspace-editor-projects/v2`. Project detail
and branch responses continue to use `rinspace-editor-projects/v1`.

The managed Git provider must check the catalog's own version before binding a
repository. Treating the valid v2 catalog as v1 prevented Open from reaching the
Smart HTTP fetch and reported an unavailable browser session incorrectly.

Connection checks request one row only. Explicit repository enumeration follows
bounded 100-row keyset pages, never offset pages; malformed or non-increasing
cursors and duplicate repositories fail closed. Default enumeration does not
search or include the global shared-tag catalog.

The candidate release is `v0.13.2-rinspace.6`. It retains strict v1 validation
for detail and branches, existing browser-session SSO, repository ACLs and native
Git transport. It adds no token storage, implicit tag write grants or API-based
history reconstruction. Publication and product activation remain separate from
the source change and require immutable artifact verification.

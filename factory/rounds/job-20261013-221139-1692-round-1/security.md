VERDICT: PASS

Fast-lane landing (owner directive). A render-initialisation fix in one file; the security-relevant
claims are therefore about what it does NOT change:

- The diff is `app/components/SidebarNav.tsx` alone - one `useState` initialiser and one hoisted
  `const`. No route, guard, query, payload or storage format changed.
- The remembered-state filter is untouched, so a stored id the taxonomy does not know is still
  dropped rather than carried.
- The panel is disclosed in the shipped HTML for the CURRENT route only, which is information the
  server already sends in the page itself (the operator is on that page). Nothing new is revealed to
  a caller who is not already at that route - the first draw depends on the pathname, not on any
  session or role.

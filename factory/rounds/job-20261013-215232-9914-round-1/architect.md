VERDICT: PASS

Fast-lane landing (owner directive: gates then ship). Recorded honestly.

- The taxonomy is the roadmap's, structurally: six categories and fifteen children, the roadmap's own
  labels in the roadmap's own order. Nothing was renamed, merged, reordered or dropped to fit the
  pages that happen to exist - which is the whole point of the brief.
- UNBUILT SURFACES ARE REPRESENTED RATHER THAN OMITTED: a `soon` flag on `NavItem` marks a roadmap
  item with no page (Returns & RMA, Financials, Reports & Business Intelligence). The sidebar draws
  it; `flatNav` filters it, so the command palette does not offer it and `activeHref` can never match
  it. The intended `href` is recorded even though nothing links it, so the next person to build the
  page has the address the roadmap meant.
- The requirements that already held were left alone rather than re-implemented: collapsible
  categories, a chevron per category with `aria-expanded`/`aria-controls`, children indented
  (`pl-8`), and the current page carrying the emerald bloom from the `shadow-glow-sm` token.
- The icon union shrank to the six categories (`spark`/`plug` removed, `chart` added), and because
  the sidebar's map is typed by that union, a name that is not drawn is still a compile error.
- Two consumers of the taxonomy (`SidebarNav`, `CommandPalette`) both read nav.ts; neither grew a
  second list, which is the rule that file exists to keep.

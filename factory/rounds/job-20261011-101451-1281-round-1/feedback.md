# feedback

1. returns/page.tsx metadata: title "Returns &amp; warranty - RFO Store" is a JS string literal - use "Returns & warranty" (entities do not decode in JS strings).
2. Grep the four pages for run-on words missing spaces and fix if present: shipoutside, </a>for, nextstep, canquote, accountwhere, thesame, ormicrophones, day.For, yoursto, processcould, ourchoice. Fix only where they exist in the file.
3. Header.tsx: align the inserted FAQ link indentation with sibling nav links.
4. After fixes: re-grep so every item returns clean, rerun the backend pytest from the worktree and the storefront prod build, then summarize exactly what you fixed with real gate output.
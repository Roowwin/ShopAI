# feedback
Rework round 2: home_content publishes deal_of_month only for an active product with at least one listed asset in an active lot; LEFT JOIN had published stockless products as null-price cards. Add one hermetic pytest for the stockless case (own fixture, no hand-seeded lots). Unset/blank/bad-slug stay absent. Gate: 28 passed 4 deselected; prod build green; commit deal-of-month round 2.

(Note: recorded post-hoc - the file had not reached the worktree before the rework launch; substance was carried inline in the builder prompt.)
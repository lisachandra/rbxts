---
"@lisachandra/sandcastle": patch
---

Drop rules-context dumps from the dirac log digest

dirac emits `{"rules":[…]}` as assistant markdown every time it loads rules, and the digest wrote
each one as its own block: 806 of 7,521 blocks in one integration run, ~90 KB of JSON in a file
meant to be read. The dirac provider already filtered these from the terminal stream, so the digest
renderer now applies the same filter and the two stop disagreeing about what is worth showing.

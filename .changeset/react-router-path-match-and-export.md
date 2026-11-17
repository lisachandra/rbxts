---
"@lisachandra/react-router": minor
---

Make `Path` match and export it

The path matcher could not match. Its constructor wrapped the rewritten pattern in
`.match("^(.+)/*$")` and indexed `[0]`, which returned the capture rather than the match, and the
trailing `/*` was not part of the pattern it produced; `match` then built
`{[path.match(pattern)]}` and indexed that table's _pairs_ into `_captureNames`, so a pattern with
captures produced no captures at all. Both are fixed:

- The pattern is the token-rewritten string, used verbatim, with `^` prepended and `$` appended only
  for `exact`.
- Captures are read positionally. Lua returns only the capture groups when a pattern has any, so
  index 0 is the first capture and index `n` is `_captureNames[n]`. A pattern with no `:name` token
  compiles to a regex with no groups, matches, and yields an empty record.

`Path`, `PathMatchOptions`, and `PathMatchResults` are exported from the package root, along with
`useRouteMatch`, so a consumer can match a route pattern instead of branching on `location.path` by
hand. That is the consumer-visible change, which is why this is a `minor` rather than a `patch`.

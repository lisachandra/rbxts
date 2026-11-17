---
"@lisachandra/matter": major
---

Require exactly one of `store` / `collection` on `DocumentConfig`

`DocumentConfig` accepted both handles as independent optional fields, so supplying neither — or
both — was a misconfiguration that ran the no-document flow silently instead of failing at compile
time. It is now a discriminated union: `{ store }` or `{ collection }`, never `{}` and never both.

`getDocumentStore()` resolves the union and is what `playerManager` uses; the previous
`documentConfig?.store ?? documentConfig?.collection` is gone. A `??` could not make the value total
because `?: never` is still optional, so the resolver narrows explicitly and documents that a present
config has exactly one arm.

## Breaking change

`DocumentConfig` is a published type on a post-1.0 package, so narrowing it is a **major** bump: a
consumer whose config typechecked because it named neither arm, or both, now fails to compile. Such
a config was already wrong at runtime — it silently persisted nothing — but the build break is the
point of the change, and it reaches consumers as a type error, so it cannot ship as a patch.

Nothing else moved. A config that named exactly one arm keeps compiling, `getDocumentConfig()`'s
return type and `RuntimeAdapters.document` are unchanged, and `collection` remains a deprecated
alias.

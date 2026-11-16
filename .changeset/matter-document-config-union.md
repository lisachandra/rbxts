---
"@lisachandra/matter": patch
---

Require exactly one of `store` / `collection` on `DocumentConfig`

`DocumentConfig` accepted both handles as independent optional fields, so supplying neither — or
both — was a misconfiguration that ran the no-document flow silently instead of failing at compile
time. It is now a discriminated union: `{ store }` or `{ collection }`, never `{}` and never both.

`getDocumentStore()` resolves the union and is what `playerManager` uses; the previous
`documentConfig?.store ?? documentConfig?.collection` is gone. A `??` could not make the value total
because `?: never` is still optional, so the resolver narrows explicitly and documents that a present
config has exactly one arm.

A config that typechecked before only because it named nothing (or named both) now fails to compile.
That is the intended break: such a config was already broken at runtime, and `patch` is right because
nothing that worked stops working.

`getDocumentConfig()`'s return type and `RuntimeAdapters.document` are unchanged, and `collection`
remains a deprecated alias.

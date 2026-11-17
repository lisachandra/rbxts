---
"@lisachandra/matter": major
---

Remove the unread `persistedComponents` document field

`DocumentConfig.persistedComponents` was declared with a TSDoc promise of change-triggered component
persistence and a default of `{ Hotbar: "hotbar", Inventory: "inventory" }`. Neither existed: no code
read the field and no code mapped a component name to a document key. It was specified against Lapis
in the 2026-04-25 refactor plan, and the Dataforge migration removed the document manager that would
have carried those steps; the field outlived both.

A game persists components today by writing them into `store.documents` itself, which is the one
write path into Dataforge. The field is gone rather than deprecated because it promised behaviour that
was never implemented, and both package READMEs already told consumers it had no effect.

## Breaking change

Removing the property is a **major** bump on a post-1.0 package: a consumer that still spells
`persistedComponents` in a `DocumentConfig` object literal now fails the excess-property check at
compile time. The removal is deliberate — the property never did anything, so the alternative was
keeping a field whose only observable effect is to mislead — but "no runtime behaviour changed" is
not the test for a bump when the published type surface loses a member.

Delete the property from the config. `configureRuntimeAdapters({ document })` and
`getDocumentConfig()` are unchanged; a config carries exactly the keys it was given.

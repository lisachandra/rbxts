---
"@lisachandra/matter": patch
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

`configureRuntimeAdapters({ document })` and `getDocumentConfig()` are unchanged; a config still
carries exactly the keys it was given.

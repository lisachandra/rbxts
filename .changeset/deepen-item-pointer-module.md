---
"@lisachandra/matter": minor
---

Introduce `@lisachandra/matter/utils/itemPointer` to centralize item pointer encoding (`encodeItemPointer`), parsing (`parseItemPointer`), and field accessors (`itemLocation`, `itemEntityId`). Migrate all raw `split("_")` parsing in `utils/item.ts`, server `itemManager`, and client `itemManager` to the new module.

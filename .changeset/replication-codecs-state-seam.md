---
"@lisachandra/matter": patch
---

Give replication codecs a state seam for testability: a `CodecStateReader` interface with a production store-backed adapter (`defaultStateReader`) and an `InMemoryCodecStateReader` for unit tests.

- `network/builtins/item.ts` (`itemsSerializer`, `itemsDeserializer`), `network/builtins/itemList.ts` (`createItemListSerializer`, `createItemListDeserializer`, `createItemListCodecRegistration`), and `network/builtins/stream.ts` (`createStreamDeserializer`) accept an optional reader and default to the production adapter.
- `inventory.ts`, `hotbar.ts`, `items.ts`, `item.ts`, `itemList.ts`, and `stream.ts` no longer import `@lisachandra/core/store` directly.
- Wire format (`ItemData`, payload schemas) and replication modes (`owner`/`all`) are unchanged.

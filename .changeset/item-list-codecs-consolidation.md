---
"@lisachandra/matter": patch
---

Consolidate Inventory, Hotbar, and Items replication codecs behind one `network/builtins/itemList` factory (`createItemListSerializer`, `createItemListDeserializer`, `createItemListCodecRegistration`).

- Fixes Hotbar cross-entity delta pollution by tracking `lastReplicatedItems` per entity ID.
- Wire format (`ItemData`, `InventoryPayload`, `HotbarPayload`, `ItemsPayload`) and replication modes (`owner`/`owner`/`all`) are unchanged.

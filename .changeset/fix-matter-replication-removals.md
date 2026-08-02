---
"@lisachandra/matter": patch
---

Fix client crash when a component removal packet arrives for an entity the client has never spawned.

The client replication manager no longer deserializes nil payloads (which crashed
`component.patch(nil)` inside `immutable.merge`), and the server skips sending component
removals for entities that were never replicated to the target client.

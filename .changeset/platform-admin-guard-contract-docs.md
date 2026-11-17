---
"@lisachandra/platform": patch
---

docs: document Centurion's allow-all default, the per-command guard convention, and the load path's
missing validation

Centurion has no default authorization: a command with no `@Guard` is executable and discoverable by
any client, and this package installs no default guard. The README now says so, states that the
convention is not mechanically enforced, and adds a checklist a new command has to pass.

The documents section now names #11 as the migration that removed load-path validation and points at
the document-config invariant, so a reader cannot take the presence of `createDataStoreValidator` for
enforcement.

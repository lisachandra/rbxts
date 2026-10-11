---
"@lisachandra/sandcastle": minor
---

Extend the mid-chain registration guard (#503) to batch redefinitions: `queue sequence --name X --issues ...` now refuses a redefinition that moves or drops a member which has already been dispatched. Dispatched members form the prefix the run already executed, and each member's branch is the next member's base, so a reorder leaves their branches behind the new order and `queue land` refuses the moved tail. The refusal names the first offending member and the fix — keep dispatched members first, in run order, and add new work after them (or register it gated). Refuses inside the manifest transaction, so a rejected redefinition writes nothing.

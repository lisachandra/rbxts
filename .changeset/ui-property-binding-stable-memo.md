---
"@lisachandra/ui": patch
---

Stop `usePropertyBinding` rebuilding its bindings on every render

The hook listed `propertyNames` — a rest parameter, and therefore a fresh table on every call — as a
`useMemo` dependency in all three memos. A dependency whose identity never repeats means the memo
never hits, so `createBinding` ran again each render and returned new `Binding` objects. A value
written through a `Change` handler did land, but in the binding from the handler's own render, while
the element had been handed the previous render's binding: nothing updated the one the element was
subscribed to, so a change appeared to do nothing.

Every dependency list now spreads the names (`[...propertyNames]`), so the memo compares them element
by element and a fixed call site reuses one binding per property for the life of the component. The
final memo keys on the property count, which is what it actually uses.

`useProperty` had the same rest-parameter shape. It was only wasteful rather than wrong, because it
stores plain values in `useState`, and it is corrected the same way.

The spec that pinned the rebuild as a defect now asserts that two renders hand back the same binding,
and its sibling fires a change and reads the binding after a rerender — the value the element is
actually subscribed to, which the old behaviour could not deliver.

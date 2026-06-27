---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
---

# TypeScript (Roblox-TS)

- TypeScript strict mode
- No `any` types (use `unknown` if type truly unknown)
- No type assertions / casts (`as`, `<T>`, `!`) - ever. Use strict type guards.
- Prefer `fn(options: Options)` over positional parameters. Max 2 parameters.
- Factory functions for object creation (not classes)
- `readonly` on all data structure properties
- No `Attempted to assign non-method where method was expected.` errors
- No reserved compiler usage identifiers. (error, TS, unpack, type/typeof)

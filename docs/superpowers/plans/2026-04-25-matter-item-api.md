# Matter Item API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Plan location:** This plan must be moved to `docs/superpowers/2026-04-25-matter-item-api.md` before implementation begins. The current `.kilo` path is only the temporary plan-mode scratch file.

**Goal:** Replace the legacy `Configurations.Items.Definitions` dependency in `packages/matter` with a local typed item API so `packages/matter/src/utils/item.ts` compiles without generated Roblox configuration objects, while leaving a clear follow-up path for public consumer compatibility.

**Architecture:** Keep `src/items/*` as the package-owned source of truth for item definitions and pure item helpers, and keep `src/utils/item.ts` for world/store/Instance-specific behavior. Move the `getItemConfig` path lookup onto the local `items` tree, expand the item definition tree to cover the item paths the package already uses, and fix the invalid `delete` usage by detaching the tool explicitly.

**Tech Stack:** roblox-ts, Matter ECS, package-local item definition tables in `packages/matter/src/items`, Roblox Instances from `ReplicatedStorage`

---

## Compatibility Target

- Phase 1: fix the reported `packages/matter` build errors without changing unrelated runtime behavior.
- Phase 2: add a public-facing compatibility layer for consumers of `@lisachandra/matter/items` and root `@lisachandra/matter` exports.
- Do not claim old generated-Roblox compatibility in Phase 1. The old surface exposed Roblox `Folder`/`ValueBase` instances and implicit runtime containers, while the package-local API is plain-table based.

---

### Task 0: Move The Plan Into `docs/superpowers`

**Files:**
- Create: `docs/superpowers/2026-04-25-matter-item-api.md`
- Source: `.kilo/plans/1777112534989-mighty-comet.md`

- [ ] **Step 1: Copy this plan into the requested docs directory before any code changes**

Create the destination file and copy the finalized contents of this plan into:

```text
docs/superpowers/2026-04-25-matter-item-api.md
```

The `.kilo` file is only the planning scratch file required by plan mode and should not remain the canonical copy.

- [ ] **Step 2: Confirm the docs copy is the canonical implementation plan**

After copying, all implementation work should reference:

```text
docs/superpowers/2026-04-25-matter-item-api.md
```

Expected: the plan exists under `docs/superpowers`, matching the user's requested directory, before any code implementation starts.

#### Subtask 0A: Docs Plan Relocation

**Files:**
- Create: `docs/superpowers/2026-04-25-matter-item-api.md`
- Source: `.kilo/plans/1777112534989-mighty-comet.md`

- [ ] **Step 1: Create the destination file in the requested docs directory**

Create this exact file path:

```text
docs/superpowers/2026-04-25-matter-item-api.md
```

- [ ] **Step 2: Copy the full contents of the current plan file into the docs file**

Source:

```text
.kilo/plans/1777112534989-mighty-comet.md
```

Destination:

```text
docs/superpowers/2026-04-25-matter-item-api.md
```

- [ ] **Step 3: Treat the docs copy as the canonical plan for all later execution work**

Expected: any implementation session starts from `docs/superpowers/2026-04-25-matter-item-api.md`, not the temporary `.kilo` scratch file.

---

### Task 1: Rebuild the Local Item Definition Surface

**Files:**
- Modify: `packages/matter/src/items/definitions.ts`
- Modify: `packages/matter/src/items/descriptions.ts`
- Modify: `packages/matter/src/items/serdes.ts`
- Review: `packages/matter/src/items/types.d.ts`
- Review: `packages/matter/src/components.ts`

- [ ] **Step 1: Replace the placeholder `defaultItems` tree with the package-local equivalent of the old generated item config**

Use the old Roblox-generated `Configurations.Items.Definitions` shape as the baseline for the new `items` tree, at minimum covering the paths already referenced by the package (`Potion`, `Potion.Red`, `Potion.Blue`, `Potion.Empty`) and preserving lowercase data keys for item data.

```ts
const defaultItems = {
	Potion: {
		image: 0,
		stackable: false,
		Blue: {
			alchemy_color: new Color3(),
			alchemy_ingredient: false,
			image: 0,
			stackable: false,
		},
		Empty: {
			image: 0,
			stackable: false,
		},
		Red: {
			alchemy_color: new Color3(),
			alchemy_ingredient: false,
			image: 0,
			stackable: false,
		},
	},
} as const;
```

This keeps `ValidItemPath` aligned with the actual PascalCase item hierarchy while keeping item data compatible with `ExcludePascalCaseProperties<ExtractData<...>>` in `components.ts`.

- [ ] **Step 2: Keep `descriptions.ts` compatible with the deeper hierarchy**

No type redesign is needed; confirm `Descriptions<T>` still works when `Items` contains nested PascalCase keys and lowercase leaf data fields. Populate a minimal description/image structure for the known items so helper lookups return stable defaults instead of an always-empty cast.

```ts
export const descriptions = {
	Potion: {
		description: "Potion",
		image: "",
		Blue: {
			description: "Blue Potion",
			image: "",
		},
		Empty: {
			description: "Empty Potion",
			image: "",
		},
		Red: {
			description: "Red Potion",
			image: "",
		},
	},
} satisfies Partial<Descriptions<Items>>;
```

- [ ] **Step 3: Update `serdes.ts` to match the new item data shape**

Match serializers to the data actually present on each item path. The parent `Potion` serializer should cover only the parent data, and child serializers should cover child-specific fields.

```ts
export const serdes = {
	Potion: {
		serdes: createSerializer<{ image: number; stackable: boolean }>(),
		Blue: {
			serdes: createSerializer<{
				alchemy_color: Color3;
				alchemy_ingredient: boolean;
				image: number;
				stackable: boolean;
			}>(),
		},
		Empty: {
			serdes: createSerializer<{ image: number; stackable: boolean }>(),
		},
		Red: {
			serdes: createSerializer<{
				alchemy_color: Color3;
				alchemy_ingredient: boolean;
				image: number;
				stackable: boolean;
			}>(),
		},
	},
} satisfies Partial<Serdes<Items>>;
```

- [ ] **Step 4: Run a type-only check for the item definitions**

Run: `pnpm exec tsc -p packages/matter/tsconfig.json --noEmit`

Expected: `definitions.ts`, `descriptions.ts`, `serdes.ts`, `types.d.ts`, and `components.ts` agree on `ValidItemPath`, `ExtractData`, and item `data` types, with no new item-type errors.

### Task 2: Remove `Configurations` From `utils/item.ts`

**Files:**
- Modify: `packages/matter/src/utils/item.ts`
- Review: `packages/matter/src/items/api.ts`
- Review: `packages/matter/src/items/index.ts`

- [ ] **Step 1: Replace the local `itemConfig` source with the package-local `items` tree**

The current errors come from these lines in `utils/item.ts`:

```ts
const itemConfig = getValueFromPaths(Configurations.Items.Definitions);

export function getItemConfig<P extends ValidItemPath>(
	this: void,
	paths: P,
): ExtractData<typeof Configurations.Items.Definitions, P, true> {
	return itemConfig(paths);
}
```

Change them to use the already-imported local item definitions instead:

```ts
const itemConfig = getValueFromPaths(items);

export function getItemConfig<P extends ValidItemPath>(
	this: void,
	paths: P,
): ExtractData<typeof items, P, true> {
	return itemConfig(paths);
}
```

This preserves the runtime behavior of path-based lookup while removing the missing global `Configurations` symbol.

- [ ] **Step 2: Keep pure item-definition logic aligned with `src/items/api.ts`**

Do not move the whole file. `utils/item.ts` still owns store/world helpers like `moveItem`, `removeItem`, and `spawnItem`, but its pure lookup functions should now agree with `src/items/api.ts`:
- `getCompleteItem`
- `getItemConfig`
- `getNumericItemIdFromId`
- `getItemIdFromNumericId`
- `getItemDescriptionContainer`
- `getItemDescription`
- `getItemImage`
- `getItemName`
- `createItem`

If small refactoring is needed during implementation, prefer delegating the pure helpers to `src/items/api.ts` rather than maintaining two divergent code paths.

- [ ] **Step 3: Re-run the package typecheck**

Run: `pnpm exec tsc -p packages/matter/tsconfig.json --noEmit`

Expected: the two `TS2304` errors for `Configurations` in `packages/matter/src/utils/item.ts` disappear.

### Task 3: Fix Tool Cleanup Type Safety

**Files:**
- Modify: `packages/matter/src/utils/item.ts`
- Review: `packages/matter/src/components.ts`
- Review: `packages/matter/src/systems/server/item/toolManager.ts`
- Review: `packages/matter/src/systems/client/item/toolManager.ts`

- [ ] **Step 1: Replace the invalid `delete` expression with explicit detachment**

The current code is:

```ts
if (removedItem?.tool) {
	delete removedItem.tool.Parent;
}
```

Replace it with direct parent reassignment, which matches Roblox Instance semantics and satisfies TypeScript:

```ts
if (removedItem?.tool) {
	removedItem.tool.Parent = undefined;
}
```

This keeps the runtime intent the same: the removed tool is detached from the hierarchy before the item object is returned.

- [ ] **Step 2: Confirm the `tool` field remains optional only on the item object, not on `Instance.Parent`**

No component type change should be needed. `Components.Item.tool` is already optional in `components.ts`, so the fix belongs in the cleanup logic rather than in the component types.

- [ ] **Step 3: Run the package typecheck again**

Run: `pnpm exec tsc -p packages/matter/tsconfig.json --noEmit`

Expected: the `TS2790` error at `packages/matter/src/utils/item.ts:530` is gone.

### Task 4: Final Verification

**Files:**
- Review: `packages/matter/src/utils/item.ts`
- Review: `packages/matter/src/items/definitions.ts`
- Review: `packages/matter/src/items/descriptions.ts`
- Review: `packages/matter/src/items/serdes.ts`

- [ ] **Step 1: Run the full package typecheck one last time**

Run: `pnpm exec tsc -p packages/matter/tsconfig.json --noEmit`

Expected: `packages/matter` typechecks cleanly for included source files, with no remaining `Configurations` references in `src/utils/item.ts` and no `delete`-operator type errors.

- [ ] **Step 2: Scan for leftover direct `Configurations.Items.Definitions` usage in `packages/matter`**

Run: `rg "Configurations\.Items\.Definitions|\bConfigurations\b" packages/matter/src`

Expected:
- No remaining `Configurations.Items.Definitions` usage in the package item API path
- Any remaining `Configurations` imports are outside this item-API fix scope and can be handled separately if they become build-relevant

- [ ] **Step 3: Commit the focused item API fix**

```bash
git add packages/matter/src/items/definitions.ts packages/matter/src/items/descriptions.ts packages/matter/src/items/serdes.ts packages/matter/src/utils/item.ts
git commit -m "fix: replace matter item config dependency"
```

Expected: a single commit containing only the package-local item API migration and the tool cleanup fix.

### Task 5: Public Consumer Compatibility Follow-Up

**Files:**
- Modify: `packages/matter/src/items/api.ts`
- Modify: `packages/matter/src/items/index.ts`
- Modify: `packages/matter/src/index.ts`
- Review: `packages/matter/package.json`
- Review: downstream imports of `@lisachandra/matter/items` and `@lisachandra/matter`

- [ ] **Step 1: Define the compatibility contract before changing the public API**

Decide which of these public behaviors must be preserved for consumers:
- type-level compatibility for `Items`, `ValidItemPath`, and `ExtractData`
- helper-level compatibility for `getItemConfig`, `getCompleteItem`, `createItem`, and ID helpers
- runtime compatibility for model/tool/animation lookup helpers

The old generated config cannot be preserved exactly because it used Roblox instances. The practical public contract should instead be:
- same item paths
- same merged item data shape
- same exported helper names
- stable return types for consumers

- [ ] **Step 2: Replace the public stub helpers in `src/items/api.ts` with real implementations or explicit compatibility shims**

The current public exports are placeholders:

```ts
export function getItemModelContainer(_paths: ValidItemPath): undefined {
	return undefined;
}

export function getItemToolContainer(_paths: ValidItemPath): undefined {
	return undefined;
}

export function getItemToolAnimationContainer(_paths: ValidItemPath): undefined {
	return undefined;
}

export function getItemModel(_paths: ValidItemPath): undefined {
	return undefined;
}

export function getItemTool(_paths: ValidItemPath): undefined {
	return undefined;
}

export function getItemToolAnimation(_paths: ValidItemPath): undefined {
	return undefined;
}
```

For public compatibility, either:
- delegate them to the existing runtime lookup logic from `packages/matter/src/utils/item.ts`, or
- mark them as intentionally unsupported in the package build and move them out of the public export surface.

If consumers are expected to call them, delegation is the compatibility-safe choice.

- [ ] **Step 3: Keep root and subpath exports aligned**

Because `packages/matter/src/index.ts` re-exports `./items` and `package.json` publishes `./items`, verify that the same item API is available from both:

```ts
export * from "./items";
```

No public helper should exist only on one path unless that asymmetry is deliberate and documented.

- [ ] **Step 4: Add consumer-oriented verification**

Run: `pnpm exec tsc -p packages/matter/tsconfig.json --noEmit`

Then verify the published entrypoints still typecheck conceptually for a consumer importing from the public package surface:

```ts
import type { ValidItemPath } from "@lisachandra/matter/items";
import { createItem, getItemConfig, getItemModel, getItemTool } from "@lisachandra/matter/items";
```

Expected:
- the imports resolve from the public package surface
- item path types match the expanded local definitions
- no helper remains exported publicly as an always-`undefined` placeholder unless that is an intentional breaking change

- [ ] **Step 5: Versioning decision**

If Phase 2 changes exported types or runtime behavior for existing consumers, release it as a breaking or clearly-versioned change rather than bundling it into the narrow build-fix patch.

---

**Notes for implementation**

- `packages/matter/tsconfig.json` includes `src/**/*.ts` and `src/**/*.d.ts` but excludes `src/systems/**/*`, so the immediate build target is the package surface, not the gameplay systems.
- `packages/matter/src/items/api.ts` already looks like the intended package-owned API for pure item data. Keep `src/utils/item.ts` focused on store/world/Instance behavior unless a tiny delegation removes duplication safely.
- `packages/matter/src/utils/item.ts` is internal, but `packages/matter/src/items/index.ts` and `packages/matter/src/index.ts` are public entrypoints. Changes under `src/items/*` therefore affect consumers even when they do not affect the current internal build error.
- The sample old Roblox-generated tree included package-level config values like `pickup_range` and `pickup_controls`, but the reported errors only require replacing `Configurations.Items.Definitions` inside `utils/item.ts`. Those other config values are outside this narrow item-API fix.

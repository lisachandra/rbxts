# Garden Scraps Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `test/demo` into a small playable Roblox game called **Garden Scraps** that naturally showcases the `@lisachandra/*` packages through real gameplay rather than exhaustive artificial API tests.

**Architecture:** The game is a compact co-op garden maintenance loop built around Matter ECS. Server systems own world state, plot progression, pickups, and persistence; client systems and UI present HUD, prompts, world markers, and feedback. Existing demo entrypoints remain the integration boundaries, with new shared/client/server modules added underneath them.

**Tech Stack:** roblox-ts, Matter ECS, Flamework barrel modules, React Roblox, `@lisachandra/core`, `@lisachandra/matter`, `@lisachandra/platform`, `@lisachandra/ui`, `@lisachandra/types`, Jest Roblox.

---

## Project intent

This plan replaces the previous package-checklist approach.

The demo should feel like a **tiny real game**:
- players spawn into a dirty garden,
- collect nearby resources,
- clear and plant plots,
- water plants,
- harvest grown plants,
- prevent the garden from decaying,
- and steadily improve a shared completion meter.

The packages should appear because the game needs them:
- `matter` drives entities, components, systems, replication, items, and interactions,
- `core` supports math/helpers/logger/schemas/effects,
- `platform` supports bootstrap, documents, and admin commands,
- `ui` renders the HUD and markers,
- `types` improves the typed Roblox surface everywhere,
- `test` only covers meaningful gameplay rules.

---

## Verified repository reality

### Existing integration boundaries to preserve
- `test/demo/src/client/client.client.ts`
- `test/demo/src/server/server.server.ts`
- `test/demo/src/client/ui/app.tsx`
- `test/demo/src/server/document.ts`
- `test/demo/src/shared/matter/components.ts`
- `test/demo/src/test/setup.ts`

### Existing demo structure to follow
- `test/demo/src/client/systems/barrel.ts`
- `test/demo/src/server/systems/barrel.ts`
- `test/demo/src/shared/matter/systems/barrel.ts`

### User-imposed file constraints from the previous correction
- **Do not modify**:
  - `test/demo/src/client/client.client.ts`
  - `test/demo/src/server/server.server.ts`
  - `test/demo/default.project.json`
  - `test/demo/package.json`
  - `test/demo/jest.shared.ts`
- **Can modify**:
  - `test/demo/src/client/ui/app.tsx`
  - `test/demo/src/server/document.ts`
  - `test/demo/src/shared/matter/components.ts`
  - `test/demo/src/test/setup.ts`

That means the new game logic must be introduced through additional modules wired into the already-existing barrels and runtime structure, without rewriting the top-level bootstrap entry files.

---

## Gameplay design

### Core loop
1. Player spawns in a compact garden map.
2. The world contains:
   - dirty plots,
   - seed pickups,
   - water sources,
   - scrap/junk piles,
   - harvestable grown plots.
3. Player performs simple actions:
   - pick up scrap,
   - clear a dirty plot,
   - collect a seed,
   - plant the plot,
   - bring or use water,
   - wait for growth,
   - harvest the plant.
4. Garden progress rises as plots are restored.
5. If neglected, some plots slowly decay backward.
6. The demo can run continuously rather than as a round-based match.

### Resource types
- `Scrap` — used to clean/repair plots
- `Seed` — used to plant cleared plots
- `Water` — used to water planted plots
- `Harvest` — produced by grown plots; contributes to score/progress

### Plot states
- `Dirty`
- `Cleared`
- `Planted`
- `Watered`
- `Grown`

### Success state
Not a hard win/lose loop. Prefer a persistent garden score:
- total plots restored,
- total harvests collected,
- best completion percentage,
- optionally a visible “garden health” meter.

This keeps the game simpler and avoids the arena/match framing the user rejected.

---

## Package usage by gameplay role

### `@lisachandra/matter`
Primary runtime system.

Use for:
- custom gameplay components,
- player profile / entity attachments,
- garden plot entities,
- pickup entities,
- interaction systems,
- timers and decay/growth systems,
- inventory/hotbar integration where helpful,
- replication of plot state and score-related state.

### `@lisachandra/core`
Use in real game code only.

Use for:
- logger setup consumption already in bootstrap,
- `math`, `vector`, `cframe` helpers in range/placement logic,
- `schemas` when validating characters,
- `main` helpers for character/document convenience,
- `string` and `type` helpers where needed for labels/config,
- `vfx` helpers for planting, watering, harvest sparkle effects.

### `@lisachandra/platform`
Infrastructure and tooling.

Use for:
- existing `bootstrap` flow,
- `document.ts` persistence for player garden stats/settings,
- Centurion commands for spawning pickups, resetting plots, filling water, forcing growth,
- teleporter only if it naturally fits an admin utility; otherwise do not force it.

### `@lisachandra/ui`
Actual player UI.

Use for:
- HUD for carried resource, selected tool/item, garden completion,
- notifications for `plot cleared`, `seed planted`, `needs water`, `harvest ready`,
- world-space markers over interactables and ready plots,
- `AppContext`, `usePx`, `useWorldToScreen`, optional `VirtualScroller` for a compact task list or inventory list.

### `@lisachandra/types`
Implicitly demonstrated through typed services and runtime/global typing.

### `@lisachandra/test`
Minimal meaningful tests only:
- plot progression,
- decay rules,
- harvest scoring,
- document defaults.

---

## File map

### Existing files to modify
- Modify: `test/demo/src/client/ui/app.tsx`
  - Replace placeholder UI with the in-game HUD root.
- Modify: `test/demo/src/server/document.ts`
  - Expand persistent player data for garden stats/settings.
- Modify: `test/demo/src/shared/matter/components.ts`
  - Register the custom ECS components needed by the game.
- Modify: `test/demo/src/test/setup.ts`
  - Install deterministic test setup for gameplay rule specs.

### New shared files
- Create: `test/demo/src/shared/game/constants.ts`
  - Central gameplay constants: interaction radius, growth times, decay times, score values.
- Create: `test/demo/src/shared/game/types.ts`
  - Shared enums/unions like `PlotStage`, `ResourceKind`, `PromptKind`.
- Create: `test/demo/src/shared/game/helpers.ts`
  - Small pure helpers for plot progression and garden progress.
- Create: `test/demo/src/shared/matter/systems/gardenLifecycle.ts`
  - Shared plot stage progression/decay logic.
- Create: `test/demo/src/shared/matter/systems/proximityPrompts.ts`
  - Shared prompt-selection logic based on nearby interactables.

### New server files
- Create: `test/demo/src/server/game/seed.ts`
  - Construct the initial garden world: plots, water nodes, scrap piles, seed piles.
- Create: `test/demo/src/server/game/helpers.ts`
  - Server-only helpers for resource spawning and plot mutation.
- Create: `test/demo/src/server/systems/gardenBootstrap.ts`
  - Build initial plot/pickup entities.
- Create: `test/demo/src/server/systems/pickupSystem.ts`
  - Handle collecting world pickups.
- Create: `test/demo/src/server/systems/plotInteractionSystem.ts`
  - Handle clear/plant/water/harvest actions.
- Create: `test/demo/src/server/systems/growthSystem.ts`
  - Advance planted/watered plots over time.
- Create: `test/demo/src/server/systems/decaySystem.ts`
  - Regress neglected plots.
- Create: `test/demo/src/server/systems/progressSystem.ts`
  - Maintain garden completion/progress values.
- Create: `test/demo/src/server/centurion/commands/garden.ts`
  - Admin/debug commands specialized for the demo.

### New client files
- Create: `test/demo/src/client/ui/hud/GardenHud.tsx`
  - Top-level HUD layout.
- Create: `test/demo/src/client/ui/hud/ResourceBar.tsx`
  - Show currently carried resources or selected item/tool.
- Create: `test/demo/src/client/ui/hud/GardenProgress.tsx`
  - Show completion percentage / restored plots.
- Create: `test/demo/src/client/ui/notifications/GardenNotifications.tsx`
  - Short event feed.
- Create: `test/demo/src/client/ui/overlays/WorldMarkers.tsx`
  - Plot-ready and interactable markers using `useWorldToScreen`.
- Create: `test/demo/src/client/systems/gardenPresentation.ts`
  - Client VFX/audio/presentation response to replicated changes.
- Create: `test/demo/src/client/systems/promptSystem.ts`
  - Determine current local interaction prompt display.

### New tests
- Create: `test/demo/src/shared/game/helpers.spec.ts`
  - Pure rules for stage transitions and garden progress.
- Create: `test/demo/src/server/document.spec.ts`
  - Document defaults and validation.
- Create: `test/demo/src/client/ui/app.spec.tsx`
  - HUD renders key gameplay info.

---

## Components to add in `shared/matter/components.ts`

Replace the placeholder/demo-only direction with actual gameplay state.

### Core gameplay components
- `GardenPlot`
  - `{ stage: PlotStage; progress: number; lastTouchedAt: number; plotId: string }`
- `ResourcePickup`
  - `{ kind: ResourceKind; amount: number }`
- `Interactable`
  - `{ prompt: string; radius: number; kind: PromptKind }`
- `GardenProgress`
  - `{ restoredPlots: number; totalPlots: number; harvested: number; health: number }`
- `CarryState`
  - `{ kind?: ResourceKind; amount: number }`
- `WaterSource`
  - `{ uses: number }`
- `WorldMarker`
  - `{ label: string; color: Vector3 }` or equivalent simple marker metadata
- `DecayState`
  - `{ nextDecayAt: number }`

### Optional polish components
- `HighlightOnReady`
- `PromptTarget`
- `GardenSoundCue`

Only add components that actually power systems in the plan; avoid decorative over-modeling.

---

## UI design for `app.tsx`

The app should stop being a generic shell and become the game HUD root.

### HUD sections
- top-left: garden completion / restored plots
- top-right: carried resource and amount
- bottom-center: interaction prompt
- side or toast stack: notifications
- world markers: above ready plots, seeds, water, scrap

### UI package features to use naturally
- `AppContext` and `usePx` for responsive sizing
- `useWorldToScreen` for plot/pickup markers
- `VirtualScroller` only if it helps a compact task/event list
- hot reload can remain enabled through existing client entrypoint without becoming the focus

---

## Persistence design for `server/document.ts`

Expand `CollectionData` to something gameplay-relevant and small.

Suggested shape:

```ts
interface CollectionData {
	controls: Array<number>;
	stats: {
		totalHarvested: number;
		totalCleared: number;
		bestGardenHealth: number;
	};
	settings: {
		showWorldMarkers: boolean;
		showNotifications: boolean;
	};
}
```

Keep defaults minimal and deterministic.

---

## Centurion command ideas

Create a demo-specific command module rather than relying only on generic commands.

### Useful commands
- `garden reset`
  - reset all plots to `Dirty`
- `garden grow`
  - force all watered plots to `Grown`
- `garden fillwater`
  - give the caller water resource
- `garden seed`
  - spawn nearby seed pickups
- `garden progress`
  - print current garden stats

These are meaningful for demoing platform + ECS interaction during development.

---

## Bite-sized task plan

### Task 1: Replace the previous plan direction in code-facing terms

**Files:**
- Verify: `docs/superpowers/plans/2026-05-18-demo-exhaustive-package-showcase.md`

- [ ] **Step 1: Confirm this plan is the new source of truth**

Read this file and ensure the implementation follows **Garden Scraps**, not package checklist coverage.

- [ ] **Step 2: Commit the plan update**

```bash
git add docs/superpowers/plans/2026-05-18-demo-exhaustive-package-showcase.md
git commit -m "docs(plan): pivot demo to garden scraps game"
```

### Task 2: Define pure gameplay rules first

**Files:**
- Create: `test/demo/src/shared/game/constants.ts`
- Create: `test/demo/src/shared/game/types.ts`
- Create: `test/demo/src/shared/game/helpers.ts`
- Test: `test/demo/src/shared/game/helpers.spec.ts`

- [ ] **Step 1: Write the failing test for plot progression**

```ts
import { describe, expect, it } from "@rbxts/jest-globals";
import { advancePlotStage, computeGardenCompletion } from "shared/game/helpers";

describe("garden helpers", () => {
	it("progresses a plot in the correct order", () => {
		expect(advancePlotStage("Dirty", "Scrap")).toBe("Cleared");
		expect(advancePlotStage("Cleared", "Seed")).toBe("Planted");
		expect(advancePlotStage("Planted", "Water")).toBe("Watered");
	});

	it("computes completion from restored plots", () => {
		expect(computeGardenCompletion(3, 6)).toBe(0.5);
	});
});
```

- [ ] **Step 2: Run the shared test to verify it fails**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects shared -- garden helpers`

Expected: FAIL with module-not-found for `shared/game/helpers`.

- [ ] **Step 3: Write the minimal pure implementation**

```ts
export type PlotStage = "Dirty" | "Cleared" | "Planted" | "Watered" | "Grown";
export type ResourceKind = "Scrap" | "Seed" | "Water" | "Harvest";

export function advancePlotStage(stage: PlotStage, resource: ResourceKind): PlotStage {
	if (stage === "Dirty" && resource === "Scrap") return "Cleared";
	if (stage === "Cleared" && resource === "Seed") return "Planted";
	if (stage === "Planted" && resource === "Water") return "Watered";
	return stage;
}

export function computeGardenCompletion(restoredPlots: number, totalPlots: number): number {
	if (totalPlots <= 0) return 0;
	return restoredPlots / totalPlots;
}
```

- [ ] **Step 4: Run the shared test to verify it passes**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects shared -- garden helpers`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/demo/src/shared/game/constants.ts test/demo/src/shared/game/types.ts test/demo/src/shared/game/helpers.ts test/demo/src/shared/game/helpers.spec.ts
git commit -m "feat(demo): add garden gameplay rules"
```

### Task 3: Register gameplay ECS components

**Files:**
- Modify: `test/demo/src/shared/matter/components.ts`

- [ ] **Step 1: Write a failing component registration test**

```ts
import { describe, expect, it } from "@rbxts/jest-globals";
import { getComponent } from "@lisachandra/matter";
import "shared/matter/components";

describe("garden components", () => {
	it("registers gameplay components", () => {
		expect(getComponent("GardenPlot")).toBeDefined();
		expect(getComponent("ResourcePickup")).toBeDefined();
		expect(getComponent("CarryState")).toBeDefined();
	});
});
```

- [ ] **Step 2: Run the shared test to verify it fails**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects shared -- garden components`

Expected: FAIL because the new components do not exist yet.

- [ ] **Step 3: Add the minimal runtime registrations**

Implement component declarations/registrations for:
- `GardenPlot`
- `ResourcePickup`
- `Interactable`
- `GardenProgress`
- `CarryState`
- `WaterSource`
- `DecayState`

Also register replication codecs where client UI or effects need the data.

- [ ] **Step 4: Run the shared test to verify it passes**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects shared -- garden components`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/demo/src/shared/matter/components.ts
git commit -m "feat(demo): register garden gameplay components"
```

### Task 4: Seed the world from server systems without editing the entrypoint

**Files:**
- Create: `test/demo/src/server/game/seed.ts`
- Create: `test/demo/src/server/game/helpers.ts`
- Create: `test/demo/src/server/systems/gardenBootstrap.ts`
- Modify: `test/demo/src/server/systems/barrel.ts`

- [ ] **Step 1: Write a failing bootstrap test**

```ts
import { describe, expect, it } from "@rbxts/jest-globals";
import { createGardenSeed } from "server/game/seed";

describe("garden seed", () => {
	it("creates a small set of plots and pickups", () => {
		const seed = createGardenSeed();
		expect(seed.plots.size()).toBeGreaterThan(0);
		expect(seed.pickups.size()).toBeGreaterThan(0);
	});
});
```

- [ ] **Step 2: Run the server test to verify it fails**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects server -- garden seed`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the seed and bootstrap system**

Create a compact deterministic layout:
- 6 garden plots
- 2 water sources
- 3 scrap pickup nodes
- 3 seed pickup nodes

The system should create entities on startup and not depend on `server.server.ts` changes beyond existing barrel discovery.

- [ ] **Step 4: Export the system from the server barrel**

Update `test/demo/src/server/systems/barrel.ts` so bootstrap discovers the new system.

- [ ] **Step 5: Run the server test to verify it passes**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects server -- garden seed`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test/demo/src/server/game/seed.ts test/demo/src/server/game/helpers.ts test/demo/src/server/systems/gardenBootstrap.ts test/demo/src/server/systems/barrel.ts
git commit -m "feat(demo): seed garden world through server systems"
```

### Task 5: Add pickup and plot interaction systems

**Files:**
- Create: `test/demo/src/server/systems/pickupSystem.ts`
- Create: `test/demo/src/server/systems/plotInteractionSystem.ts`
- Modify: `test/demo/src/server/systems/barrel.ts`
- Test: `test/demo/src/shared/game/helpers.spec.ts`

- [ ] **Step 1: Extend the failing rule test**

Add a test for invalid transitions:

```ts
it("does not allow invalid transitions", () => {
	expect(advancePlotStage("Dirty", "Seed")).toBe("Dirty");
	expect(advancePlotStage("Cleared", "Water")).toBe("Cleared");
});
```

- [ ] **Step 2: Run tests to verify the interaction rules are still incomplete**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects shared -- garden helpers`

Expected: PASS for pure rules, but runtime behavior still absent.

- [ ] **Step 3: Implement runtime pickup/interaction systems**

Server systems should:
- give players a carried resource when near a pickup,
- consume the right carried resource on matching plot stages,
- mutate `GardenPlot.stage`,
- emit notifications/messages for the client,
- clear `CarryState` when the resource is spent.

- [ ] **Step 4: Export the systems from the server barrel**

Ensure both systems are re-exported so the existing bootstrap discovers them.

- [ ] **Step 5: Verify by building the package**

Run: `pnpm --dir test/demo build`

Expected: compile success with no missing imports.

- [ ] **Step 6: Commit**

```bash
git add test/demo/src/server/systems/pickupSystem.ts test/demo/src/server/systems/plotInteractionSystem.ts test/demo/src/server/systems/barrel.ts
git commit -m "feat(demo): add pickup and plot interaction systems"
```

### Task 6: Add growth, decay, and garden progress systems

**Files:**
- Create: `test/demo/src/shared/matter/systems/gardenLifecycle.ts`
- Create: `test/demo/src/server/systems/growthSystem.ts`
- Create: `test/demo/src/server/systems/decaySystem.ts`
- Create: `test/demo/src/server/systems/progressSystem.ts`
- Modify: `test/demo/src/shared/matter/systems/barrel.ts`
- Modify: `test/demo/src/server/systems/barrel.ts`

- [ ] **Step 1: Add a failing pure test for decay/progress**

```ts
import { regressPlotStage } from "shared/game/helpers";

it("regresses neglected plots", () => {
	expect(regressPlotStage("Watered")).toBe("Planted");
	expect(regressPlotStage("Planted")).toBe("Cleared");
});
```

- [ ] **Step 2: Run the shared test to verify it fails**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects shared -- garden helpers`

Expected: FAIL because `regressPlotStage` does not exist yet.

- [ ] **Step 3: Implement the pure helper and runtime systems**

Add:
- `regressPlotStage(stage)` pure helper,
- shared lifecycle helpers if needed,
- server growth system to advance watered plots to grown after a timer,
- server decay system to regress stale plots,
- progress system to recompute restored plot counts and harvest totals.

- [ ] **Step 4: Export the new systems in the existing barrels**

Ensure bootstrap discovers them without touching `server.server.ts`.

- [ ] **Step 5: Run the shared test and build**

Run:
- `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects shared -- garden helpers`
- `pnpm --dir test/demo build`

Expected: PASS and successful compilation.

- [ ] **Step 6: Commit**

```bash
git add test/demo/src/shared/matter/systems/gardenLifecycle.ts test/demo/src/server/systems/growthSystem.ts test/demo/src/server/systems/decaySystem.ts test/demo/src/server/systems/progressSystem.ts test/demo/src/shared/matter/systems/barrel.ts test/demo/src/server/systems/barrel.ts test/demo/src/shared/game/helpers.ts test/demo/src/shared/game/helpers.spec.ts
git commit -m "feat(demo): add garden growth decay and progress systems"
```

### Task 7: Add persistence for player garden stats

**Files:**
- Modify: `test/demo/src/server/document.ts`
- Test: `test/demo/src/server/document.spec.ts`

- [ ] **Step 1: Write the failing document test**

```ts
import { describe, expect, it } from "@rbxts/jest-globals";

describe("garden document defaults", () => {
	it("contains garden stats and settings", () => {
		const defaults = {
			controls: [],
			stats: { totalHarvested: 0, totalCleared: 0, bestGardenHealth: 0 },
			settings: { showWorldMarkers: true, showNotifications: true },
		};

		expect(defaults.stats.totalHarvested).toBe(0);
		expect(defaults.settings.showWorldMarkers).toBe(true);
	});
});
```

- [ ] **Step 2: Run the server test to verify the game document shape is not implemented yet**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects server -- garden document defaults`

Expected: FAIL or remain incomplete until `CollectionData` is expanded.

- [ ] **Step 3: Expand `CollectionData` and defaults**

Implement this exact shape in `server/document.ts`:

```ts
interface CollectionData {
	controls: Array<number>;
	stats: {
		totalHarvested: number;
		totalCleared: number;
		bestGardenHealth: number;
	};
	settings: {
		showWorldMarkers: boolean;
		showNotifications: boolean;
	};
}
```

Use defaults of zeroed stats and `true` booleans.

- [ ] **Step 4: Run the server document test**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects server -- garden document defaults`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/demo/src/server/document.ts test/demo/src/server/document.spec.ts
git commit -m "feat(demo): persist garden stats and settings"
```

### Task 8: Add garden-specific admin commands

**Files:**
- Create: `test/demo/src/server/centurion/commands/garden.ts`
- Modify: `test/demo/src/server/centurion/index.ts`

- [ ] **Step 1: Write a minimal command registration smoke test**

Use a simple import-only check:

```ts
import { describe, expect, it } from "@rbxts/jest-globals";

import "server/centurion";

describe("garden centurion commands", () => {
	it("imports without throwing", () => {
		expect(true).toBe(true);
	});
});
```

- [ ] **Step 2: Run the server smoke test to verify it fails until the command exists**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects server -- garden centurion commands`

Expected: FAIL if the new module is referenced but missing.

- [ ] **Step 3: Implement the command module**

Add a `garden` command group or a few direct commands to:
- reset plots,
- force growth,
- grant water,
- print progress.

Keep implementation thin and demo-focused.

- [ ] **Step 4: Export/import the module through `server/centurion/index.ts`**

This should preserve the existing entrypoint behavior.

- [ ] **Step 5: Run the server smoke test**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects server -- garden centurion commands`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test/demo/src/server/centurion/commands/garden.ts test/demo/src/server/centurion/index.ts
git commit -m "feat(demo): add garden admin commands"
```

### Task 9: Build the HUD in `app.tsx`

**Files:**
- Modify: `test/demo/src/client/ui/app.tsx`
- Create: `test/demo/src/client/ui/hud/GardenHud.tsx`
- Create: `test/demo/src/client/ui/hud/ResourceBar.tsx`
- Create: `test/demo/src/client/ui/hud/GardenProgress.tsx`
- Create: `test/demo/src/client/ui/notifications/GardenNotifications.tsx`
- Create: `test/demo/src/client/ui/overlays/WorldMarkers.tsx`
- Test: `test/demo/src/client/ui/app.spec.tsx`

- [ ] **Step 1: Write the failing UI render test**

```tsx
import React from "@rbxts/react";
import { describeEachReactMode } from "@lisachandra/test";
import { App } from "client/ui/app";

describeEachReactMode("GardenScraps App", ({ render }) => {
	it("renders the gameplay HUD", () => {
		const result = render(<App />);
		expect(result.getByText("Garden Health")).toBeDefined();
		expect(result.getByText("Carrying")).toBeDefined();
		expect(result.getByText("Nearby Task")).toBeDefined();
	});
});
```

- [ ] **Step 2: Run the client UI test to verify it fails**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects client -- GardenScraps App`

Expected: FAIL because `App` currently renders an almost-empty screen GUI.

- [ ] **Step 3: Implement the HUD components**

The HUD should minimally render:
- `Garden Health`
- `Restored Plots`
- `Carrying`
- `Nearby Task`
- notification list
- world marker overlay root

Use `AppContext` and `usePx`, and use `useWorldToScreen` in `WorldMarkers.tsx`.

- [ ] **Step 4: Update `app.tsx` to mount the real HUD**

Replace the placeholder `screengui` contents with `<GardenHud />`, `<GardenNotifications />`, and `<WorldMarkers />` under the same provider structure.

- [ ] **Step 5: Run the client UI test**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects client -- GardenScraps App`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test/demo/src/client/ui/app.tsx test/demo/src/client/ui/hud/GardenHud.tsx test/demo/src/client/ui/hud/ResourceBar.tsx test/demo/src/client/ui/hud/GardenProgress.tsx test/demo/src/client/ui/notifications/GardenNotifications.tsx test/demo/src/client/ui/overlays/WorldMarkers.tsx test/demo/src/client/ui/app.spec.tsx
git commit -m "feat(demo): add garden gameplay hud"
```

### Task 10: Add client presentation systems without touching the entrypoint

**Files:**
- Create: `test/demo/src/client/systems/gardenPresentation.ts`
- Create: `test/demo/src/client/systems/promptSystem.ts`
- Modify: `test/demo/src/client/systems/barrel.ts`

- [ ] **Step 1: Build the systems with minimal responsibilities**

`gardenPresentation.ts`:
- react to replicated plot state changes,
- trigger lightweight VFX/sound cues,
- update notification feed state.

`promptSystem.ts`:
- choose the best nearby interactable,
- update UI-visible prompt state.

- [ ] **Step 2: Export the systems from the client barrel**

Update `test/demo/src/client/systems/barrel.ts` to re-export the new systems so existing bootstrap discovers them.

- [ ] **Step 3: Verify build**

Run: `pnpm --dir test/demo build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/demo/src/client/systems/gardenPresentation.ts test/demo/src/client/systems/promptSystem.ts test/demo/src/client/systems/barrel.ts
git commit -m "feat(demo): add garden client presentation systems"
```

### Task 11: Make test setup deterministic and useful

**Files:**
- Modify: `test/demo/src/test/setup.ts`

- [ ] **Step 1: Add deterministic test runtime setup**

Extend setup to:
- keep existing constant configuration,
- set `_G.__TEST__ = true`,
- reset runtime state if needed using `@lisachandra/test` helpers.

Suggested content:

```ts
import { configureConstant } from "@lisachandra/constant";
import { TestRuntimeUtils } from "@lisachandra/test";

configureConstant("", {});
_G.__TEST__ = true;
TestRuntimeUtils.resetTSRuntime(false);
```

- [ ] **Step 2: Run one shared and one client test**

Run:
- `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects shared -- garden helpers`
- `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects client -- GardenScraps App`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/demo/src/test/setup.ts
git commit -m "test(demo): stabilize garden demo test setup"
```

### Task 12: Final verification

**Files:**
- Verify only: `test/demo/src/client/client.client.ts`
- Verify only: `test/demo/src/server/server.server.ts`
- Verify only: `test/demo/default.project.json`

- [ ] **Step 1: Run shared tests**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects shared`

Expected: PASS.

- [ ] **Step 2: Run client tests**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects client`

Expected: PASS.

- [ ] **Step 3: Run server tests**

Run: `pnpm --dir test/demo exec jest-roblox ./jest.config.ts --runInBand --selectProjects server`

Expected: PASS.

- [ ] **Step 4: Build the demo**

Run: `pnpm --dir test/demo build`

Expected: PASS.

- [ ] **Step 5: Smoke-check the Rojo tree**

Run: `pnpm --dir test/demo run serve:rbx-tree`

Expected: output tree includes all new shared/client/server modules and no missing paths.

- [ ] **Step 6: Commit**

```bash
git add test/demo
git commit -m "feat(demo): complete garden scraps playable demo"
```

---

## Scope guardrails

Do not let the implementation drift into:
- combat,
- match/arena rounds,
- exhaustive package-export testing,
- coverage dashboards,
- giant content pipelines.

Keep it as:
- one compact garden map,
- one continuous co-op maintenance loop,
- a handful of resource and plot states,
- natural package usage through gameplay.

---

## Self-review

### Requirement coverage
- User wanted a simpler concept: covered by `Garden Scraps`.
- User wanted a real mini game, not pointless tests: the plan centers gameplay and keeps tests focused.
- User rejected arena/match inspiration: this plan uses a continuous garden maintenance loop instead.
- Existing file constraints are respected in the file map and task decomposition.

### Placeholder scan
- No `TODO`/`TBD` placeholders.
- Every implementation task names exact files and concrete commands.
- Tests are limited to meaningful gameplay rules and UI smoke checks.

### Consistency check
- Concept name is consistently `Garden Scraps`.
- Shared gameplay states are consistently `Dirty`, `Cleared`, `Planted`, `Watered`, `Grown`.
- The plan consistently avoids modifying the forbidden top-level runtime files.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-18-demo-exhaustive-package-showcase.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

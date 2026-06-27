---
name: react-roblox-ui
description: Use when building Roblox UI screens, HUDs, or panels that should be template-driven React. Use when the user mentions ReactTemplate, fromInstance, templateChildren, ReplicatedStorage.UI, or template-backed UI.
---

# React Roblox UI

## Overview

Turn visual Roblox UI ideas into template-driven React: prototype the look, create static Roblox UI Instances as the **contract**, register them with `ReactTemplate.fromInstance`, then compose behavior with React.

The invariant is the final UI uses templates. HTML prototyping and generated Luau creation scripts are flexible checkpoints; template registration and template-driven React usage are mandatory unless the user explicitly opts out.

## When to Use

Use for:
- New Roblox UI screens, HUDs, menus, overlays, inventory, hotbars, prompts, scoreboards, and debug panels.
- Porting HTML/CSS mockups or Studio-authored UI into roblox-ts React.
- Requests mentioning `ReactTemplate`, `fromInstance`, `templateChildren`, `ReplicatedStorage.UI`, or **template-driven** UI.

Do not use for:
- Pure data/model changes with no UI asset or visual layer.
- Tiny edits to an already template-driven component unless the template contract changes.

## Core Workflow

### 1. Clarify the target UI

Ask what the UI must show, what is static vs dynamic (the **contract** boundary), and whether Studio assets already exist. Inspect existing UI/component/template conventions before naming new assets.

**Done when:** Target UI is clarified — what to show, static/dynamic split, naming confirmed against existing conventions.

### 2. Prototype visually when useful

Default to an HTML/CSS mockup when layout, proportions, styling, or interaction states are uncertain. Skip only with an explicit reason, such as "existing Studio UI already approved" or "minor template wiring change." Treat the mockup as visual guidance, not an exact CSS-to-Roblox translation.

**Done when:** Visual direction approved or skip reason documented.

### 3. Translate to Roblox Instances (Pixel Offset Sizing)

Define a static Instance hierarchy under a predictable path such as `ReplicatedStorage.UI.<FeatureName>`.

- **CRITICAL**: Use **pixel offsets** for sizing and positioning. Reserve scale values strictly for anchor positioning (e.g., `0.5, 0.5` for center alignment).
- Prefer named descendants that match the future React customization points.
- Static template: frames, labels, image placeholders, constraints, strokes, padding, layout objects.
- Dynamic React: text values, images, visibility, events, state, ECS/store bindings, timers, and network data.

**Done when:** Instance hierarchy is ready with pixel-offset sizing; named descendants match React customization points.

### 4. Coordinate user-owned Studio and typing steps

If the agent cannot directly modify the place file or generated services, provide a Luau creation/import script and exact placement instructions. Tell the user when they must sync or edit service typings, especially `src/types/services/ReplicatedStorage.d.ts`, before typed template paths will compile. Do not assume `ReplicatedStorage.UI` exists; inspect or call out the missing prerequisite.

**Done when:** User knows what Studio/typing steps they must perform.

### 5. Register templates

Create or update the project's templates module. Two conventional locations:

| Module | Purpose |
|---|---|
| `src/client/ui/components/templates.ts` | Reusable UI kit (Button, Text, Panel, Avatar, etc.) |
| `src/client/ui/hud/templates.ts` | HUD-specific templates (Scoreboard, BoostGauge, etc.) |

Export every reusable root or child template with `ReactTemplate.fromInstance(...)` from `@lisachandra/react-template`.

**Done when:** Templates are exported from the correct templates module.

### 6. Build React from templates

Split the feature into a **5-file** module:

| File | Role |
|---|---|
| `[feature].connect.tsx` | ECS connector, machine wiring, data fetching |
| `[feature].machine.ts` | XState machine via `@rbxts/xstate` (`setup().createMachine()`) |
| `[feature].render.tsx` | Stateless renderer receiving `send`, `state` snapshot, + data bindings |
| `[feature].spec.tsx` | Jest test with `TestWrapper`, `@rbxts/react-testing-library` |
| `[feature].story.tsx` | Storybook with `StoryViewport`, `usePx`, `CreateReactStory` |

Use the `px` scaling utility (via `AppContext`) to **px-scale** template layouts at runtime. Do not hardcode layout sizes — pull the static baseline from the Studio template.

**Constants** in these files MUST use `new Constant()` from `@lisachandra/constant`. No plain object literals or top-level numeric/string exports.

**`px.fetch` quick reference:**

| Roblox Property | `px.fetch` form | Reads |
|---|---|---|
| `Size`, `Position` | `px.fetch(px.fromUDim2)` | UDim2 from template Instance |
| `TextSize` | `px.fetch()` | Number from template |
| `CornerRadius` | `px.fetch(px.fromUDim)` | UDim from template |
| `Padding` | `px.fetch(px.fromUDim)` | UDim from template |

`px(number)` is valid for hardcoded offsets (e.g., `px(15)`). For animations relative to a goal size, retrieve the goal using `px.fromUDim2(templateInstance.Size)` and Lerp.

**Done when:** Component consumes templates, uses `px.fetch` for layout properties, follows the 5-file structure, and uses `Constant` for grouped constants.

### 7. Validate and report handoff

- Always include testing tags (`Tag: "data-testid=..."`) in `templateChildren` properties.
- Provide a `.spec.tsx` that mounts the renderer with a `TestWrapper` providing `AppContext` (`px`, `screen`, `viewport` bindings), uses `@rbxts/react-testing-library` (`screen`, `render`), and tests machine transitions + renderer integration.
- Provide a `.story.tsx` that wraps the renderer in `StoryViewport` + `AppContext.Provider` with `usePx`, using `CreateReactStory` from `@rbxts/ui-labs`.

**Done when:** Spec and story files are provided and functional.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Ending with pure JSX after a template request | Register Instances and consume `ReactTemplate.fromInstance` exports. |
| Combining state logic and rendering | Split into `*Connector` and `*Renderer` components per the 5-file structure. |
| Missing `data-testid` tags | Always add testing tags to custom interactive descendants inside `templateChildren`. |
| Using plain objects or top-level exports for constants | Use `new Constant().add(...).build()` from `@lisachandra/constant`. |

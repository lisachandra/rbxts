# Agent Testing APIs

Use when a change touches package behavior, ECS, UI, networking, replication, or developer tooling.
Run repo checks first, then runtime proof when the behavior only exists in an engine.

## Source Of Truth

- Local Roblox docs: `./creator-docs` (submodule).
- Studio test sessions: `creator-docs/content/en-us/reference/engine/classes/StudioTestService.yaml`.
- Player-like input: `creator-docs/content/en-us/reference/engine/classes/VirtualInput.yaml`.
- Device simulation: `creator-docs/content/en-us/reference/engine/classes/StudioDeviceSimulatorService.yaml`.
- Assistant workflows: `creator-docs/skills/`.

## Pick Tool

| Need                               | Prefer                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Type / lint / build check          | `pnpm typecheck`, `pnpm lint`, `pnpm build`                               |
| One suite, one case                | `pnpm --filter @lisachandra/test-<name> test --testPathPattern <pattern>` |
| Every suite                        | `pnpm test`                                                               |
| Node tooling (`sandcastle`)        | `pnpm test:sandcastle` (`node:test` via `tsx`)                            |
| Runtime logs                       | `jest-output.log`, `game-output.log`, Studio Output                       |
| Player view                        | Screenshot, Assistant screenshot, Studio capture                          |
| Click/type/move/scroll/game input  | `VirtualInput` plugin/test harness or Assistant input                     |
| Exercise scenario                  | Assistant playtest agent                                                  |
| Solo scripted Play/Run             | `StudioTestService:ExecutePlayModeAsync` / `ExecuteRunModeAsync`          |
| Multi-client replication/authority | `StudioTestService:ExecuteMultiplayerTestAsync`                           |
| Add clients                        | `StudioTestService:AddPlayers`                                            |
| Disconnect client                  | `StudioTestService:CanLeaveTest` and `LeaveTest`                          |
| End scripted test                  | `StudioTestService:EndTest`                                               |
| Responsive UI/platform layout      | `StudioDeviceSimulatorService` plus screenshots/human review              |
| Rendering/memory/geometry/leaks    | Assistant Scene Analysis or `SceneAnalysisService`                        |
| Exact API context                  | Assistant Docs Search or `./creator-docs`                                 |

## Jest Roblox Notes

- Shared config: `jest.shared.ts` (`defineConfig` from `@isentinel/jest-roblox`); per-suite configs in
  `test/<name>/jest.config.ts`.
- Backend is `open-cloud`: the runner needs `ROBLOX_OPEN_CLOUD_API_KEY`, `ROBLOX_PLACE_ID`,
  `ROBLOX_UNIVERSE_ID`. Without them, suites cannot run locally — say so instead of guessing.
- `runInBand` is on, coverage is on, and `testTimeout` is 30s inside a 300s runner timeout: a hung
  suite is a real failure, not a slow machine.
- Tests import `describe`/`it`/`expect` from `@rbxts/jest-globals`, never from a global.
- `test.rbxl` is generated from the compiled test place; run `pnpm build:test` before a suite when
  package sources changed. `out/` artifacts are build output, not sources to fix.
- Setup file is `@lisachandra/test/out/setup`; shared helpers belong in `test/` (package
  `@lisachandra/test`).
- Node-only package tests are separate: `packages/sandcastle` uses `tsc` + `node:test` via `tsx`.

## Workflow Patterns

- Cross-device multiplayer: device profiles plus multiplayer test plus screenshots.
- Join/leave stress: stagger `AddPlayers`, use `LeaveTest`, verify cleanup/ownership/reconnection/replication.
- Orientation regression: test `Portrait`, `LandscapeLeft`, `LandscapeRight`.
- UI automation: virtual input, then screenshot/console verification.
- Scene performance: camera sweeps, frustum audits, geometry hotspots, Luau heap, leaked instances.

## StudioTestService Notes

- `ExecuteMultiplayerTestAsync` is plugin-only. Max 8 simulated clients.
- `ExecutePlayModeAsync`, `ExecuteRunModeAsync`, `ExecuteMultiplayerTestAsync` yield until test ends.
- Pass small serializable `args`; read with `GetTestArgs`.
- Call `EndTest` from server DataModel; return `"pass"` or failure reason.
- Call `CanLeaveTest` before `LeaveTest` from client DataModel.
- Do not rely on `GetTestArgs` from client LocalScripts; docs say it may fail there.

## Virtual Input Notes

- Use for real input stack behavior: buttons, text fields, menus, movement keys, camera controls, pointer gestures.
- Use `SendTextInput` for focused text fields.
- Use `SendMouseButton`, `SendMousePosition`, `SendPointerAction` for UI/viewport.
- Avoid CoreGui targets; methods throw against Roblox system UI.
- Prefer screenshot/log verification after interaction.

## Device Simulator Notes

- Use when UI, camera framing, touch/mouse affordance, safe layout, aspect ratio matter.
- Test at least desktop viewport and phone viewport for UI changes (`@lisachandra/ui` hooks such as
  `usePx` and `useWorldToScreen` are viewport-sensitive).
- `SetDeviceAsync`, `SetOrientationAsync`, `SetResolutionAsync`, `SetPixelDensityAsync`, `SetScalingModeAsync` only from Edit mode or Play Client.
- Stop simulation or restore defaults when persistent Studio session may be reused.

## Scene Analysis Notes

- Use Assistant Scene Analysis when runtime/edit-time scene cost matters.
- Ask for camera sweeps, frustum audits, geometry hotspots, memory owners, script heap, animation/audio memory, leaked unparented instances.
- Treat findings as diagnostic evidence. Convert broad optimization into follow-up work.

## Agent Verification Pattern

1. Run repo checks first: `pnpm typecheck` and `pnpm lint` for any change; `pnpm build` plus a
   selective suite (`--testPathPattern`) during implementation; full `pnpm test` on review. Include
   `pnpm test:sandcastle` when `packages/sandcastle` changed.
2. If Studio or Open Cloud credentials are available, ask the human for the runtime evidence Jest
   cannot cover.
3. UI: device simulation plus virtual input plus screenshots.
4. Networking/authority: multi-client `StudioTestService`; include join/leave when relevant.
5. Gameplay and replication: assistant playtest agent or a human exploratory pass, then deterministic
   logs/screenshots/scripted assertions for the critical paths.
6. Report what ran, what was observed, and the exact blockers (missing credentials, no Studio, unrunnable
   suite) — never imply a suite passed when it did not run.

## Debug Surfaces

- Matter: ECS world/entity/component/system and replication inspection (`packages/matter`).
- Platform documents: JSON Schema validation errors before they reach a DataStore.
- Sandcastle: run manifests/state under `.sandcastle/` and per-issue logs for agent-run failures.

## References

- `./creator-docs/content/en-us/studio/testing-modes.md`
- `./creator-docs/content/en-us/reference/engine/classes/StudioTestService.yaml`
- `./creator-docs/content/en-us/reference/engine/classes/VirtualInput.yaml`
- `./creator-docs/content/en-us/reference/engine/classes/StudioDeviceSimulatorService.yaml`
- `./creator-docs/skills/device-simulator/SKILL.md`
- `./creator-docs/skills/scene-analysis/`
- `./creator-docs/skills/docs-search/`
- https://devforum.roblox.com/t/new-studio-testing-apis-and-assistant-improvements/4657854

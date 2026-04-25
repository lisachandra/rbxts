---
name: ui-implementation
description: Patterns and conventions for implementing React UI in Godkin with ECS connectors, XState, scaling, animation, and template-based rendering.
---

# UI Implementation Guidelines

Reference patterns for implementing React UI in this codebase, based on `KDS` and `Wallclimb` style flows.

## Architecture & State Management

- **ECS integration**: Use a connector component (for example, `KDSConnector`) to bridge Matter ECS and React UI.
- **Per-frame sync**: Query ECS inside `useEventListener(RunService.Heartbeat)` (or equivalent) to keep UI state synchronized.
- **XState**: Use `useMachine` from `@rbxts/xstate-react` for non-trivial UI flow (`Open`, `Closed`, submenu states).
- **Snapshot handoff**: Pass `state` and `send` from connector to renderer.
- **Separation of concerns**:
  - `Connector`: data access, machine wiring, game-loop synchronization.
  - `Renderer`: presentation, animation, and template rendering.

```tsx
export function Connector() {
    const [state, send] = useMachine(machine);

    useEventListener(RunService.Heartbeat, () => {
        for (const [id, comp] of store.world.query(Components.MyComp)) {
            // Update state from ECS data
        }
    });

    return <Renderer state={state} send={send} />;
}
```

## Scaling & Positioning

- **Context**: Use `AppContext` for shared helpers such as `px`.
- **Pixel scaling**:
  - Use `px.fetch()` for number properties (for example, `TextSize`).
  - Use `px.fetch(px.fromUDim)` for `UDim` offsets.
  - Use `px.fetch(px.fromUDim2)` for `UDim2` offsets (`Size`, `Position`, and similar).
  - See `ui-properties-scaling.md` for the property-by-property list.
- **World-to-screen mapping**:
  - Use `Camera.WorldToViewportPoint()` for 3D-to-2D projection.
  - Scale with frustum math to preserve perspective behavior.

```ts
const [screenPos, onScreen] = camera.WorldToViewportPoint(worldPos);
const frustumHeight = math.tan(math.rad(camera.FieldOfView / 2)) * (screenPos.Z * 2);
const scale = camera.ViewportSize.Y / frustumHeight;
```

## Animations (Ripple / pretty-react-hooks)

- **API source of truth**: If usage is unclear, check DeepWiki docs for `littensy/ripple` and `littensy/pretty-react-hooks`.
- **`useMotion`**: Use `useMotion` from `@rbxts/pretty-react-hooks`.
  - Initialize with `const [value, motor] = useMotion(initialValue)`.
  - Update goals with `motor.spring(goal, config)` in effects.
- **Bindings**: Pass returned bindings directly to React props (`Transparency`, `Size`, `Position`, and similar).
- **Advanced reactions**: Use `useBindingListener` for non-bindable side effects (for example, recalculating `Path2D` control points).

## Templates & Components

- **ReactTemplate**: Import templates from `client/ui/templates` and use them as primary layout primitives.
- **`templateChildren`**: Override descendants, including nested properties and events.
- **Highlights**:
  - Create highlight instances via JSX (`<highlight />`) or an instance wrapper.
  - Set `Adornee` to attach to 3D objects.
  - Animate `FillTransparency` and `OutlineTransparency` via motion bindings.

```tsx
<highlight Adornee={part} FillTransparency={transparencyBinding} />
```

## Interaction

- **Template events**: Bind `Activated`, `MouseEnter`, and `MouseLeave` in `templateChildren.Event`.
- **Global input**: Use `useEventListener(UserInputService.InputBegan)` for click-outside and similar global behaviors.

## Optimization

- **Frame loop selection**: Use `RunService.PreRender` for smooth per-frame UI updates when visuals must track camera/world changes.
- **Raycast interactions**: Do per-frame raycasts when hover/selection depends on live 3D targeting.

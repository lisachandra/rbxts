---
name: react
description: UI development with React, react-template, Ripple, and XState integration. Use when creating or editing UI components, handling animations, or managing UI state.
---

# React UI Development

## When to use
Use this skill when:
- Creating or editing React components in `src/client/ui`.
- Using `@internal/react-template` to wrap Roblox Studio instances.
- Animating UI with `@rbxts/pretty-react-hooks` (Ripple).
- Managing UI state with `@rbxts/xstate-react`.
- Scaling UI for different screens using `AppContext` and `px`.

## When NOT to use
- Do not use for core game logic (use `godkin` skill).
- Do not use for server-side logic.

## Core Patterns

### 1. ReactTemplate & Studio-First Workflow
We use a "template-first" workflow where UI layout is built in Roblox Studio and wrapped in React.

**Pattern:**
1.  **Studio:** Create UI in `StarterGui` or `ReplicatedStorage`.
2.  **Export:** Ensure it's in `ReplicatedStorage.UI`.
3.  **Wrap:** Use `ReactTemplate.fromInstance` in `src/client/ui/templates.ts`.
4.  **Use:** Render the template, overriding properties via `templateChildren`.

```tsx
// src/client/ui/templates.ts
export const MyComponentTemplate = ReactTemplate.fromInstance(ReplicatedStorage.UI.MyComponent);

// Usage
<MyComponentTemplate
    Position={new UDim2(0.5, 0, 0.5, 0)}
    templateChildren={{
        Title: { Text: "Hello World" }, // Overrides child "Title"
        Container: {
            templateChildren: {
                Button: {
                    Event: { Activated: () => print("Clicked") }
                }
            }
        }
    }}
/>
```

### 2. Responsive Scaling (px)
Use `AppContext` and the `px` utility to scale UI elements based on viewport size.

**Pattern:**
-   **Hooks:** `const { px } = useContext(AppContext);`
-   **Values:** `px(20)` scales 20 pixels relative to the reference resolution (1920x1080).
-   **Templates:** Use `px.fetch()` for reactive template properties.

```tsx
const { px } = useContext(AppContext);

// Direct usage
const width = px(100);

// Template usage (reactive)
<MyTemplate
    Size={px.fetch(px.fromUDim2)} // Auto-scales UDim2 properties
    TextSize={px.fetch()}         // Auto-scales number properties
/>
```

### 3. Animations (Ripple)
Use `useMotion` from `@rbxts/pretty-react-hooks` for physics-based animations.

**Pattern:**
1.  **Hook:** `const [binding, motion] = useMotion(initialValue);`
2.  **Effect:** Update motion goal in `useEffect`.
3.  **Render:** Pass `binding` directly to properties (React handles bindings automatically).

```tsx
const [transparency, motion] = useMotion(1);

useEffect(() => {
    motion.tween(isVisible ? 0 : 1, { style: Enum.EasingStyle.Quad, time: 0.3 });
}, [isVisible]);

return <Frame Transparency={transparency} />;
```

### 4. XState Integration
Complex UI logic (HUDs, menus) should be driven by an XState machine.

**Pattern:**
1.  **Machine:** Define logic in `*.machine.ts`.
2.  **Component:** Use `useMachine` in the top-level component.
3.  **Renderer:** Pass `state` and `send` to a pure renderer component.

```tsx
// myUi.machine.ts
export const myMachine = setup({...}).createMachine({...});

// myUi.tsx
export function MyUi() {
    const [state, send] = useMachine(myMachine);
    return <MyUiRenderer state={state} send={send} />;
}

function MyUiRenderer({ state, send }) {
    const isOpen = state.matches("open");
    return (
        <MyTemplate
            Visible={isOpen}
            Event={{ Activated: () => send({ type: "CLOSE" }) }}
        />
    );
}
```

## Common Mistakes
-   **Hardcoded Pixels:** Never use raw numbers for `Offset` or `TextSize`. Always wrap in `px()`.
-   **Logic in Render:** Avoid complex logic in the render function. Move it to XState or hooks.
-   **Direct Instance Manipulation:** Do not modify Roblox instances directly. Use `ReactTemplate` props or `useBindingListener`.
-   **Missing Keys:** Always provide `key` when mapping lists, even in `templateChildren`.

## References
-   [ui-implementation](references/ui-implementation.md)
-   [ui-properties-scaling](references/ui-properties-scaling.md)
-   [react-template](references/react-template.md)
-   [xstate-routers](references/xstate-routers.md)
-   [performance](references/performance.md)

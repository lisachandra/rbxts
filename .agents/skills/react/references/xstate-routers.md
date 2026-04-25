---
name: xstate-routers
description: Integration of XState machines and routers in the Godkin UI.
---

# XState & Routers in UI

## XState Integration
Use `useMachine` from `@rbxts/xstate-react` to drive component state.

```tsx
import { useMachine } from "@rbxts/xstate-react";
import { myMachine } from "./my.machine";

function MyComponent() {
    const [state, send] = useMachine(myMachine);

    return (
        <frame
            Visible={state.matches("visible")}
        >
            <textbutton
                Activated={() => send({ type: "CLICK" })}
                Text={state.context.buttonText}
            />
        </frame>
    );
}
```

## Router Integration
The project uses a custom router for navigation.

```tsx
import { Router, Route, Switch } from "@internal/react-router";

function App() {
    return (
        <Router>
            <Switch>
                <Route path="/hud" component={HUD} />
                <Route path="/menu" component={Menu} />
            </Switch>
        </Router>
    );
}
```

## Combining XState and Routers
Machines can trigger navigation via actions, or navigation can trigger machine events.

```ts
// Machine action to navigate
actions: {
    goToMenu: () => {
        history.push("/menu");
    }
}
```

## Best Practices
- Use XState for complex UI logic (e.g., multi-step forms, interactive HUDs).
- Use Routers for high-level view management.
- Keep machine logic in `*.machine.ts` files.

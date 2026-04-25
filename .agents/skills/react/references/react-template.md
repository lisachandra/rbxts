---
name: react-template
description: Usage of @internal/react-template for creating React components from Roblox instances.
---

# react-template

`react-template` is a library that allows you to create React components from existing Roblox instances. This is the preferred way to build UI in Godkin.

## Basic Usage

```tsx
import ReactTemplate from "@internal/react-template";
import { ReplicatedStorage } from "@rbxts/services";

const { UI: ui } = ReplicatedStorage;

// Create a component from a template instance
export const MyTemplate = ReactTemplate.fromInstance(ui.MyTemplateInstance);

// Use it in a component
function MyComponent() {
    return (
        <MyTemplate
            Tag="data-testid=my-component"
            Position={UDim2.fromScale(0.5, 0.5)}
            templateChildren={{
                Title: {
                    Text: "Hello World",
                },
                Button: {
                    Event: {
                        Activated: () => print("Clicked!"),
                    },
                },
            }}
        />
    );
}
```

## Key Features
- **`Tag`**: Used for testing (e.g., `data-testid`).
- **`templateChildren`**: Allows overriding properties and events of children within the template.
- **`Event`**: Standard Roblox events (e.g., `Activated`, `MouseEnter`).
- **`Change`**: Standard Roblox property change events.

## Best Practices
- Keep templates in `ReplicatedStorage.UI`.
- Use `Tag` for all interactive elements to facilitate testing.
- Prefer `react-template` over manual JSX for complex layouts designed in Studio.

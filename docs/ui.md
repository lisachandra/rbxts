# @lisachandra/ui

React-based UI components and hooks for Roblox (`@rbxts/react`).

## Install

```bash
pnpm add @lisachandra/ui
```

Peer dependencies: `@lisachandra/types`, `@lisachandra/core`, `@rbxts/react`, `@rbxts/react-roblox`, `@rbxts/rewire`, `@rbxts/pretty-react-hooks`, `@rbxts/services`

---

## VirtualScroller

A virtualized list renderer — only renders items visible in the viewport.

```tsx
import { VirtualScroller } from "@lisachandra/ui";

function MyInventory() {
  return (
    <VirtualScroller
      itemCount={items.size()}
      itemHeight={48}
      renderItem={(index) => [<textlabel Text={items[index].name} />]}
    />
  );
}
```

Props:
| Prop | Type | Description |
|---|---|---|
| `itemCount` | `number` | Total number of items |
| `itemHeight` | `number` | Height of each item in pixels |
| `renderItem` | `(index: number \| string) => Array<ReactNode>` | Render function per item |
| `dynamic?` | `boolean` | If true, renders without wrapping frames |
| `persistentItems?` | `Array<number>` | Item indices to always render |
| `template?` | `FunctionComponent` | Custom scrolling frame template |
| `getKey?` | `(index: number) => string` | Custom key function |
| `itemNative?` | `InstanceProps<Frame>` | Native properties on each item frame |
| `native?` | `InstanceAttributes<ScrollingFrame>` | Native properties on the scrolling frame |

---

## AppContext

Provides `px` scaling methods and viewport bindings:

```tsx
import { AppContext } from "@lisachandra/ui";
import { useMemo, useState } from "@rbxts/react";
import { usePx } from "@lisachandra/ui";

function App() {
  const [viewport, setViewport] = useState(Vector2.zero);
  const px = usePx(viewport);

  const contextValue = useMemo(() => ({
    px,
    viewport,
    screen: useBinding(Vector2.zero),
  }), [px]);

  return (
    <AppContext.Provider value={contextValue}>
      {/* children */}
    </AppContext.Provider>
  );
}
```

### `px` Methods

| Method | Description |
|---|---|
| `px(value)` | Scale a number by the current pixel density |
| `px.floor(value)` | Scale and floor |
| `px.ceil(value)` | Scale and ceil |
| `px.even(value)` | Scale and round to nearest even |
| `px.scale(value)` | Multiply by scale factor (no rounding) |
| `px.fetch(fn?)` | Create a fetch function with optional mapper |
| `px.fromUDim(udim, fn?)` | Scale a UDim |
| `px.fromUDim2(udim2, fn?)` | Scale a UDim2 |

---

## Hooks

### `useWorldToScreen` / `projectWorldToScreen`

Project a 3D world position to 2D screen coordinates:

```tsx
import { useWorldToScreen, projectWorldToScreen } from "@lisachandra/ui";

// As a hook (reactive)
const screenPos = useWorldToScreen(
  useBinding(worldPosition),
  useBinding(new Vector2(100, 100)),
);

// Imperative
const result = projectWorldToScreen(worldPos, baseSize, px);
if (result?.onScreen) {
  frame.Position = result.position;
  frame.Size = result.size;
}
```

Returns: `{ onScreen: boolean, position: UDim2, size: UDim2 }`

### `usePx`

Pixel-density-aware scaling hook:

```tsx
import { usePx, computePx } from "@lisachandra/ui";

const px = usePx(viewportBinding);
// px(100) — scales 100 based on viewport
```

### `useProperty`

Track Instance property changes:

```tsx
import { useProperty } from "@lisachandra/ui";

// Returns [values, changeEvent] matching property order
const [size, position, change] = useProperty("Frame", "Size", "Position");

return (
  <frame Change={change}>
    {/* size and position are Binding<Vector2> values */}
  </frame>
);
```

### `usePropertyBinding`

Like `useProperty` but returns bindings instead of raw values:

```tsx
import { usePropertyBinding } from "@lisachandra/ui";

const [sizeBinding, posBinding, change] = usePropertyBinding("Frame", "Size", "Position");
```

### `useConstant`

Stable reference that survives re-renders:

```tsx
import { useConstant } from "@lisachandra/ui";

const id = useConstant(() => HttpService.GenerateGUID(false));
// id stays the same across renders
```

---

## Hot Reloader

```tsx
import { createAppHotReloader } from "@lisachandra/ui";

const reloader = createAppHotReloader({
  target: PlayerGui,
  moduleRoot: container,
  entryModuleName: "app",
  strictMode: true,
});

reloader.start();
```

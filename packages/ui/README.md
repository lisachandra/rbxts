# @lisachandra/ui

React components and hooks for Roblox UI, plus the `px` scaling system that keeps a design's pixel
values consistent across screen sizes.

## Sizing with `px`

The core idea: designs are authored at a fixed resolution, and `px()` converts those numbers into
viewport-relative pixels. Provide it once through `AppContext` and read it anywhere below.

```tsx
import type { AppContextObject } from "@lisachandra/ui";
import { AppContext, usePx } from "@lisachandra/ui";
import { useViewport } from "@rbxts/pretty-react-hooks";
import { useBinding, useMemo } from "@rbxts/react";

function App() {
	const viewport = useViewport(); // Binding<Vector2>, already subscribed
	const px = usePx(viewport);
	const [screen] = useBinding(Vector2.one);

	const value = useMemo<AppContextObject>(
		() => ({ px, screen, viewport }),
		[px, screen, viewport],
	);

	return <AppContext.Provider value={value}>{/* ... */}</AppContext.Provider>;
}
```

`px(value)` scales and rounds. The other forms exist because UI work constantly needs a specific
rounding rule: `px.floor` and `px.ceil` for edges, `px.even` for centred content that must land on even
numbers, and `px.fromUDim` / `px.fromUDim2` for values authored as `UDim`s.

`px.fetch()` is how templates scale their properties — it returns a `FetchValue` that
`@lisachandra/react-template` resolves, and it recomputes when the viewport changes:

```tsx
<MyFrameTemplate Size={px.fetch(px.fromUDim2)} TextSize={px.fetch()} />
```

If you only need the number, `computePx(viewport)` returns the scale factor.

## `VirtualScroller`

Renders only the rows in view, which is the difference between a 50-item inventory and a 5000-item one.

```tsx
import { VirtualScroller } from "@lisachandra/ui";

<VirtualScroller
	itemCount={items.size()}
	itemHeight={48}
	renderItem={(index) => [<textlabel Text={items[index].name} />]}
/>;
```

`itemHeight` must be uniform — that uniformity is what makes the maths cheap. Use `getKey` when rows
have stable identities, `persistentItems` for rows that must stay mounted (an item being dragged, for
example), and `dynamic` to render rows without the wrapper frames.

## Reading a component in the UI

`useComponentRecord` subscribes a component to an ECS component, giving it the change record rather than
a copy — so it re-renders on the frames where the data actually moved.

```tsx
import { Components } from "@lisachandra/matter";
import { useComponentRecord } from "@lisachandra/ui";

const record = useComponentRecord(clientEntityId, Components.GardenProgress);
```

This is the normal bridge between Matter and React: the UI reads component data, and mutations go
through messages rather than writing to the component directly.

## Screen projection

`useWorldToScreen` returns a `Binding<WorldToScreenResult>` that updates as the camera moves, so it can
go straight onto a prop:

```tsx
import { projectWorldToScreen, useWorldToScreen } from "@lisachandra/ui";

const projected = useWorldToScreen(worldPositionBinding, sizeBinding);

// or imperatively, when you already have a px function
const result = projectWorldToScreen(worldPos, baseSize, px);
if (result?.onScreen) {
	frame.Position = result.position;
}
```

`useWorldToScreen` reads `px` from `AppContext`, so it must render under a provider.
`projectWorldToScreen` returns `undefined` when the camera is missing or the point is behind it, and
`onScreen` is what you check before showing an off-screen indicator.

## Property and constant hooks

`useProperty` reads instance properties React does not own and hands back the `Change` handler to attach:

```tsx
const [size, position, change] = useProperty("Frame", "Size", "Position");
return <frame Change={change} />;
```

`usePropertyBinding` returns the same values as bindings. `useConstant(() => value)` gives a value a
stable identity across renders.

## Storybook support

`StoryViewport` reports its size to the story harness and, on unmount, destroys what the story left
behind — `ObjectCache` folders, `BasePart`s under `Workspace.Caches`, and the children of the crate
module in `ReplicatedStorage` — so stories do not leak instances between runs:

```tsx
<StoryViewport setViewport={setViewport}>{story}</StoryViewport>
```

# @lisachandra/react-template

Turns an existing Roblox `Instance` tree into a typed React component. The usual use is a `ScreenGui`
laid out in Studio: the designer edits it visually, and the code renders it as JSX with its properties
exposed as props.

```tsx
import ReactTemplate from "@lisachandra/react-template";
import { Players } from "@rbxts/services";

const playerGui = Players.LocalPlayer.WaitForChild("PlayerGui");
const MyScreen = ReactTemplate.fromInstance(playerGui.WaitForChild<ScreenGui>("MyScreen"));

<MyScreen />;
```

Every child of the instance becomes a named sub-template, so you can override individual pieces without
rebuilding the whole screen. Children are passed as a table keyed by instance name:

```tsx
<MyScreen>
	{{
		Title: { Text: "Inventory" },
		CloseButton: { BackgroundColor3: Color3.fromRGB(200, 60, 60) },
	}}
</MyScreen>
```

Pass `true` as the second argument to render the tree as a fragment instead of as a single instance —
useful when the root is a container you do not want in the output.

The generated component is memoised and forward-ref'd. In Studio it also subscribes to `Changed`, so
property edits made in the Explorer show up without a rebuild.

## Derived properties with `fetch`

`fetch` computes a property from other properties on the same instance, which is how a template reacts
to its own state:

```tsx
<MyFrame
	BackgroundColor3={ReactTemplate.fetch(
		(color) => color.Lerp(Color3.fromRGB(255, 0, 0), 0.5),
		"BackgroundColor3",
	)}
/>
```

The named properties are passed to the resolver in order. This is also the mechanism `@lisachandra/ui`
uses: `px.fetch()` returns a `FetchValue`, so sizing a template from the `px` scale is the same call:

```tsx
<MyFrameTemplate Size={px.fetch(px.fromUDim2)} />
```

## Checking a component

```ts
if (ReactTemplate.is(someComponent)) {
	// narrowed to FunctionComponent<TemplateProps<Instance>>
}
```

`ReactTemplate.is` is a Studio-only check — it decides by looking the component up in a registry that
`fromInstance` only populates when `RunService.IsStudio()`, so it returns `false` in a live game. Use it
for storybook and dev tooling, not for runtime branching.

`TemplateProps<T>` is the props type for an instance `T`, with nested instances mapped to nested
templates. `ExtendedInstanceProps<T>` adds `Event`, `Change`, `Tag`, and `ref` to the instance's own
properties. `ReactTemplate.children` is the key for declaring named child templates when a name collides
with a real property.

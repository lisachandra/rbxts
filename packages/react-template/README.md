# @lisachandra/react-template & @lisachandra/react-router

React utilities for Roblox UIs.

## @lisachandra/react-template

Generates React components from existing Roblox Instance hierarchies. Useful for converting ScreenGui layouts into type-safe React templates.

```bash
pnpm add @lisachandra/react-template
```

Peer dependencies: `@lisachandra/types`, `@rbxts/react`, `@rbxts/services`

### `ReactTemplate.fromInstance`

Convert a Roblox Instance tree into a React component:

```tsx
import ReactTemplate from "@lisachandra/react-template";

const screen = PlayerGui.WaitForChild("MyScreen");
const MyScreen = ReactTemplate.fromInstance(screen);

// Use like any React component
<MyScreen>
	<MyScreen.MyButton />
</MyScreen>;
```

### `ReactTemplate.fetch`

Create computed property values that react to instance changes:

```tsx
import ReactTemplate from "@lisachandra/react-template";

<MyFrame
	BackgroundColor3={ReactTemplate.fetch(
		(color) => color.Lerp(Color3.fromRGB(255, 0, 0), 0.5),
		"BackgroundColor3",
	)}
/>;
```

### `ReactTemplate.is`

Check if a value is a React template component:

```ts
if (ReactTemplate.is(someComponent)) {
	// someComponent is a valid template
}
```

### Type Helpers

```ts
import type { TemplateProps, ExtendedInstanceProps } from "@lisachandra/react-template";

// TemplateProps<T> includes children + extended props for any Instance type
const props: TemplateProps<Frame> = { ... };
```

---

## @lisachandra/react-router

A fork of `roact-router` ported to `@rbxts/react`. Provides client-side routing with a History API.

```bash
pnpm add @lisachandra/react-router
```

Peer dependencies: `@lisachandra/types`, `@rbxts/react`, `@rbxts/lemon-signal`, `@rbxts/services`

### `Router`

```tsx
import { Router } from "@lisachandra/react-router";

<Router>{/* Route-aware children */}</Router>;
```

Or with a custom History:

```ts
const history = new History(["/"]);
<Router history={history} />
```

### `useRouter`

Access the current location and history from any component:

```tsx
import { useRouter } from "@lisachandra/react-router";

function MyComponent() {
	const { location, history } = useRouter();
	// location.path, location.state
	// history.push("/new-path")
}
```

### `useRouteMatch`

Match the current path against a pattern:

```tsx
import { useRouteMatch } from "@lisachandra/react-router";

const match = useRouteMatch({ path: "/players/:playerId" });
if (match) {
	const playerId = match.playerId; // captured from URL
}
```

### `History`

Programmatic navigation:

```ts
import { History } from "@lisachandra/react-router";

const history = new History(["/"]);
history.push("/settings", { tab: "audio" });
history.goBack();
history.goForward();
history.replace("/new-path");
```

### `Path`

Pattern matching with parameter capture:

```ts
import { Path } from "@lisachandra/react-router";

const path = new Path("/users/:userId/posts/:postId");
const match = path.match("/users/42/posts/99");
// match = { userId: "42", postId: "99" }
```

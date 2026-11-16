# @lisachandra/react-router

A client-side router for React Roblox, forked from
[`roact-router`](https://github.com/Reselim/roact-router) and ported to `@rbxts/react`. Navigation is
in-memory — there is no URL bar, so `History` is the source of truth and the router just keeps React in
step with it.

## `Router` and `useRouter`

`Router` supplies the history stack and the active location to everything below it.

```tsx
import { Router } from "@lisachandra/react-router";

<Router>
	<App />
</Router>;
```

Descendants read it with `useRouter`:

```tsx
import { useRouter } from "@lisachandra/react-router";

function Nav() {
	const { location, history } = useRouter();

	return (
		<textbutton
			Text={`Go home (now at ${location.path})`}
			Event={{ Activated: () => history.push("/home") }}
		/>
	);
}
```

`Router` creates its own `History` if you do not pass one, which is the common case. Pass your own when
something outside the tree needs to navigate — a keyboard binding, a server message, or a deep link

```tsx
const history = new History(["/"]);
<Router history={history} />;
```

## `History`

A linear stack with a signal that fires on every change.

```ts
import { History } from "@lisachandra/react-router";

const history = new History(["/", "/players"]); // starts at the last entry
history.push("/settings", { tab: "audio" }); // navigate and carry state
history.replace("/new-path"); // replace, don't grow the stack
history.goBack();
history.goForward();
```

Pushing after going back discards the forward entries, as a browser would. `location` is
`{ path, state }`, and `onChanged` is a `Signal<[string, object]>` firing `(path, state)` — connect to
it directly when you need to react outside React.

## Not available yet

`Path` and `useRouteMatch` exist in the source but are not exported, and the matcher currently throws
rather than matching — see [#53](https://github.com/lisachandra/rbxts/issues/53) (finding N7). Until
that is fixed, read `location.path` from `useRouter` and branch on it yourself.

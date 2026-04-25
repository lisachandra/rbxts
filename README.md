<h3 align="center">
    <br />
    rbxts
</h3>

<p align="center">
    Shared Roblox rbxts packages for gameplay, ECS, UI, and platform integrations
</p>

---

`@lisachandra/rbxts` is a monorepo that provides reusable packages for Roblox games.

## Quick Start

```ts
import * as Core from "@lisachandra/core";
import * as Matter from "@lisachandra/matter";
import * as UI from "@lisachandra/ui";
import * as Platform from "@lisachandra/platform";
import * as Preset from "@lisachandra/preset";

// TODO: To be added
```

## Installation

```bash
npm install "@lisachandra/core";
npm install "@lisachandra/matter";
npm install "@lisachandra/ui";
npm install "@lisachandra/platform";
npm install "@lisachandra/preset";
```

## Packages

| Package | Description |
| --- | --- |
| [@lisachandra/core](packages/core) | Shared types, utilities, logger, and store primitives |
| [@lisachandra/matter](packages/matter) | Matter hooks, components, phases, startup, and systems APIs |
| [@lisachandra/ui](packages/ui) | Reusable UI components and hooks |
| [@lisachandra/platform](packages/platform) | Platform services and integrations (teleporter, docs, centurion) |
| [@lisachandra/preset](packages/preset) | Preset compositions and feature toggles |

## License

[MIT](LICENSE.md)

import type { AnyEntity, Component } from "@rbxts/matter";
import { component } from "@rbxts/matter";
import type { Janitor } from "@rbxts/janitor";

import type { ExcludePascalCaseProperties, ExtractData, Items as ItemDefinitions, ValidItemPath, } from "./items";
import { ComponentCtor, OptionalKeys } from "@rbxts/matter/lib/component";
import { typeAssertIs } from "@lisachandra/core/utils/type";
import { set } from "@rbxts/sift/Dictionary";
import Log from "@rbxts/log";

export type ExtractComponentData<T> = T extends (data?: infer D) => Component<object> ? D : never;

export interface ChangeRecord<T extends object> {
	new?: Component<T>;
	old?: Component<T>;
}

export interface Force {
	decayTime: number;
	direction: Vector3;
	magnitude: number;
	maxTorque: number;
}

export interface Item<P extends ValidItemPath = ValidItemPath> {
	amount: number;
	data: ExcludePascalCaseProperties<ExtractData<ItemDefinitions, P>>;
	guid: string;
	id: P;
	tool?: Tool;
}

// ──────────────────────────────────────────────
// Augmentable component type map
// External packages add entries via:
//   declare module "@lisachandra/matter/components" {
//	     interface Components {
//	       NPC: { health: number };
//	   	}
//   }
// }
// ──────────────────────────────────────────────
export interface Components {
	Profile: {
		janitor: Janitor,
		// eslint-disable-next-line ts/naming-convention -- Backpack is a child of Player.
		player: Player & { Backpack?: Backpack },
	},

	Items: {
		items: Array<Item>,
		model: Model,
		moved?: boolean,
	},

	Inventory: {
		items: Array<Item>,
	}

	Hotbar: {
		equipped: string,
		items: Array<Item>,
		order: Array<string>,
	}

	Stream: {
		container: Instance,
		value: "in" | "out",
	}

	Forces: {
		alignOrientation: AlignOrientation,
		linearVelocity: LinearVelocity,
		forces: Array<{
			force: Force,
			time: number,
		}>,
	}

	Sound: {
		id: number,
		/** Non-spatial — plays via SoundService.PlayLocalSound, skips emitter pipeline. */
		local?: boolean,
		/** @client */
		effects?: Array<Instance>,
		/** @client */
		emitter?: AudioEmitter,
		/** @client */
		players?: Array<AudioPlayer>,
	}

	Node: {
		model: BasePart,
		occupiedBy?: AnyEntity,
		type: number,
	}

	ReplicationScope: Array<{
		components: Array<ComponentKey>,
		ids: Array<AnyEntity>,
		mode: "exclude" | "include",
	}>,
}

export type ComponentKey = keyof Components;

type ComponentConstructor<T extends object> = {
	(data?: T): Component<T>
}

// ──────────────────────────────────────────────
// Runtime component registry
// ──────────────────────────────────────────────
export const Components = setmetatable({}, {
	__newindex: (tbl, key, value) => {
		if (rawget(tbl, key) !== undefined) {
			Log.Warn(`Component "${key}" is already registered.`);
			return
		}
		rawset(tbl, key, value);
	},
    __index: (key) => {
        Log.Warn(`Component "${key}" is not registered.`);
    },
	__metatable: "This metatable is locked"
}) as never as {
    [K in keyof Components]: ComponentConstructor<Components[K]>
}

export function isComponent<T extends ComponentKey>(
	object: N<Component<object>>,
	targetComponentKey: T,
): object is ReturnType<ComponentConstructor<Components[T]>> {
	return typeIs(object, "table") && getmetatable(object) === Components[targetComponentKey];
}

// ──────────────────────────────────────────────
// Built-in component factories
// ──────────────────────────────────────────────
Components.Profile = component<Components["Profile"]>("Profile")
Components.Items = component<Components["Items"]>("Items")
Components.Inventory = component<Components["Inventory"]>("Inventory", { items: [] })
Components.Hotbar = component<Components["Hotbar"]>("Hotbar", { items: [], order: [], equipped: "" })
Components.Stream = component<Components["Stream"]>("Stream")
Components.Sound = component<Components["Sound"]>("Sound")
Components.Node = component<Components["Node"]>("Node")
Components.Forces = component<Components["Forces"]>("Forces", { forces: [] } as never)
Components.ReplicationScope = component<Components["ReplicationScope"]>("ReplicationScope")

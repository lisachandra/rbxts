import type { AnyEntity, Component } from "@rbxts/matter";
import { component } from "@rbxts/matter";
import type { Janitor } from "@rbxts/janitor";

import type { ExcludePascalCaseProperties, ExtractData, Items as ItemDefinitions, ValidItemPath, } from "./items";
import { ComponentCtor, OptionalKeys } from "@rbxts/matter/lib/component";

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
//   declare module "@lisachandra/matter/out/components" {
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

type ComponentConstructor<T extends object> = (data?: OptionalKeys<T>) => Component<T>

// ──────────────────────────────────────────────
// Runtime component registry
// ──────────────────────────────────────────────
const componentMap = new Map<ComponentKey, ComponentCtor>();

/** Register a component factory so it is discoverable by string key. */
export function registerComponent(
	key: ComponentKey,
	comp: ComponentCtor,
): ComponentCtor {
	componentMap.set(key, comp);
	return comp;
}

/** Type-safe lookup of a component factory by its string key. */
export function getComponent<K extends ComponentKey>(key: K): ComponentConstructor<Components[K]> {
	return componentMap.get(key)! as ComponentConstructor<Components[K]>;
}

export function isComponent<T extends ComponentKey>(
	object: N<Component<object>>,
	targetComponentKey: T,
): object is ReturnType<ComponentConstructor<Components[T]>> {
	return typeIs(object, "table") && getmetatable(object) === getComponent(targetComponentKey);
}

// ──────────────────────────────────────────────
// Built-in component factories
// ──────────────────────────────────────────────
registerComponent("Profile", component<Components["Profile"]>("Profile"));
registerComponent("Items", component<Components["Items"]>("Items"));
registerComponent("Inventory", component<Components["Inventory"]>("Inventory", { items: [] }));
registerComponent("Hotbar", component<Components["Hotbar"]>("Hotbar", { items: [], order: [], equipped: "" }));
registerComponent("Stream", component<Components["Stream"]>("Stream"));
registerComponent("Sound", component<Components["Sound"]>("Sound"));
registerComponent("Node", component<Components["Node"]>("Node"));
registerComponent("Forces", component<Components["Forces"]>("Forces"));
registerComponent("ReplicationScope", component<Components["ReplicationScope"]>("ReplicationScope"));

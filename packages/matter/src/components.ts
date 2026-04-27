import type { AnyEntity, Component } from "@rbxts/matter";
import { component } from "@rbxts/matter";
import type { Janitor } from "@rbxts/janitor";

import type {
	ExcludePascalCaseProperties,
	ExtractData,
	Items as ItemDefinitions,
	ValidItemPath,
} from "./items";

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

export namespace Components {
	// Component interfaces defining the data structure for each component.

	export interface Profile {
		/** Janitor for managing cleanup tasks associated with the profile. */
		janitor: Janitor;
		/**
		 * The player associated with this profile. Optionally includes a
		 * Backpack.
		 */
		// eslint-disable-next-line ts/naming-convention -- Backpack is a child of Player.
		player: Player & { Backpack?: Backpack };
	}

	export interface Item<P extends ValidItemPath = ValidItemPath> {
		/** Quantity of the item. */
		amount: number;
		/** Item-specific data. */
		data: ExcludePascalCaseProperties<ExtractData<ItemDefinitions, P>>;
		/** Globally unique identifier for the item. */
		guid: string;
		/** Item ID. */
		id: P;
		/** Roblox Tool instance, if applicable. */
		tool?: Tool;
	}

	// This component should only contain one item.  Used for dropped items.
	export interface Items {
		/** Array containing the item data (should only have one entry). */
		items: Array<Item>;
		/** The Roblox Model representing the item in the world. */
		model: Model;
		/**
		 * Flag indicating if the item is currently being transferred. Prevents
		 * duplicate updates and cleanup issues.
		 */
		moved?: boolean;
	}

	export interface Inventory {
		/** List of items in the inventory. */
		items: Array<Item>;
	}

	export interface Hotbar {
		/** GUID of the currently equipped item. */
		equipped: string;
		/** List of items in the hotbar. */
		items: Array<Item>;
		/**
		 * @client
		 * Client-side order of hotbar items.
		 */
		order: Array<string>;
	}

	export interface Stream {
		/** Instance being streamed. */
		container: Instance;
		/** Whether an entity is streaming in or out. */
		value: "in" | "out";
	}

	export interface Forces {
		alignOrientation: AlignOrientation;
		linearVelocity: LinearVelocity;
		forces: Array<{
			force: Force;
			time: number;
		}>;
	}

	export interface Sound {
		id: number;
		/** @client */
		effects?: Array<Instance>;
		/** @client */
		emitter?: AudioEmitter;
		/** @client */
		players?: Array<AudioPlayer>;
	}

	export interface Node {
		/** The BasePart representing the node. */
		model: BasePart;
		/**
		 * @server
		 * Entity occupying the node (server-side only).
		 */
		occupiedBy?: AnyEntity;
		/** Type of the node (e.g., cover). */
		type: number;
	}

	export type ReplicationScope = Array<{
		components: Array<keyof typeof Components>;
		ids: Array<AnyEntity>;
		mode: "exclude" | "include";
	}>;

	export const Profile = component<Profile>("Profile");
	export const Items = component<Items>("Items");
	export const Inventory = component<Inventory>("Inventory", { items: [] });
	export const Hotbar = component<Hotbar>("Hotbar", { items: [], order: [], equipped: "" });
	export const Stream = component<Stream>("Stream");
	export const Sound = component<Sound>("Sound");
	export const Node = component<Node>("Node");
	export const Forces = component<Forces>("Forces")
	export const ReplicationScope = component<ReplicationScope>("ReplicationScope");
}

export function isComponent<T extends keyof typeof Components>(
	object: N<Component<object>>,
	targetComponentKey: T,
): object is ReturnType<(typeof Components)[T]> {
	return typeIs(object, "table") && getmetatable(object) === Components[targetComponentKey];
}

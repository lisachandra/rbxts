/**
 * Defines and registers custom Centurion types for entities. These types are
 * used for command argument parsing and validation.
 */
import type { SingleArgumentType } from "@rbxts/centurion";
import { ListTypeBuilder, TransformResult, TypeBuilder } from "@rbxts/centurion";
import type { AnyEntity } from "@rbxts/matter";
import { isEmpty } from "@rbxts/object-utils";
import RegExp from "@rbxts/regexp";
import { Players } from "@rbxts/services";

import { includes } from "@lisachandra/core/out/utils/string";
import { is } from "@lisachandra/core/out/utils/type";
import { store } from "@lisachandra/core/out/store";
import { Components } from "@lisachandra/matter";

const prefixRegexp = RegExp("^@([^()]+)(?:\\((.*)\\))?$");

function getEntitySuggestionsFunction<T>(
	includeEntities = false,
	includePlayers = false,
	includePrefix = true,
): NonNullable<SingleArgumentType<T>["suggestions"]> {
	return (_text: string, _executor: Player) => {
		const entities: Array<string> = [];
		if (includeEntities) {
			for (const [entityId] of store.world) {
				entities.push(tostring(entityId));
			}
		}

		const suggestions: Array<string> = [...entities];
		if (includePrefix) {
			suggestions.unshift("@me");
		}

		if (includePlayers) {
			const playerNames = Players.GetPlayers().map((player) => player.Name);
			for (const playerName of playerNames) {
				suggestions.push(playerName);
			}
		}

		return suggestions;
	};
}

function parsePrefix(prefix: string, args: string, executor: Player): N<Array<AnyEntity>> {
	const executorEntityId = executor.GetAttribute<AnyEntity>("serverEntityId")!;
	const accumulator: Array<AnyEntity> = [];

	if (prefix === "me") {
		accumulator.push(executorEntityId);
	} else if (prefix === "all" || prefix === "others") {
		for (const [entityId] of store.world) {
			if (prefix === "others" && entityId === executorEntityId) {
				continue;
			}

			accumulator.push(entityId);
		}
	} else if (prefix === "query") {
		const components = args
			.split(";")
			.map((key) => {
				if (!(key in Components) || !is<keyof typeof Components>(key)) {
					return;
				}

				return Components[key];
			})
			.filterUndefined();

		if (isEmpty(components)) {
			return;
		}

		for (const [entityId] of store.world.query(...components)) {
			accumulator.push(entityId);
		}
	} else if (prefix === "except" || prefix === "only") {
		const input = args.split(";");
		const result = Entities.transform(input, executor);

		if (!typeIs(result?.value, "table")) {
			return;
		}

		for (const entityId of result.value) {
			accumulator.push(entityId);
		}
	} else {
		return;
	}

	return accumulator;
}

/**
 * Base entity type. Transforms text input into an entity ID, verifying its
 * existence in the world.
 */
export const Entity = TypeBuilder.create<AnyEntity>("entity")
	.transform((text, executor) => {
		if (text === "@me") {
			// eslint-disable-next-line no-param-reassign -- allowed
			text = executor.Name;
		}

		// Attempt to get the entity ID from the player's attribute or parse it as a number.
		const entityId = (Players.FindFirstChild(text)?.GetAttribute<AnyEntity>("serverEntityId") ??
			tonumber(text)) as N<AnyEntity>;

		// Check if the entity ID is a number and exists in the world.
		return typeIs(entityId, "number") && store.world.contains(entityId)
			? TransformResult.ok(entityId)
			: TransformResult.err(`${text} Entity not found.`);
	})
	.suggestions(getEntitySuggestionsFunction(true, true, true))
	.markForRegistration()
	.build();

export const Entities = ListTypeBuilder.create<Array<AnyEntity>>("entities")
	.transform((input, executor) => {
		let entities: Array<AnyEntity> = [];

		for (const text of input) {
			if (includes(text, "@")) {
				const match = prefixRegexp.exec(text);
				const prefix = match?.[1];
				const args = match?.[2] ?? "";
				const parsedEntities = prefix !== undefined ? parsePrefix(prefix, args, executor) : undefined;

				if (!parsedEntities) {
					return TransformResult.err(`Prefix '${text}' is not valid.`);
				}

				if (prefix === "except") {
					entities = entities.filter((entity) => !parsedEntities.includes(entity));
				} else if (prefix === "only") {
					entities = entities.filter((entity) => parsedEntities.includes(entity));
				} else {
					for (const parsedEntity of parsedEntities) {
						entities.push(parsedEntity);
					}
				}
			}

			const result = Entity.transform(text, executor);
			if (typeIs(result?.value, "number")) {
				entities.push(result.value);
			}
		}

		// Filter duplicate entries
		entities = entities.filter((entityId, index) => entities.indexOf(entityId) === index);

		return TransformResult.ok(entities);
	})
	.suggestions((_text, executor) => {
		const suggestions = getEntitySuggestionsFunction(true, true, true)("", executor);
		suggestions.unshift("@all", "@others", "@query()", "@except()", "@only()");

		return suggestions;
	})
	.markForRegistration()
	.build();

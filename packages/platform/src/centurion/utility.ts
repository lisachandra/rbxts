import {
    type ListArgumentType,
    ListTypeBuilder,
    type SingleArgumentType,
    TransformResult,
    TypeBuilder,
} from "@rbxts/centurion";

import { is } from "@lisachandra/core/out/utils/type";

export function makeListableType<T extends defined>(
	name: string,
	userType: SingleArgumentType<T>,
): ListArgumentType<Array<T>> {
	return ListTypeBuilder.create<Array<T>>(name)
		.transform((input, executor) => {
			const transformed: Array<T> = [];

			for (const text of input) {
				const result = userType.transform(text, executor);
				if (!result.ok) {
					return result;
				}

				transformed.push(result.value);
			}

			return TransformResult.ok(transformed);
		})
		.suggestions((input, executor) => {
			if (!userType.suggestions) {
				return [];
			}

			let suggestions: Array<string> = [];
			for (const text of input) {
				for (const suggestion of userType.suggestions(text, executor)) {
					suggestions.push(suggestion);
				}
			}

			suggestions = suggestions.filter(
				(value, index) => suggestions.indexOf(value) !== index,
			);
			return suggestions;
		})
		.markForRegistration()
		.build();
}

export function makeEnumType<T extends string>(
	name: string,
	enums: Array<T>,
): SingleArgumentType<T> {
	const enumSet = new Set<T>(enums);
	return TypeBuilder.create<T>(name)
		.transform((text) => {
			return is<T>(text) && enumSet.has(text)
				? TransformResult.ok(text)
				: TransformResult.err(`Invalid ${name}: ${text}`);
		})
		.suggestions(() => enums)
		.markForRegistration()
		.build();
}

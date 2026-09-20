import {
	Components,
	createStreamDeserializer,
	InMemoryCodecStateReader,
} from "@lisachandra/matter";
import { describe, expect, it } from "@rbxts/jest-globals";

describe("createStreamDeserializer", () => {
	it("should deserialize Stream component using reader to query existing Stream value", () => {
		expect.assertions(1);

		const container = new Instance("Folder");
		const reader = new InMemoryCodecStateReader();
		reader.setComponent(
			200 as never,
			"Stream",
			Components.Stream({ container, value: "in" }) as never,
		);

		const deserializer = createStreamDeserializer(reader);
		const result = deserializer(
			{ container },
			42 as never,
			200 as never,
		) as Components["Stream"];

		expect(result.value).toBe("in");
	});

	it("should fall back to attribute-based value when reader has no component for the entity", () => {
		expect.assertions(1);

		const container = new Instance("Folder");
		const model = new Instance("Model");
		model.SetAttribute("serverEntityId", 42);
		model.Parent = container;

		// An InMemory reader with no Stream component: falls back to scanning children.
		const reader = new InMemoryCodecStateReader();

		const deserializer = createStreamDeserializer(reader);
		const result = deserializer({ container }, 42 as never, undefined) as Components["Stream"];

		expect(result.value).toBe("in");
	});
});

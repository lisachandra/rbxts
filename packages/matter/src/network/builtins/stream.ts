import { getInstanceWithAttribute } from "@lisachandra/core/utils/main";
import { equalsDeep } from "@rbxts/sift/Dictionary";

import { Components } from "../../components";
import { type ClientDeserializerFn, registry } from "../registry";
import { type CodecStateReader, defaultStateReader } from "../stateReader";

/** Payload structure for replicating the {@link Components.Stream} component. */
export interface StreamPayload {
	container: Instance;
}

/**
 * Builds the client-side deserializer for the {@link Components.Stream} component.
 *
 * @remarks
 *   When the client entity already has a Stream component, its existing `value` is preserved;
 *   otherwise the value is derived from whether a child instance carries the given `serverEntityId`
 *   attribute (`"in"` when found, `"out"` otherwise).
 * @param reader - Optional {@link CodecStateReader} for tests; defaults to the production
 *   store-backed reader.
 * @returns A deserializer for the Stream codec.
 */
export function createStreamDeserializer(
	reader?: CodecStateReader,
): ClientDeserializerFn<Components["Stream"], StreamPayload> {
	return (data, serverEntityId, clientEntityId) => {
		const stateReader = reader ?? defaultStateReader;
		const existing =
			clientEntityId !== undefined
				? stateReader.getComponent(clientEntityId, "Stream")
				: undefined;
		const value =
			(existing as unknown as undefined | Components["Stream"])?.value ??
			(getInstanceWithAttribute(
				data.container.GetChildren(),
				"serverEntityId",
				serverEntityId,
			) !== undefined
				? "in"
				: "out");

		return {
			container: data.container,
			value,
		};
	};
}

registry.register<Components["Stream"], StreamPayload>({
	component: Components.Stream,
	deserializer: createStreamDeserializer(),
	mode: "all",
	serializer: (record) =>
		!equalsDeep(record.old ?? {}, record.new ?? {})
			? {
					container: record.new!.container,
				}
			: false,
});

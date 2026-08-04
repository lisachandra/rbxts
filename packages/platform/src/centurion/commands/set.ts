import { getItemFromGUID } from "@lisachandra/matter/utils/item";
import type { CommandContext } from "@rbxts/centurion";
import { CenturionType, Command, Guard, Register } from "@rbxts/centurion";

import { adminOrDeveloper } from "../guards";

@Register()
/**
 * Admin command that sets property values on an ECS item identified by its GUID.
 *
 * @remarks
 *   Properties are parsed from a comma-separated `key:value` string. Supported value types are
 *   `string` and `number`.
 */
export class SetCommand {
	@Command({
		arguments: [
			{
				type: CenturionType.String,
				description: "The GUID of the item you want to modify.",
				name: "itemGuid",
			},
			{
				type: CenturionType.String,
				description:
					"The properties and values for the item you want to modify.\nFormat: key:value",
				name: "properties",
			},
		],
		description: "Set new values to an item's properties.",
		name: "set",
	})
	@Guard(adminOrDeveloper)
	/**
	 * Applies key-value property updates to the item matching the given GUID.
	 *
	 * @param _ - The command context (unused).
	 * @param guid - The GUID of the ECS item to modify.
	 * @param propertiesStr - Comma-separated `key:value` pairs (e.g. `health:100,speed:16`).
	 */
	public set(_: CommandContext, guid: string, propertiesStr: string): void {
		const item = getItemFromGUID(guid);
		if (!item) {
			return;
		}

		const properties = propertiesStr.split(",").map((str) => str.gsub("%s", "")[0].split(":"));
		for (const [key, value] of properties) {
			if (!typeIs(key, "string") || !(key in item.data)) {
				continue;
			}

			if (typeIs(item.data[key as never], "string")) {
				item.data[key as never] = value as never;
			} else if (typeIs(item.data[key as never], "number")) {
				item.data[key as never] = (tonumber(value) as never) ?? item.data[key as never];
			}
		}
	}
}

import type { CommandContext } from "@rbxts/centurion";
import { CenturionType, Command, Guard, Register } from "@rbxts/centurion";

import { getItemFromGUID } from "@lisachandra/matter/out/utils/item";
import { adminOrDeveloper } from "../guards";

@Register()
export class SetCommand {
	@Command({
		description: "Set new values to an item's properties.",
		name: "set",
		arguments: [
			{
				type: CenturionType.String,
				description: "The GUID of the item you want to modify.",
				name: "itemGuid",
			},
			{
				type: CenturionType.String,
				name: "properties",
				description:
					"The properties and values for the item you want to modify.\nFormat: key:value",
			},
		],
	})
	@Guard(adminOrDeveloper)
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

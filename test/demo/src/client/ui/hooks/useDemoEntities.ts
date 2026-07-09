import { store } from "@lisachandra/core";
import { Components} from "@lisachandra/matter";
import type { AnyEntity } from "@rbxts/matter";
import React, { useEffect, useState } from "@rbxts/react";
import { Players, RunService } from "@rbxts/services";

export function useLocalClientEntityId(): AnyEntity | undefined {
	const player = Players.LocalPlayer;
	const [entityId, setEntityId] = useState<AnyEntity | undefined>(player.GetAttribute<AnyEntity>("clientEntityId"));

	useEffect(() => {
		setEntityId(player.GetAttribute<AnyEntity>("clientEntityId"));
		const connection = player.GetAttributeChangedSignal("clientEntityId").Connect(() => {
			setEntityId(player.GetAttribute<AnyEntity>("clientEntityId"));
		});

		return () => connection.Disconnect();
	}, [player]);

	return entityId;
}

export function useGardenProgressEntityId(): AnyEntity | undefined {
	const [entityId, setEntityId] = useState<AnyEntity | undefined>();

	useEffect(() => {
		const refresh = () => {
			for (const [nextEntityId] of store.world.query(Components.GardenProgress)) {
				setEntityId(nextEntityId);
				return;
			}

			setEntityId(undefined);
		};

		refresh();
		const connection = RunService.Heartbeat.Connect(refresh);
		return () => connection.Disconnect();
	}, []);

	return entityId;
}

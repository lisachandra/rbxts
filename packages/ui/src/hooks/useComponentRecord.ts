import { store } from "@lisachandra/core";
import { type ChangeRecord, HookConnector } from "@lisachandra/matter";
import React, { useEffect, useState } from "@rbxts/react";
import type { AnyEntity } from "@rbxts/matter";
import type { Component } from "@rbxts/matter/lib/component";

/**
 * Retrieves a replicated component record for a given entity from React.
 *
 * @remarks
 * This hook does not query Matter's topologically-aware storage directly from
 * React. Instead, it seeds from `world.get(...)` when the entity exists and
 * subscribes through the runtime hook connector, which is serviced by a Matter
 * client system.
 *
 * @template T - Component payload type.
 * @param clientEntityId - The replicated client entity id, if available.
 * @param component - The component constructor to observe.
 * @returns The latest change record for that entity/component pair.
 */
// eslint-disable-next-line react/no-unnecessary-use-prefix -- allowed
export function useComponentRecord<T extends object>(
	clientEntityId: AnyEntity | undefined,
	component: () => Component<T>,
): N<ChangeRecord<T>> {
	const [record, setRecord] = useState<N<ChangeRecord<T>>>();

	useEffect(() => {
		if (clientEntityId === undefined) {
			setRecord(undefined);
			return;
		}

		if (store.world.contains(clientEntityId)) {
			const current = store.world.get(clientEntityId, component);
			if (current) {
				setRecord({ new: current, old: current });
			}
		}

		const requestId = HookConnector.addComponentRecordRequest(
			clientEntityId,
			component,
			(nextRecord) => setRecord(nextRecord as ChangeRecord<T>),
		);

		return () => {
			delete HookConnector.componentRecordRequests[requestId];
		};
	}, [clientEntityId, component]);

	return record;
}

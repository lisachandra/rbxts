import type { AnyEntity } from "@rbxts/matter";
import type { Component } from "@rbxts/matter/lib/component";
import { HttpService } from "@rbxts/services";

export interface HookRequest {
	callback: Callback;
	hook: unknown;
	parameters: Array<unknown>;
}

export interface ComponentRecordHookRequest {
	callback: (record: { new?: Component<object>; old?: Component<object> }) => void;
	component: () => Component<object>;
	entityId: AnyEntity;
}

export const HookConnector = {
	addRequest(
		hook: unknown,
		parameters: Array<unknown>,
		callback: Callback,
		discriminator?: string,
	): string {
		const requestId = discriminator ?? HttpService.GenerateGUID(false);

		HookConnector.requests[requestId] = {
			callback,
			hook,
			parameters,
		};

		return requestId;
	},

	addComponentRecordRequest<T extends object>(
		entityId: AnyEntity,
		component: () => Component<T>,
		callback: (record: { new?: Component<T>; old?: Component<T> }) => void,
		discriminator?: string,
	): string {
		const requestId = discriminator ?? HttpService.GenerateGUID(false);

		HookConnector.componentRecordRequests[requestId] = {
			callback: callback as never,
			component,
			entityId,
		};

		return requestId;
	},

	componentRecordRequests: {} as Record<string, ComponentRecordHookRequest>,
	requests: {} as Record<string, HookRequest>,
};

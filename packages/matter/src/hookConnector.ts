import { HttpService } from "@rbxts/services";

export interface HookRequest {
	callback: Callback;
	hook: unknown;
	parameters: Array<unknown>;
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

	requests: {} as Record<string, HookRequest>,
};

import { registerComponent, registry, type Components } from "@lisachandra/matter";
import { component } from "@rbxts/matter";

// TODO: Replace placeholder.
declare module "@lisachandra/matter/out/components" {
	interface Components {
		MatchState: {
			phase: string;
			blueScore: number;
			orangeScore: number;
			timeRemaining: number;
		};
	}
}

const matchState = component<Components["MatchState"]>("MatchState");

registerComponent("MatchState", matchState);

registry.register<Components["MatchState"], Components["MatchState"]>({
	component: matchState,
	mode: "all",
	deserializer: (data) => data,
	serializer: (record) => record.new,
});

import { AppContext, useWorldToScreen } from "@lisachandra/ui";
import { useCamera, useEventListener } from "@rbxts/pretty-react-hooks";
import React, { useBinding, useContext, useEffect, useMemo, useState } from "@rbxts/react";
import type { JSX } from "@rbxts/react";
import { RunService, Workspace } from "@rbxts/services";

function GardenMarker({ part }: { index: number; part: BasePart }): JSX.Element {
	const { px } = useContext(AppContext);
	const camera = useCamera();

	const [position, setPosition] = useBinding(part.Position.add(new Vector3(0, 4, 0)));
	const [size] = useBinding(new Vector2(2, 2));
	const screen = useWorldToScreen(position, size);

	const [label, setLabel] = useState(part.GetAttribute<string>("markerLabel") ?? "");

	const refresh = useMemo(
		() => () => {
			if (!part.Parent) {
				return;
			}

			setPosition(part.Position.add(new Vector3(0, 4, 0)));
			setLabel(part.GetAttribute<string>("markerLabel") ?? "");
		},
		[part],
	);

	useEffect(() => {
		refresh();
	}, [refresh]);

	useEventListener(camera?.GetPropertyChangedSignal("CFrame"), refresh);
	useEventListener(camera?.GetPropertyChangedSignal("ViewportSize"), refresh);
	useEventListener(part.GetPropertyChangedSignal("Position"), refresh);
	useEventListener(part.GetAttributeChangedSignal("markerLabel"), refresh);

	return (
		<textlabel
			AnchorPoint={new Vector2(0.5, 0.5)}
			BackgroundColor3={Color3.fromRGB(21, 33, 20)}
			BackgroundTransparency={0.25}
			BorderSizePixel={0}
			Font={Enum.Font.GothamMedium}
			Position={screen.map(({ position: screenPosition }) => screenPosition)}
			Size={UDim2.fromOffset(px(120), px(24))}
			Text={label}
			TextColor3={Color3.fromRGB(255, 255, 255)}
			TextSize={px(13)}
			Visible={screen.map(({ onScreen }) => onScreen && label.size() > 0)}
		/>
	);
}

export function WorldMarkers(): JSX.Element {
	const [parts, setParts] = useState<Array<BasePart>>([]);

	useEffect(() => {
		let elapsed = 0;
		const connection = RunService.Heartbeat.Connect((delta) => {
			elapsed += delta;
			if (elapsed < 0.25) {
				return;
			}

			elapsed = 0;
			const folder = Workspace.Maps.FindFirstChild<Folder>("GardenScraps");
			if (!folder) {
				setParts([]);
				return;
			}

			const nextParts = new Array<BasePart>();
			for (const descendant of folder.GetDescendants()) {
				if (!descendant.IsA("BasePart")) {
					continue;
				}

				const label = descendant.GetAttribute<string>("markerLabel") ?? "";
				if (label.size() === 0) {
					continue;
				}

				nextParts.push(descendant);
			}

			setParts(nextParts);
		});

		return () => {
			connection.Disconnect();
		};
	}, []);

	return (
		<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)}>
			{parts.map((part, index) => (
				<GardenMarker key={`${part.Name}-${index}`} index={index} part={part} />
			))}
		</frame>
	);
}

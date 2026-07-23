import { configureConstant } from "@lisachandra/constant";
pcall(() => {
	configureConstant("src/client/constants.json", {})
})

import { getInstanceByTree } from "@lisachandra/core/utils/main"
import React, { useEffect } from "@rbxts/react";
import type { JSX } from "@rbxts/react";
import { Workspace } from "@rbxts/services";

const crateModule = getInstanceByTree(...$getModuleTree("@rbxts/crate"))!;

interface Props extends React.PropsWithChildren {
	/** A callback function to set the viewport size. */
	setViewport: (value: Vector2) => void;
}

/**
 * Manages cleanup of temporary objects created during story rendering. This
 * includes destroying ObjectCache folders and clearing crates in
 * ReplicatedStorage.
 *
 * @param props - Component props, including a function to set viewport size.
 * @returns React fragment containing a hidden frame for viewport size updates
 *   and any children passed to the component.
 */
export function StoryViewport({ children, setViewport }: Readonly<Props>): JSX.Element {
	useEffect(() => {
		return () => {
			for (const objectCache of Workspace.GetDescendants()) {
				if (
					(objectCache.Name === "ObjectCache" && objectCache.IsA("Folder")) ||
					(objectCache.IsDescendantOf(Workspace.Caches) && objectCache.IsA("BasePart"))
				) {
					objectCache.Destroy();
				}
			}

			for (const instance of crateModule.GetChildren()) {
				instance.Destroy();
			}
		};
	}, []);

	return (
		<>
			<frame
				key="StoryViewport"
				Active={false}
				BackgroundTransparency={1}
				Interactable={false}
				Size={UDim2.fromScale(1, 1)}
				Visible={false}
				Change={{
					AbsoluteSize: (rbx) => {
						setViewport(rbx.AbsoluteSize);
					},
				}}
			/>
			{children}
		</>
	);
}

import { Components } from "@lisachandra/matter";
import { AppContext, useComponentRecord, VirtualScroller } from "@lisachandra/ui";
import React, { useContext, useEffect, useState } from "@rbxts/react";
import type { JSX } from "@rbxts/react";

import { useLocalClientEntityId } from "client/ui/hooks/useDemoEntities";

export function GardenNotifications(): JSX.Element {
	const { px } = useContext(AppContext);
	const entityId = useLocalClientEntityId();
	const notificationRecord = useComponentRecord(entityId, Components.NotificationState);
	const notification = notificationRecord?.new ?? notificationRecord?.old;
	const [messages, setMessages] = useState<Array<string>>(["Welcome to Garden Scraps"]);
	const [revision, setRevision] = useState(0);

	useEffect(() => {
		if (
			!notification ||
			notification.revision <= revision ||
			notification.latest.size() === 0
		) {
			return;
		}

		setRevision(notification.revision);
		setMessages((current) => {
			const nextMessage = [...current, notification.latest];
			while (nextMessage.size() > 6) {
				nextMessage.remove(0);
			}

			return nextMessage;
		});
	}, [notification, revision]);

	return (
		<frame
			AnchorPoint={new Vector2(1, 1)}
			BackgroundTransparency={1}
			Position={UDim2.fromScale(1, 1).add(UDim2.fromOffset(-px(16), -px(16)))}
			Size={UDim2.fromOffset(px(280), px(160))}
		>
			<VirtualScroller
				itemCount={messages.size()}
				itemHeight={px(24)}
				renderItem={(index) => {
					const message = messages[index as number] ?? "";
					return [
						<textlabel
							BackgroundColor3={Color3.fromRGB(29, 38, 27)}
							BackgroundTransparency={0.2}
							BorderSizePixel={0}
							Font={Enum.Font.Gotham}
							Size={UDim2.fromScale(1, 1)}
							Text={message}
							TextColor3={Color3.fromRGB(237, 246, 225)}
							TextSize={px(13)}
							TextXAlignment={Enum.TextXAlignment.Left}
						/>,
					];
				}}
			/>
		</frame>
	);
}

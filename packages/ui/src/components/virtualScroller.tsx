import type {
	FunctionComponent,
	InstanceAttributes,
	InstanceProps,
	JSX,
	ReactNode,
} from "@rbxts/react";
import React, { useCallback, useState } from "@rbxts/react";

const scrollMiddleImage = "rbxasset://textures/ui/Scroll/scroll-middle.png";

interface Props extends React.PropsWithChildren {
	/** Whether to render items dynamically without wrapping them in frames. */
	dynamic?: boolean;

	/**
	 * A function to generate a unique key for each item. If not provided, the item index will be
	 * used as a key.
	 */
	getKey?: (index: number) => void | string;

	/** The total number of items in the list. */
	itemCount: number;

	/** The height of each item in the list. */
	itemHeight: number;

	/** Native properties to apply to each item frame. */
	itemNative?: InstanceProps<Frame>;

	/** Native properties to apply to the scrolling frame. */
	native?: InstanceAttributes<ScrollingFrame>;

	/** An array of item indices to always render, regardless of their position in the viewport. */
	persistentItems?: Array<number>;

	/**
	 * A function that renders the content of each item. Receives the item index or key as an
	 * argument.
	 */
	renderItem: (index: number | string) => Array<ReactNode>;

	/** An optional custom template for the scrolling frame. */
	template?: FunctionComponent<InstanceProps<ScrollingFrame>>;
}

function computeElements(
	indexes: Array<number>,
	{
		dynamic,
		getKey,
		itemHeight,
		itemNative,
		renderItem,
	}: Readonly<Omit<Props, "native" | "children" | "template" | "itemCount" | "persistentItems">>,
): Record<string, ReactNode> {
	const elements: Record<string, ReactNode> = {};

	for (const index of indexes) {
		const key = (getKey ? getKey(index) : undefined) ?? `Index_${index}`;
		const element =
			(dynamic ?? false) ? (
				<>{[...renderItem(getKey ? key : index)]}</>
			) : (
				<frame
					{...({
						BackgroundTransparency: 1,

						LayoutOrder: index,
						Position: new UDim2(0, 0, 0, (index - 1) * itemHeight),
						Size: new UDim2(1, 0, 0, itemHeight),

						children: [...renderItem(getKey ? key : index)],

						...itemNative,
					} satisfies InstanceProps<Frame>)}
				/>
			);

		elements[key] = element;
	}

	return elements;
}

/**
 * A virtualized scroller component for efficient rendering of large lists. Only renders items that
 * are currently visible within the viewport.
 */
export function VirtualScroller({
	dynamic,
	getKey,
	itemCount,
	itemHeight,
	itemNative,
	native,
	persistentItems,
	renderItem,
	template,
}: Readonly<Props>): JSX.Element {
	const [windowSize, setWindowSize] = useState(Vector2.one);
	const [canvasPosition, setCanvasPosition] = useState(Vector2.one);

	let minIndex = 0;
	let maxIndex = -1;

	if (itemCount > 0) {
		minIndex = 1 + math.floor(canvasPosition.Y / itemHeight);
		maxIndex = math.ceil((canvasPosition.Y + windowSize.Y) / itemHeight);

		// Add extra on either side for seamless load
		minIndex = math.clamp(minIndex - 1, 1, itemCount);
		maxIndex = math.clamp(maxIndex + 1, 1, itemCount);
	}

	const indexes: Array<number> = persistentItems ?? [];

	for (const index of $range(minIndex, maxIndex)) {
		if (indexes.includes(index)) {
			continue;
		}

		indexes.push(index);
	}

	const elements: Record<string, ReactNode> = computeElements(indexes, {
		itemHeight,
		renderItem,
		...(dynamic !== undefined ? { dynamic } : {}),
		...(getKey !== undefined ? { getKey } : {}),
		...(itemNative !== undefined ? { itemNative } : {}),
	});

	const mergedProps: InstanceProps<ScrollingFrame> =
		template !== undefined
			? (native ?? {})
			: ({
					BackgroundColor3: Color3.fromRGB(46, 46, 46),
					BorderColor3: Color3.fromRGB(10, 10, 13),
					BorderSizePixel: 0,
					BottomImage: scrollMiddleImage,
					ClipsDescendants: true,
					MidImage: scrollMiddleImage,
					Position: new UDim2(),
					ScrollBarImageColor3: Color3.fromRGB(64, 64, 64),
					ScrollBarThickness: 12,
					Size: UDim2.fromScale(1, 1),
					TopImage: scrollMiddleImage,
					VerticalScrollBarInset: Enum.ScrollBarInset.ScrollBar,
					Visible: true,
					...native,
				} satisfies InstanceProps<ScrollingFrame>);

	const children = {
		...((mergedProps.children as object) ?? {}),
		...elements,
	};

	// eslint-disable-next-line @cspell/spellchecker, ts/naming-convention -- React JSX Element
	const Template = template ?? "scrollingframe";

	return (
		<Template
			CanvasSize={UDim2.fromOffset(0, itemCount * itemHeight)}
			Change={{
				AbsoluteWindowSize: (rbx: ScrollingFrame) => {
					setWindowSize(rbx.AbsoluteWindowSize);
				},

				CanvasPosition: useCallback(
					(rbx: ScrollingFrame) => {
						// Exit if the canvas hasn't moved enough to warrant rendering new items
						const distance = canvasPosition.sub(rbx.CanvasPosition).Magnitude;
						const minimum = itemHeight;

						if (distance < minimum) {
							return;
						}

						setCanvasPosition(rbx.CanvasPosition);
					},
					[canvasPosition, itemHeight],
				),
			}}
			{...mergedProps}
		>
			{children}
		</Template>
	);
}

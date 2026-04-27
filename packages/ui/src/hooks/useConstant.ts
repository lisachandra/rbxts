import { useRef } from "@rbxts/react";

interface ResultBox<T> {
	value: T;
}

export function useConstant<T>(factory: () => T): T {
	const ref = useRef<ResultBox<T>>();
	ref.current ??= { value: factory() };
	return ref.current.value;
}

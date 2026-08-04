import { distance as vectorDistance } from "./vector";

/**
 * Calculates the distance between two CFrames, taking the minimum of positional distance and
 * angular distance.
 *
 * @remarks
 *   Angular distance is calculated by converting both CFrames to Euler angles and computing the
 *   vector distance between them. Positional distance uses the vector distance of the CFrame
 *   positions.
 * @example
 * 	```ts
 * 	const dist = distance(part1.CFrame, part2.CFrame);
 * 	```;
 *
 * @param aCf - The first CFrame.
 * @param bCf - The second CFrame.
 * @returns The minimum of the positional distance and angular distance.
 */
export function distance(aCf: CFrame, bCf: CFrame): number {
	const positionDistance = vectorDistance(aCf.Position, bCf.Position);
	const angleDistance = vectorDistance(
		new Vector3(...aCf.ToEulerAnglesXYZ()),
		new Vector3(...bCf.ToEulerAnglesXYZ()),
	);
	return math.min(angleDistance, positionDistance);
}

import { distance as vectorDistance } from "./vector";

export function distance(aCf: CFrame, bCf: CFrame): number {
	const positionDistance = vectorDistance(aCf.Position, bCf.Position);
	const angleDistance = vectorDistance(
		new Vector3(...aCf.ToEulerAnglesXYZ()),
		new Vector3(...bCf.ToEulerAnglesXYZ()),
	);
	return math.min(angleDistance, positionDistance);
}

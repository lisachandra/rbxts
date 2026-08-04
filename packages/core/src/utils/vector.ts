/**
 * Reflects a vector off a surface.
 *
 * This function calculates the reflection of a vector (such as a bullet's direction) off a surface
 * defined by its normal vector. It uses the classic vector reflection formula.
 *
 * @param surfaceNormal - The normal vector of the surface. This vector should be normalized (unit
 *   length).
 * @param bulletNormal - The incoming vector (e.g., the direction of a bullet). This vector should
 *   be normalized.
 * @returns The reflected vector. This vector will be normalized. Formula used: R = V - 2 * (V ⋅ N)
 *   N Where:
 *
 *   - R is the reflected vector.
 *   - V is the incoming vector (`bulletNormal`).
 *   - N is the surface normal (`surfaceNormal`).
 *   - ⋅ represents the dot product. Further reading on vector reflection:
 *     https://mathworld.wolfram.com/Reflection.html.
 */
export function reflect(surfaceNormal: Vector3, bulletNormal: Vector3): Vector3 {
	return bulletNormal.sub(surfaceNormal.mul(bulletNormal.Dot(surfaceNormal)).mul(2));
}

/**
 * Calculates the Euclidean distance between two Vector3 positions.
 *
 * @example
 * 	```ts
 * 	const dist = distance(new Vector3(0, 0, 0), new Vector3(5, 0, 0)); // 5
 * 	```;
 *
 * @param aV - The first Vector3.
 * @param bV - The second Vector3.
 * @returns The magnitude of the difference between the two vectors.
 */
export function distance(aV: Vector3, bV: Vector3): number {
	return aV.sub(bV).Magnitude;
}

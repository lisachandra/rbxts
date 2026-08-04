/**
 * Iteratively interpolates across an array of Color3 values. Starts with the first color, then
 * lerps the result with the second, then the result with the third, and so on, using the same t
 * value each time.
 *
 * @param colors - An array of Color3 objects.
 * @param t - The interpolation factor (0 to 1) applied at each step.
 * @returns The final interpolated Color3 value.
 */
export function iterativeLerpColorArray(colors: Array<Color3>, t: number): Color3 {
	const numberColors = colors.size();

	// Handle edge cases: less than 1 color
	if (numberColors < 1) {
		/*
		 * No colors - return black or throw an error
		 * Example: return Color3.Black(); // or new Color3(0, 0, 0);
		 */
		warn("iterativeLerpColorArray called with no colors.");
		return new Color3(0, 0, 0); // Defaulting to black
	}

	// eslint-disable-next-line no-param-reassign -- Clamp t to the 0-1 range for each lerp step
	t = math.max(0, math.min(1, t));

	// Start with the first color
	let currentColor = colors[0]!;

	// Iteratively lerp with the remaining colors
	for (const index of $range(1, numberColors - 1)) {
		currentColor = currentColor.Lerp(colors[index]!, t);
	}

	return currentColor;
}

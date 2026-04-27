import { Workspace } from "@rbxts/services";

import { store } from "../store";

/**
 * Calculates the average of a list of numbers.
 *
 * @param numbers - The list of numbers.
 * @returns The average of the numbers.
 */
export function average(...numbers: Array<number>): number {
	const sum = numbers.reduce((accumulator, number) => accumulator + number, 0);
	return sum / numbers.size();
}

/**
 * Finds the closest number in a list to a given value.
 *
 * @param x - The value to compare against.
 * @param numbers - The list of numbers to search.
 * @returns The closest number in the list.
 */
export function closest(x: number, ...numbers: Array<number>): number {
	return numbers.reduce((closestNumber, number) => {
		return math.abs(x - number) < math.abs(x - closestNumber!) ? number : closestNumber;
	}, numbers[0])!;
}

/**
 * Finds the farthest number in a list from a given value.
 *
 * @param x - The value to compare against.
 * @param numbers - The list of numbers to search.
 * @returns The farthest number in the list.
 */
export function farthest(x: number, ...numbers: Array<number>): number {
	return numbers.reduce((farthestNumber, number) => {
		return math.abs(x - number) > math.abs(x - farthestNumber!) ? number : farthestNumber;
	}, numbers[0])!;
}

/**
 * Calculates the percentage of a value within a given range.
 *
 * @param x - The value to calculate the percentage for.
 * @param a - The start of the range.
 * @param b - The end of the range.
 * @returns The percentage of x within the range a to b.
 */
export function percentage(x: number, a: number, b: number): number {
	return 1 - (b - x) / (b - a);
}

/**
 * Rounds a number to a specified number of decimal places.
 *
 * @param n - The number to round.
 * @param decimals - The number of decimal places to round to.
 * @returns The rounded number.
 */
export function round(n: number, decimals: number): number {
	// Calculate the power of 10 for the specified decimals
	const power = 10 ** decimals;
	return math.floor(n * power) / power;
}

/**
 * Performs smoothstep interpolation between 0 and 1.
 *
 * @param a - The lower bound.
 * @param b - The upper bound.
 * @param x - The input value.
 * @returns The interpolated value between 0 and 1.
 */
export function smoothstep(a: number, b: number, x: number): number {
	if (x < a) {
		return 0;
	}

	if (x >= b) {
		return 1;
	}

	const newX = (x - a) / (b - a);
	return newX * newX * (3 - 2 * newX);
}

/**
 * Selects a random index from an array based on weighted probabilities.
 *
 * @param selections - An array of numbers representing the weight of each
 *   index.
 * @returns A randomly selected index based on the provided weights.
 */
export function weightRandom(...selections: Array<number>): number {
	const totalChances = selections.reduce((sum, chance) => sum + chance, 0);
	const number = math.random() * totalChances;

	let accumulated = 0;
	for (const index of $range(0, selections.size() - 1)) {
		accumulated += selections[index]!;
		if (number < accumulated) {
			return index;
		}
 	}

	return selections.size() - 1;
}

/**
 * Gets the synced server clock.
 *
 * @returns The synced server clock.
 */
export function getServerClock(this: void): number {
	const { serverStartClock, serverStartEpoch } = store.shared.getState();
	return serverStartClock + (Workspace.GetServerTimeNow() - serverStartEpoch);
}

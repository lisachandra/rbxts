/*
 * Prompt skills.
 *
 * The single reader of the label-to-skill configuration: resolves the
 * per-phase default skills plus any skills contributed by the issue's labels,
 * deduplicated and rendered as a bullet list for the phase prompt.
 */

import { config } from "../runtime.js";
import type { PhaseName } from "../types.js";

const globalPhaseSkills: Record<PhaseName, ReadonlyArray<string>> = config.skills.defaults;
const issueLabelSkills: Record<string, Partial<Record<PhaseName, ReadonlyArray<string>>>> = config
	.skills.labels;

/** Removes duplicate skills while preserving first-seen order. */
export const uniqueSkills = (skills: ReadonlyArray<string>): Array<string> => [...new Set(skills)];

/**
 * Renders the skills for a phase into a bullet list, merging the phase defaults with any skills
 * contributed by the supplied issue labels.
 *
 * @param phase - The phase to resolve skills for.
 * @param labels - Issue labels that may contribute additional skills.
 * @returns A newline-separated bullet list of deduplicated skills.
 */
export function skillsForPrompt(phase: PhaseName, labels: ReadonlyArray<string> = []): string {
	const skills = [...globalPhaseSkills[phase]];
	for (const label of labels) {
		for (const skill of issueLabelSkills[label]?.[phase] ?? []) {
			skills.push(skill);
		}
	}

	return uniqueSkills(skills)
		.map((skill) => `- ${skill}`)
		.join("\n");
}

import type { UserConfig } from "@commitlint/types";

const commitLintConfig: UserConfig = {
	extends: ["@commitlint/config-conventional"],
	rules: {
		"body-max-length": [2, "always", 10000],
		"body-max-line-length": [2, "always", 10000],
		"footer-max-length": [2, "always", 10000],
		"footer-max-line-length": [2, "always", 10000],
		"header-max-length": [2, "always", 10000],
		"scope-max-length": [2, "always", 10000],
		"subject-max-length": [2, "always", 10000],
		"type-max-length": [2, "always", 10000],
	},
};

export default commitLintConfig;

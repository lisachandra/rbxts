/* oxlint-disable typescript-js/naming-convention, unused-imports/no-unused-vars -- Oxlint config file */
import {
	GLOB_EXCLUDE,
	GLOB_MARKDOWN,
	GLOB_MARKDOWN_CODE,
	GLOB_SRC,
	GLOB_TESTS,
	GLOB_TS,
	GLOB_TSX,
	GLOB_YAML,
} from "@isentinel/eslint-config";
import type { Rules } from "@isentinel/eslint-config";
import { isentinel } from "@isentinel/eslint-config/oxlint";

import type { Linter } from "eslint";

// Mutable DummyRule tuple: `as const` is rejected by type-check (TS2322).
const noRestrictedSyntaxRule: ["error", ...Array<{ message: string; selector: string }>] = [
	"error",
	{
		message:
			"Use 'iterate' utility instead of 'pairs'. It enforces use of generalized iteration in Luau.\nIf you're working with mixed tables, refactor your code.",
		selector: "CallExpression[callee.name=/i?pairs/]",
	},
	{
		message: "Use 'delete' keyword instead of setting to 'undefined'.",
		selector:
			"ExpressionStatement[expression.type='AssignmentExpression'][expression.left.type='MemberExpression'][expression.right.type='Identifier'][expression.right.name='undefined']",
	},
	{
		message: "All function return tuples should have labels.",
		selector:
			"FunctionDeclaration > TSTypeAnnotation > TSTupleType > :not(TSNamedTupleMember):not(:has(TSNamedTupleMember))",
	},
	{
		message: "Use `for (const index of $range(...))`.",
		selector: "ForStatement",
	},
	{
		message:
			"Use 'includes' instead of '.find()[0] !== undefined' or '.find()[0] === undefined' patterns.",
		selector:
			"BinaryExpression:matches([operator='!=='], [operator='===']):has(Identifier[name='undefined']):has(:matches(CallExpression[callee.property.name='find'], ElementAccessExpression > CallExpression[callee.property.name='find']))",
	},
];

type ExtractRuleEntry<T> =
	T extends Linter.RuleEntry<infer _U> ? Extract<T, [unknown, ...Array<unknown>]>[1] : never;
type TSNamingConvention = ExtractRuleEntry<Rules["ts/naming-convention"]>;
type SelectorNamingConventionMap = {
	[K in Extract<Extract<TSNamingConvention, { selector: string }>["selector"], string>]: Array<
		Omit<Extract<TSNamingConvention, { selector: K }>, "selector">
	>;
};

const defaultNamingConvention = {
	default: [
		{ format: ["camelCase", "PascalCase"], modifiers: ["exported"] },
		{ format: ["camelCase"], leadingUnderscore: "allowSingleOrDouble" },
	],
	enumMember: [{ format: ["PascalCase"] }],
	function: [{ format: ["camelCase", "PascalCase"] }],
	import: [{ format: ["camelCase", "PascalCase"] }],
	interface: [
		{
			custom: { match: false, regex: "^I[A-Z]" },
			format: ["PascalCase"],
		},
	],
	memberLike: [{ format: null }],
	parameterProperty: [{ format: ["camelCase", "PascalCase"] }],
	property: [{ format: null }],
	typeLike: [{ format: ["PascalCase", "camelCase", "UPPER_CASE"] }],
	typeParameter: [{ format: ["PascalCase", "camelCase", "UPPER_CASE"] }],
	typeProperty: [{ format: null }],
	variableLike: [
		{
			format: ["PascalCase", "camelCase", "UPPER_CASE"],
			leadingUnderscore: "allowSingleOrDouble",
		},
	],
} satisfies Partial<SelectorNamingConventionMap>;

function transformNamingConventionMap(
	namingConventionMap: Partial<SelectorNamingConventionMap>,
): Rules["ts/naming-convention"] {
	const transformedRules: Array<TSNamingConvention> = [];
	for (const [selector, rules] of Object.entries(namingConventionMap) as Array<
		[keyof SelectorNamingConventionMap, undefined | Array<Record<string, unknown>>]
	>) {
		if (rules === undefined) {
			continue;
		}

		for (const rule of rules) {
			transformedRules.push({ selector: [selector], ...rule } as TSNamingConvention);
		}
	}

	return ["warn", ...transformedRules] as unknown as Rules["ts/naming-convention"];
}

// Kept referenced so the FIXME below can be re-enabled without restoring dead code.
void defaultNamingConvention;
void transformNamingConventionMap;

export default isentinel(
	{
		ignores: (originals) => [
			...originals,
			...GLOB_EXCLUDE,
			GLOB_MARKDOWN_CODE,
			".husky/install.mjs",
			"scripts/**",
			".agents/**",
			".diracrules/**",
			"submodules/**",
			"creator-docs/**",
			"**/out/**",
			"**/coverage/**",
			"**/.jest-roblox/**",
			".workspace-links/**",
			"**/pnpm-lock.yaml",
		],
		jsPlugins: [
			{
				name: "typescript-js",
				specifier: "@typescript-eslint/eslint-plugin",
			},
		],
		name: "project/options",
		options: {
			typeAware: false,
		},
		react: true,
		roblox: true,
		rules: {
			"arrow-style/arrow-return-style": "off",
			"comment-length/limit-multi-line-comments": "off",
			"comment-length/limit-single-line-comments": "off",
			"eslint-js/no-restricted-syntax": noRestrictedSyntaxRule,
			"eslint/max-lines": "off",
			"eslint/max-lines-per-function": "off",
			"eslint/no-console": "off",
			"id-length": "off",
			"jsdoc/convert-to-jsdoc-comments": "off",
			"no-inline-comments": "off",
			"perfectionist/sort-array-includes": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc" },
			],
			"perfectionist/sort-classes": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc", partitionByNewLine: true },
			],
			"perfectionist/sort-decorators": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc" },
			],
			"perfectionist/sort-enums": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc", partitionByNewLine: true },
			],
			"perfectionist/sort-exports": "warn",
			"perfectionist/sort-heritage-clauses": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc", partitionByNewLine: true },
			],
			"perfectionist/sort-imports": [
				"warn",
				{
					customGroups: [
						{ elementNamePattern: "^react$", groupName: "react" },
						{ elementNamePattern: "^@", groupName: "scoped" },
					],
					groups: [
						"react",
						"scoped",
						["type-builtin", "type-external", "value-builtin", "value-external"],
						[
							"type-internal",
							"value-internal",
							"type-parent",
							"type-sibling",
							"type-index",
							"value-parent",
							"value-sibling",
							"value-index",
						],
						"unknown",
					],
					newlinesBetween: 1,
				},
			],
			"perfectionist/sort-interfaces": [
				"warn",
				{
					type: "natural",
					customGroups: [{ elementNamePattern: "^(?:type)$", groupName: "top" }],
					groups: ["top", "unknown"],
					ignoreCase: false,
					order: "asc",
					partitionByNewLine: true,
				},
			],
			"perfectionist/sort-intersection-types": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc" },
			],
			"perfectionist/sort-jsx-props": [
				"warn",
				{
					type: "natural",
					customGroups: [
						{
							elementNamePattern: "^(?:key|children|ref|templateChildren)$",
							groupName: "react",
						},
					],
					groups: ["react", "unknown"],
					ignoreCase: false,
					order: "asc",
					partitionByNewLine: true,
				},
			],
			"perfectionist/sort-maps": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc", partitionByNewLine: true },
			],
			"perfectionist/sort-modules": "off",
			"perfectionist/sort-named-exports": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc", partitionByNewLine: true },
			],
			"perfectionist/sort-named-imports": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc", partitionByNewLine: true },
			],
			"perfectionist/sort-object-types": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc", partitionByNewLine: true },
			],
			"perfectionist/sort-objects": [
				"warn",
				{
					type: "natural",
					customGroups: [{ elementNamePattern: "^(?:type)$", groupName: "top" }],
					groups: ["top", "unknown"],
					ignoreCase: false,
					order: "asc",
					partitionByNewLine: true,
				},
			],
			"perfectionist/sort-sets": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc" },
			],
			"perfectionist/sort-switch-case": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc" },
			],
			"perfectionist/sort-union-types": [
				"warn",
				{ type: "line-length", ignoreCase: false, order: "asc" },
			],
			"perfectionist/sort-variable-declarations": [
				"warn",
				{ type: "natural", ignoreCase: false, order: "asc", partitionByNewLine: true },
			],
			// Mean of previously flagged non-sandcastle functions was ~24.14; keep outliers for source refactors.
			"sonar/cognitive-complexity": ["warn", 24],
			"sonar/no-commented-code": "warn",
			"sonar/no-dead-store": "warn",
			"sonar/no-duplicate-string": "off",
			"sonar/no-empty-collection": "off",
			"sonar/no-nested-conditional": "off",
			"style/multiline-comment-style": ["warn", "starred-block"],
			"style/spaced-comment": ["warn", "always", { exceptions: ["!native", "!optimize 2"] }],
			"unicorn/filename-case": ["error", { case: "camelCase" }],
			"unicorn/no-immediate-mutation": "off",
			"unicorn/no-keyword-prefix": "off",
			"unicorn/no-useless-undefined": "off",
		},
		test: {
			jest: true,
		},
		typescript: {
			tsconfigPath: "./tsconfig.json",
		},
	},
	// Global overrides to disable rules not in original config
	{
		files: [GLOB_TS, GLOB_TSX],
		name: "project/global-overrides",
		rules: {
			// FIXME: "typescript-js/naming-convention": transformNamingConventionMap(defaultNamingConvention),
			"better-max-params/better-max-params": "off",
			"eslint/max-lines": "off",
			"eslint/max-lines-per-function": "off",
			"eslint/no-console": "off",
			"eslint/no-empty-function": "off",
			"eslint/no-lone-blocks": "off",
			"eslint/prefer-const": "off",
			"oxc/no-barrel-file": "off",
			"react-jsx/no-useless-fragment": "off",
			"roblox/no-any": "off",
			"roblox/no-unsupported-syntax": "off",
			"roblox/no-user-defined-lua-tuple": "off",
			"typescript/max-params": "off",
			"typescript/no-empty-function": "off",
			"typescript/no-magic-numbers": "off",
			"typescript/no-require-imports": "off",
			"typescript/triple-slash-reference": "off",
			"typescript/unbound-method": "off",
			"unicorn-js/name-replacements": "off",
			"unicorn-js/no-break-in-nested-loop": "off",
			"unicorn-js/no-declarations-before-early-exit": "off",
			"unicorn-js/no-negated-array-predicate": "off",
			"unicorn-js/no-unreadable-for-of-expression": "off",
			"unicorn-js/no-unreadable-new-expression": "off",
		},
	},
	// Test file overrides
	{
		files: GLOB_TESTS,
		name: "project/test-react-overrides",
		rules: {
			"eslint/max-lines-per-function": "off",
			"id-length": "off",
			"jest-js/expect-expect": [
				"error",
				{
					additionalTestBlockFunctions: [],
					assertFunctionNames: ["expect"],
				},
			],
			"jest-js/max-expects": "off",
			"jest-js/no-conditional-expect": "off",
			"jest-js/no-conditional-in-test": "off",
			"jest-js/no-disabled-tests": "warn",
			"jest-js/no-duplicate-hooks": "off",
			"jest-js/no-hooks": "off",
			"jest-js/prefer-called-with": "off",
			"jest-js/prefer-ending-with-an-expect": "off",
			"jest-js/prefer-spy-on": "off",
			"jest-js/prefer-strict-equal": "off",
			"jest-js/require-hook": "off",
			"jest-js/unbound-method": "off",
			"max-classes-per-file": "off",
			"react-x/exhaustive-deps": "off",
			"react-x/immutability": "off",
		},
	},
	// Markdown/YAML overrides — disable rules that don't work on these file types
	{
		files: [GLOB_MARKDOWN, GLOB_YAML],
		name: "project/markdown-yaml-overrides",
		rules: {
			"perfectionist/sort-modules": "off",
			"unicorn/filename-case": "off",
			"unicorn/no-useless-undefined": "off",
		},
	},
	{
		files: [`!src/${GLOB_SRC}, ${GLOB_SRC}`],
		name: "project/non-roblox",
		rules: {
			"eslint-js/no-restricted-syntax": "off",
			"roblox/lua-truthiness": "off",
			"roblox/misleading-lua-tuple-checks": "off",
			"roblox/no-any": "off",
			"roblox/no-array-pairs": "off",
			"roblox/no-enum-merging": "off",
			"roblox/no-export-assignment-let": "off",
			"roblox/no-for-in": "off",
			"roblox/no-function-expression-name": "off",
			"roblox/no-get-set": "off",
			"roblox/no-implicit-self": "off",
			"roblox/no-invalid-identifier": "off",
			"roblox/no-namespace-merging": "off",
			"roblox/no-null": "off",
			"roblox/no-object-math": "off",
			"roblox/no-post-fix-new": "off",
			"roblox/no-preceding-spread-element": "off",
			"roblox/no-private-identifier": "off",
			"roblox/no-undeclared-scope": "off",
			"roblox/no-unsupported-syntax": "off",
			"roblox/no-user-defined-lua-tuple": "off",
			"roblox/no-value-typeof": "off",
			"roblox/prefer-get-players": "off",
			"roblox/prefer-task-library": "off",
			"roblox/size-method": "off",
		},
	},
	/*
	 * rbxts legacy baseline — rules the existing codebase cannot satisfy yet.
	 * The @isentinel oxlint bridge escalates configured severities to errors,
	 * so these are disabled instead of warned; revisit as code is migrated.
	 */
	{
		files: [GLOB_TS, GLOB_TSX],
		name: "rbxts/legacy-baseline",
		rules: {
			"import/newline-after-import": "off",
			"jsdoc-js/informative-docs": "off",
			"jsdoc-js/no-undefined-types": "off",
			"jsdoc-js/require-description-complete-sentence": "off",
			"oxc/no-accumulating-spread": "off",
			"oxfmt/oxfmt": "off",
			"react-x/exhaustive-deps": "off",
			"react-x/immutability": "off",
			"react-x/no-array-index-key": "off",
			"react-x/no-missing-key": "off",
			"react-x/refs": "off",
			"react-x/set-state-in-effect": "off",
			"react-x/set-state-in-render": "off",
			"sonar/cognitive-complexity": "off",
			"typescript/no-non-null-asserted-optional-chain": "off",
			"typescript/no-non-null-assertion": "off",
			"unicorn-js/no-unused-properties": "off",
			"unicorn-js/prefer-simple-condition-first": "off",
			"unicorn/filename-case": "off",
		},
	},
);

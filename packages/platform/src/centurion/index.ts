/**
 * Centurion integration barrel for `@lisachandra/platform`.
 *
 * Importing this module triggers side-effect registration of all platform commands (via `@Register`
 * decorators) and types (via `markForRegistration`). Re-exports the type identifier map, guards,
 * and utility builders so consumers can reference everything from a single import.
 *
 * @example
 * 	```ts
 * 	// Pattern B — compile-time registration (all decorators evaluated on import):
 * 	import "@lisachandra/platform/centurion";
 *
 * 	const server = Centurion.server({ ... });
 * 	server.start(); // register() discovers all commands and types
 * 	```;
 *
 * @example
 * 	```ts
 * 	// With named imports:
 * 	import {
 * 		CenturionUserType,
 * 		configureCenturionGroup,
 * 		adminOrDeveloper,
 * 	} from "@lisachandra/platform/centurion";
 * 	```;
 */
import "./commands";
import "./types";

export * from "./guards";
export { CenturionUserType, registerCenturionType } from "./type";
export type { CenturionUserTypeKey, CenturionUserTypes } from "./type";
export * from "./utility";

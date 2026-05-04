import { values } from "@rbxts/sift/out/Dictionary";

import * as types from "./types";

/**
 * Aggregate of all custom Centurion user-type names exported from
 * `./types`, used to register types with the Centurion command framework.
 */
export const CenturionUserType = values(types).map((userType) => userType.name);

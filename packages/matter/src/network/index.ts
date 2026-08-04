/*
 * Auto-register all builtin replication codecs on import.
 * Order matters: registry must be loaded before builtins.
 */
import "./registry";
import "./builtins";

export * from "./messaging";
export * from "./registry";

/*
 * Marker completion proxy.
 *
 * Wraps any @ai-hero/sandcastle provider so its command is executed through
 * `assets/agent-wrapper.sh`, which checks the completion marker after a clean
 * exit and prints a protocol line. This proxy uses that line to flush the
 * accumulated stream output as a final result event, so structured output like
 * the `<plan>` block survives even when intermediate card results overwrite the
 * orchestrator's `resultText`.
 */

import type { AgentProvider, PrintCommand } from "@ai-hero/sandcastle";

import { packageRoot } from "../runtime.js";

/** Protocol line printed by `assets/agent-wrapper.sh` after a marker-backed run finishes. */
export const MARKER_PROTOCOL_LINE = '{"sandcastleMarker":"completed"}';

type StreamEvent = ReturnType<AgentProvider["parseStreamLine"]>[number];

/** Single-quote a value for use inside a `bash` command string. */
export function shellEscape(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export function withMarkerCompletion(inner: AgentProvider, markerPath: string): AgentProvider {
	const markerEnv = {
		SANDCASTLE_MARKER_COMPLETED: markerPath.replaceAll("\\", "/"),
	};
	const wrapperPath = `${packageRoot}/assets/agent-wrapper.sh`.replaceAll("\\", "/");
	let textBuffer = "";
	let resultEmitted = false;

	const parseProtocol = (line: string): Array<StreamEvent> => {
		if (resultEmitted || line.trim() !== MARKER_PROTOCOL_LINE) {
			return [];
		}

		resultEmitted = true;
		return [{ type: "result", result: textBuffer }];
	};

	return {
		...(inner.buildInteractiveArgs !== undefined
			? { buildInteractiveArgs: inner.buildInteractiveArgs }
			: {}),
		buildPrintCommand(options): PrintCommand {
			const innerCommand = inner.buildPrintCommand(options);
			const useStdin = innerCommand.stdin !== undefined;
			const command = `bash ${shellEscape(wrapperPath)}${useStdin ? " --stdin" : ""} -- ${shellEscape(innerCommand.command)}`;
			return {
				command,
				stdin: options.prompt,
			};
		},
		captureSessions: inner.captureSessions,
		env: { ...inner.env, ...markerEnv },
		name: inner.name,
		...(inner.parseSessionUsage !== undefined
			? { parseSessionUsage: inner.parseSessionUsage }
			: {}),
		parseStreamLine(line: string): Array<StreamEvent> {
			const innerEvents = inner.parseStreamLine(line);
			for (const event of innerEvents) {
				if (event.type === "text") {
					textBuffer += event.text;
				} else if (event.type === "result") {
					textBuffer += event.result;
				}
			}

			return [...innerEvents, ...parseProtocol(line)];
		},
		sessionStorage: inner.sessionStorage,
	};
}

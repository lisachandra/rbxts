/* Marker completion proxy: runs a provider's command through the marker-checking wrapper. */

import type { AgentProvider, PrintCommand } from "@ai-hero/sandcastle";

import { toShellCommand } from "../child-process.js";
import { packageRoot } from "../runtime.js";

/** Protocol line printed by `assets/agent-wrapper.sh` after a marker-backed run finishes. */
export const MARKER_PROTOCOL_LINE = '{"sandcastleMarker":"completed"}';

type StreamEvent = ReturnType<AgentProvider["parseStreamLine"]>[number];

/**
 * - Wraps a provider so its command runs inside the marker-checking wrapper.
 * - @param inner - The provider whose command line, stream parser, and session storage to keep.
 * - @param markerPath - Completion marker this phase must create; handed to the wrapper as an env
 *   var.
 * - @returns A provider that behaves like `inner` except for the points below.
 * - @remarks Three things change, and the first two are the contract a caller depends on:
 *
 *   1. **The command goes through `assets/agent-wrapper.sh`.** The wrapper runs the inner command
 *      unchanged, then checks `markerPath` after a clean exit and prints {@link MARKER_PROTOCOL_LINE}
 *      if it exists. A wrapped phase that never writes its marker therefore ends without the protocol
 *      line, which is how `runMarkerPhase` tells a finished attempt from a killed one.
 *   2. **`parseStreamLine` emits the whole accumulated stream as one `result` event**, once, when it
 *      sees that protocol line. The buffer is what makes structured output survive: an intermediate
 *      card emits its own `result` upstream, which overwrites the orchestrator's `resultText`, so the
 *      `<plan>` block would be lost without a final flush of everything seen.
 *   3. **`SANDCASTLE_MARKER_COMPLETED` is added to `inner.env`**, with forward slashes, because the
 *      wrapper is a bash script reading it as a path.
 *
 *   Everything else — the interactive args, `captureSessions`, `name`, `parseSessionUsage`,
 *   `sessionStorage` — is the inner provider's, re-exposed only when it was defined. `stdin` is set
 *   to `options.prompt` unconditionally, which is harmless for a provider that embeds the prompt in
 *   argv: the wrapper only reads that stdin when it was given `--stdin`, and `--stdin` is added
 *   exactly when the inner command declared `stdin` of its own. So a prompt never arrives twice.
 * - @example
 *
 *   ```ts
 *   const provider = withMarkerCompletion(
 *   	diracProvider("glm-4.6"),
 *   	"/repo/.sandcastle/markers/425.design.completed",
 *   );
 *   ```
 */
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
			const args = [
				wrapperPath,
				...(useStdin ? ["--stdin"] : []),
				"--",
				innerCommand.command,
			];
			return {
				/*
				 * `toShellCommand` quotes the inner command as one argument, so the wrapper receives
				 * it as a single argv entry and passes it on without re-evaluating it. The pre-`--`
				 * arguments are flags the wrapper parses itself, which is why they stay separate
				 * rather than being folded into the payload.
				 */
				command: toShellCommand({ args, file: "bash" }),
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

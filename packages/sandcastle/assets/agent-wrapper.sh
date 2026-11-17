#!/usr/bin/env bash
# Generic Sandcastle agent wrapper.
#
# Captures the prompt from stdin, runs the inner provider command, and after a
# clean exit verifies the completion marker. On success it prints a protocol
# line the provider uses to flush the accumulated stream output.

set -euo pipefail

USE_STDIN=0
if [[ "${1:-}" == "--stdin" ]]; then
	USE_STDIN=1
	shift
fi

if [[ "${1:-}" != "--" ]]; then
	echo "agent-wrapper.sh: expected '--' before the inner command" >&2
	exit 2
fi
shift

if [[ $# -eq 0 ]]; then
	echo "agent-wrapper.sh: no inner command after '--'" >&2
	exit 2
fi

PROMPT_FILE=$(mktemp)
trap 'rm -f "$PROMPT_FILE"' EXIT
cat > "$PROMPT_FILE"

# The inner command is one already-quoted command line the provider built with
# `toShellCommand`, so it needs exactly one evaluation: `"$1"`, not `"$*"`.
#
# `INNER_COMMAND="$*"` joined every remaining argument with a space before handing the result to
# `bash -c`, so argument boundaries the provider established were destroyed and then re-parsed. A
# provider that passed the command and a value as two argv entries got them merged into one shell
# word sequence, and the wrapper re-split them — one quoting layer protecting two parses. Evaluating
# only `$1` means the payload is never re-joined, and any further arguments are ignored rather than
# silently folded into the command.
set +e
if [[ $USE_STDIN -eq 1 ]]; then
	bash -c "$1" < "$PROMPT_FILE" 2>&1
else
	bash -c "$1" 2>&1
fi
status=$?
set -e

if [[ $status -eq 0 ]]; then
	if [[ -f "${SANDCASTLE_MARKER_COMPLETED:-}" ]]; then
		printf '%s\n' '{"sandcastleMarker":"completed"}'
	else
		echo "Sandcastle error: completion marker not found at ${SANDCASTLE_MARKER_COMPLETED:-}" >&2
		status=1
	fi
fi

exit "$status"

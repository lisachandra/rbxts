# Task

Resolve the active Git merge conflict in integration `{{INTEGRATION_NAME}}`.

## Required skill

Use the `resolving-merge-conflicts` skill for this phase:

{{SKILLS}}

Do not abort the merge. Preserve both sides where compatible, inspect the primary sources, and resolve every conflict in favor of the integration's stated goal.

## Source context

The source being merged is `{{SOURCE_NAME}}`:

```json
{{SOURCE_CONTEXT}}
```

Read the source manifests and relevant commit history when needed. The current worktree is already in an in-progress merge. Do not reset, checkout away changes, or discard either side.

## Required completion steps

1. Inspect `git status`, the unmerged paths, and the merge history.
2. Read the relevant project instructions and primary source files for each conflict.
3. Resolve every conflict without leaving conflict markers.
4. Stage the resolved files and complete the merge commit with `git merge --continue` or an equivalent commit.
5. Run the narrowest relevant validation available.
6. Verify `git diff --name-only --diff-filter=U` prints no paths.

The orchestration will verify the merge commit and preserve the worktree if you cannot finish.

## Completion

When every required step above is finished, create the completion marker as your final action:

```
mkdir -p "{{MARKER_DIR}}" && touch "{{MARKER_PATH}}"
```

Do not create the marker before finishing. Do not output a completion token or the marker path in your final response.

Before creating the marker, make sure any processes you spawned have exited or been terminated. After the marker is created, do not spawn or wait on any subprocesses or background jobs — stop immediately.

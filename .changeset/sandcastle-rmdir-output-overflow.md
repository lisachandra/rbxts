---
"@lisachandra/sandcastle": patch
---

Stop `rmdir`'s own output from killing a worktree removal mid-way

`removeWithRmdir` piped `cmd /c rmdir /s /q` through `execFileSync`, which buffers a child's output
against a 1 MiB `maxBuffer`. `rmdir` prints one line per path it cannot delete, and on a worktree with
submodules that overflowed: the `ENOBUFS` kill arrived roughly two minutes in, with the tree
half-deleted — `.git` gone, everything else still there — and the throw was swallowed by the
deliberate `catch`, so nothing was reported.

That state is unrecoverable through the old path. `removeWorktree` then fell through to
`unlinkWorktreeLinks` and `git worktree remove`, and git refuses a path it cannot validate
("cannot remove working tree: '<path>/.git' does not exist"). The worktree could never be removed, and
every retry repeated the same two minutes of silent work. To an operator it looked like a hang.

- `rmdir`'s output is discarded rather than buffered (`stdio: "ignore"`), so a noisy delete can no
  longer be killed for talking. Nothing read that output; the existence check decides.
- The delete is bounded by a timeout, turning an unbounded one into a reported failure.
- A removal whose `.git` marker is already gone is completed as a plain recursive delete, since git
  will not remove a path it cannot validate — otherwise the half-deleted state is a dead end.
- The slow fallback now says so before it starts, because walking a submodule worktree's links takes
  minutes and a silent command reads as a hung one.

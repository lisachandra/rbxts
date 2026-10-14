---
"@lisachandra/sandcastle": patch
---

Keep the junction backup when a preserved entry collided

`replaceDirectoryWithJunction` renames a real directory aside, junctions the link into the target,
then moves the backup's entries across. An entry that could not be moved — its name already existed
in the target — was deliberately left in the backup, and the very next statement deleted the backup
recursively. The comment and the code disagreed, and the code won: the entry was destroyed silently.

- The backup is now deleted only once it is empty. When entries remain, `linkSymlinks` keeps them and
  names the backup path, so nothing is lost without a word.
- Covered by a test that collides a file against a directory. A file-against-file collision does not
  actually fail — renaming a file over an existing file succeeds and overwrites it on both platforms
  — so only a type mismatch reaches this path.

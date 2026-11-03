---
"@lisachandra/sandcastle": patch
---

Treat a phase attempt as complete when its completion marker exists on disk

A phase attempt that hit the wall-clock budget (or failed) after the agent had
already written its completion marker was rejected into the retry loop, whose
first act clears the marker — destroying the evidence that the phase had
finished and re-running it. `runMarkerPhase` now checks the marker in the error
path: cleared at attempt start, so its presence is proof this attempt completed,
and the attempt resolves instead of retrying.

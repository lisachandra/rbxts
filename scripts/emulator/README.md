# Emulator tooling fixtures

`reflection.json` is a copy of
[Anime-Vanguards/roblox-engine-emulator](https://github.com/Anime-Vanguards/roblox-engine-emulator)'s
`data/reflection.json` at the commit the `ree` binary pin in `mise.toml`
refers to (currently `771754c6`, shipped as release
`v0.1.0-771754c6` on `lisachandra/roblox-engine-emulator`).

The emulator staging pipeline regenerates `@rbxts/react`'s `tags.lua`
from it, because `ReflectionService:GetClasses()` is not emulated under
ree. When bumping the ree pin, re-copy the file from the new upstream
commit so the generated class table matches the emulated engine.
Upstream license: GPL-2.0-or-later (the file is a generated API dump;
consumed as data, no source is vendored into this repo).

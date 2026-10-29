---
"@lisachandra/sandcastle": patch
---

Inject ZCode's provider-config env when spawning the bundled CLI outside the desktop app

`zcode app-server` aborts at startup with 「无法定位 CLI ZCode Built-in Provider Config」
when it is launched from a bare shell: the CLI resolves its built-in provider catalog
relative to its own entrypoint (`entry_dir/provider/zcode-builtin.json`), which only
exists inside the desktop app layout, and the desktop app normally hands the CLI the
real path via `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` / `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`
env. Sandcastle runs hit this on the first design phase of every issue (e.g. game repo
issue #397).

The zcode wrapper now mirrors the desktop app: when those env vars are not preset it
points the bundled CLI at the packaged catalog
(`<LocalAppData>/Programs/ZCode/resources/config/provider/zcode-builtin.json`, with
platform equivalents) and at `~/.zcode/v2/provider_config.json`; preset values pass
through untouched.

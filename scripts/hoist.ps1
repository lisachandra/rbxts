$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
node "$Root/scripts/hoist.mjs"

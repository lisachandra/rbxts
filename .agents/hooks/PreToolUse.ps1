# PreToolUse Hook
# Reads the hooks.PreToolUse configuration from settings.json dynamically,
# then runs the matching hook commands for the current tool.
# This keeps the enforcement logic in settings.json as the single source of truth.

try {
    # Read JSON from stdin (how Dirac invokes hooks)
    $rawInput = [Console]::In.ReadToEnd()
    if (-not $rawInput) {
        @{ cancel = $false; contextModification = ""; errorMessage = "" } | ConvertTo-Json -Compress
        exit 0
    }

    $inputObj = $rawInput | ConvertFrom-Json
    $toolName = $inputObj.tool_name

    # Locate settings.json relative to this script's directory
    # Script is in .diracrules/hooks/ -- settings.json is in .diracrules/
    $hookDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $settingsPath = Join-Path (Split-Path -Parent $hookDir) "settings.json"

    if (-not (Test-Path $settingsPath)) {
        @{ cancel = $false; contextModification = ""; errorMessage = "" } | ConvertTo-Json -Compress
        exit 0
    }

    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    $preToolUseHooks = $settings.hooks.PreToolUse

    if (-not $preToolUseHooks) {
        @{ cancel = $false; contextModification = ""; errorMessage = "" } | ConvertTo-Json -Compress
        exit 0
    }

    # Find matchers that apply to this tool
    foreach ($entry in $preToolUseHooks) {
        $matcher = $entry.matcher
        if ($toolName -match $matcher) {
            foreach ($hook in $entry.hooks) {
                if ($hook.type -ne "command") { continue }

                $command = $hook.command
                $parts = $command -split ' ', 2
                $runner = $parts[0]
                $scriptArgs = if ($parts.Count -gt 1) { $parts[1] } else { "" }

                # Resolve .agents/ references to actual hooks directory
                $slash = $hookDir.Replace('\', '/')
                $resolvedRunner = $runner -replace '^\.agents/', ($slash + '/')

                if ($resolvedRunner -match '\.cmd$') {
                    $output = $rawInput | & $resolvedRunner $scriptArgs 2>&1
                } elseif ($resolvedRunner -match '\.ps1$') {
                    $output = $rawInput | & $resolvedRunner $scriptArgs 2>&1
                } else {
                    $output = $rawInput | & $resolvedRunner $scriptArgs 2>&1
                }
                $exitCode = $LASTEXITCODE

                if ($exitCode -ne 0) {
                    $errorMsg = ($output | Out-String).Trim()
                    if (-not $errorMsg) { $errorMsg = "Hook '$command' failed with exit code $exitCode" }
                    @{ cancel = $true; contextModification = ""; errorMessage = $errorMsg } | ConvertTo-Json -Compress
                    exit 1
                }
            }
        }
    }

    @{ cancel = $false; contextModification = ""; errorMessage = "" } | ConvertTo-Json -Compress
    exit 0

} catch {
    Write-Error "[PreToolUse] Error: $($_.Exception.Message)"
    @{ cancel = $true; contextModification = ""; errorMessage = "PreToolUse hook error: $($_.Exception.Message)" } | ConvertTo-Json -Compress
    exit 1
}

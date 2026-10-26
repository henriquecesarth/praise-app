#requires -Version 5.1
<#
.SYNOPSIS
  LouvAIO: pilot of concurrent read-only research using local agy and codex CLI.
.DESCRIPTION
  Defaults to preflight only. -Execute launches both CLIs in independent
  PowerShell background jobs. It does NOT create PRs, push, merge or deploy.
  This is a pilot, not a privilege boundary for Antigravity.
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$Execute,
    [ValidateRange(60, 3600)][int]$TimeoutSeconds = 900,
    [string]$CodexModel = ''
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath $RepoRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $repo 'AGENTS.md'))) {
    throw "The supplied RepoRoot is not a LouvAIO checkout: $repo"
}

$git = (Get-Command git -ErrorAction Stop).Source
$agy = (Get-Command agy -ErrorAction Stop).Source
$codex = (Get-Command codex -ErrorAction Stop).Source

$branch = (& $git -C $repo branch --show-current | Out-String).Trim()
$head = (& $git -C $repo rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$') {
    throw 'Unable to verify Git HEAD.'
}
$initialStatus = @(& $git -C $repo status --porcelain=v1 --untracked-files=normal)
if ($initialStatus.Count -gt 0) {
    throw 'Working tree must be clean for the read-only pilot. Preserve local edits and use a fresh worktree.'
}

$agyVersion = (& $agy --version 2>&1 | Out-String).Trim()
$codexVersion = (& $codex --version 2>&1 | Out-String).Trim()
Write-Host "Branch: $branch"
Write-Host "HEAD: $head"
Write-Host "agy: $agy | $agyVersion"
Write-Host "codex: $codex | $codexVersion"
Write-Host "Mode: $(if ($Execute) { 'EXECUTE (two independent read-only research jobs)' } else { 'PREFLIGHT ONLY' })"

if (-not $Execute) {
    Write-Host 'No agent has been started. Rerun with -Execute after reviewing paths and permissions.'
    return
}

$runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$outputDir = Join-Path $repo (Join-Path '.logs\multiagent' $runId)
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$manifest = [ordered]@{
    runId = $runId
    branch = $branch
    head = $head
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    mode = 'read-only-research'
    agyPath = $agy
    agyVersion = $agyVersion
    codexPath = $codex
    codexVersion = $codexVersion
    codexModel = $CodexModel
    timeoutSeconds = $TimeoutSeconds
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputDir 'manifest.json') -Encoding UTF8

$agyPrompt = @'
Read AGENTS.md and relevant docs. Independently inspect the LouvAIO Web/Mobile repertoire contracts and testing risks at the current Git HEAD. Work strictly read-only: no commands that write files, no commits, no push, no deployment. Report only evidence with file paths, actionable risks and unknowns. Do not use external credentials or systems.
'@
$codexPrompt = @'
Independently audit multi-agent safety and CI/test isolation at the current Git HEAD. Read AGENTS.md, GEMINI.md, .codex/config.toml, web/playwright.config.ts, backend/vitest.config.ts, and .github/workflows/. Strictly read-only: do not modify files, commit, push, deploy or access external credentials. Report findings with concrete evidence and priority. Do not assume the Antigravity output is authoritative.
'@

$worker = {
    param([string]$tool, [string]$exe, [string]$root, [string]$prompt, [string]$folder, [string]$model)
    $ErrorActionPreference = 'Continue'
    Set-Location -LiteralPath $root
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $stderr = Join-Path $folder "$tool.stderr.txt"
    $stdoutPath = Join-Path $folder "$tool.stdout.txt"
    $exitCode = -1
    $success = $false
    $message = ''
    try {
        if ($tool -eq 'agy') {
            $output = (& $exe --print $prompt --output-format json --print-timeout 12m --sandbox 2> $stderr | Out-String)
        }
        else {
            $arguments = @('exec', '--json', '--ephemeral', '--sandbox', 'read-only', '-C', $root)
            if (-not [string]::IsNullOrWhiteSpace($model)) { $arguments += @('-m', $model) }
            $arguments += $prompt
            $output = (& $exe @arguments 2> $stderr | Out-String)
        }
        $exitCode = $LASTEXITCODE
        [IO.File]::WriteAllText($stdoutPath, $output, (New-Object System.Text.UTF8Encoding($false)))
        if ($tool -eq 'agy') {
            $response = $output | ConvertFrom-Json -ErrorAction Stop
            $success = $exitCode -eq 0 -and $response.status -eq 'SUCCESS'
            $message = [string]$response.status
        }
        else {
            $success = $exitCode -eq 0 -and $output -match '"type"\s*:\s*"turn.completed"'
            $message = if ($success) { 'turn.completed' } else { 'missing turn.completed or nonzero exit' }
        }
    }
    catch {
        $message = $_.Exception.Message
    }
    finally {
        $watch.Stop()
    }
    [pscustomobject]@{
        tool = $tool
        success = [bool]$success
        exitCode = $exitCode
        durationSeconds = [math]::Round($watch.Elapsed.TotalSeconds, 2)
        status = $message
        stdout = $stdoutPath
        stderr = $stderr
    }
}

$jobs = @(
    (Start-Job -Name "agy-$runId" -ScriptBlock $worker -ArgumentList @('agy', $agy, $repo, $agyPrompt, $outputDir, '')),
    (Start-Job -Name "codex-$runId" -ScriptBlock $worker -ArgumentList @('codex', $codex, $repo, $codexPrompt, $outputDir, $CodexModel))
)

try {
    $null = Wait-Job -Job $jobs -Timeout $TimeoutSeconds
    $results = @()
    foreach ($job in $jobs) {
        if ($job.State -eq 'Running') {
            Stop-Job -Job $job
            $results += [pscustomobject]@{ tool = $job.Name; success = $false; status = 'TIMEOUT'; exitCode = -1; durationSeconds = $TimeoutSeconds }
            continue
        }
        $out = @(Receive-Job -Job $job)
        $record = $out | Where-Object { $_.PSObject.Properties.Name -contains 'tool' } | Select-Object -Last 1
        if ($null -eq $record) {
            $results += [pscustomobject]@{ tool = $job.Name; success = $false; status = "JOB_$($job.State)"; exitCode = -1; durationSeconds = $null }
        }
        else {
            $results += $record
        }
    }
    $finalHead = (& $git -C $repo rev-parse HEAD | Out-String).Trim()
    $finalStatus = @(& $git -C $repo status --porcelain=v1 --untracked-files=normal)
    $unchanged = ($finalHead -eq $head -and $finalStatus.Count -eq 0)
    $summary = [ordered]@{
        runId = $runId
        head = $head
        unchanged = $unchanged
        agents = @($results)
        completedAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    $summary | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $outputDir 'summary.json') -Encoding UTF8
    $results | Format-Table tool, success, exitCode, durationSeconds, status -AutoSize
    Write-Host "Evidence: $outputDir"
    if (-not $unchanged) { throw 'Repository changed during the read-only pilot; inspect git status immediately.' }
    if (@($results | Where-Object { -not $_.success }).Count -gt 0) {
        throw 'At least one agent did not provide a verified terminal success. Check the logs.'
    }
}
finally {
    $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
}

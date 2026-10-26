#requires -Version 5.1
<#
.SYNOPSIS
  LouvAIO: task-first coordination of Antigravity and Codex, without GitHub Issues.
.DESCRIPTION
  By default only checks prerequisites. -Execute launches two read-only investigations
  simultaneously. Does not create worktrees, commit, push, merge, deploy, or write source code.
  Task may be passed directly or read from a Markdown file in the Obsidian vault.
#>
[CmdletBinding()]
param(
    [string]$Task = '',
    [string]$TaskFile = '',
    [switch]$Execute,
    [ValidateRange(60, 3600)][int]$TimeoutSeconds = 900,
    [string]$CodexModel = ''
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
if ([string]::IsNullOrWhiteSpace($Task) -eq [string]::IsNullOrWhiteSpace($TaskFile)) {
    throw "Provide exactly one of -Task or -TaskFile."
}
if ($TaskFile) {
    $taskPath = if ([IO.Path]::IsPathRooted($TaskFile)) { $TaskFile } else { Join-Path (Get-Location).Path $TaskFile }
    $Task = Get-Content -LiteralPath $taskPath -Raw -Encoding UTF8
}
if ([string]::IsNullOrWhiteSpace($Task) -or $Task.Length -lt 12 -or $Task.Length -gt 12000) {
    throw "Task must contain between 12 and 12000 characters."
}
if (-not (Test-Path -LiteralPath (Join-Path $repo 'AGENTS.md'))) { throw 'Not a LouvAIO checkout.' }
$git = (Get-Command git -ErrorAction Stop).Source
$agy = (Get-Command agy -ErrorAction Stop).Source
$codex = (Get-Command codex -ErrorAction Stop).Source
$branch = (& $git -C $repo branch --show-current | Out-String).Trim()
$head = (& $git -C $repo rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$') { throw "Cannot identify Git HEAD." }
$initialStatus = @(& $git -C $repo status --porcelain=v1 --untracked-files=normal)
if ($initialStatus.Count -gt 0) {
    throw "Working tree is dirty. Keep your Obsidian edits and run from a clean worktree."
}
$agyVersion = (& $agy --version 2>&1 | Out-String).Trim()
$codexVersion = (& $codex --version 2>&1 | Out-String).Trim()
Write-Host "Branch: $branch"
Write-Host "HEAD: $head"
Write-Host "agy: $agy | $agyVersion"
Write-Host "codex: $codex | $codexVersion"
Write-Host "Task source: $(if ($TaskFile) { $TaskFile } else { 'direct prompt' })"
Write-Host "Mode: $(if ($Execute) { 'EXECUTE (parallel read-only)' } else { 'PREFLIGHT ONLY' })"
if (-not $Execute) {
    Write-Host 'No agents started. Add -Execute to perform independent parallel research.'
    return
}
$runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$outputDir = Join-Path $repo (Join-Path '.logs\tasks' $runId)
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$manifest = [ordered]@{
    runId = $runId; branch = $branch; head = $head
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    mode = 'independent-read-only'
    taskSource = $(if ($TaskFile) { $TaskFile } else { 'inline' })
    taskSha256 = ([System.BitConverter]::ToString(
        ([System.Security.Cryptography.SHA256]::Create()).ComputeHash(
            [System.Text.Encoding]::UTF8.GetBytes($Task)))).Replace('-','').ToLowerInvariant()
    agyPath = $agy; agyVersion = $agyVersion
    codexPath = $codex; codexVersion = $codexVersion
    timeoutSeconds = $TimeoutSeconds
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputDir 'manifest.json') -Encoding UTF8
$agyPrompt = @"
You are researching the following LouvAIO development task:
$Task

Read AGENTS.md, GEMINI.md, docs/01-CONTEXTO-ATUAL.md and relevant code. Delegate research to independent read-only subagents when useful. Investigate implementation dependencies, API contracts, affected paths and targeted tests. STRICTLY read-only: no files modified, no commit, no push, no deploy or real external data. Output concise evidence paths and a proposed decomposition; never pretend execution/test results were verified.
"@
$codexPrompt = @"
Independently evaluate the same LouvAIO task, without trusting Antigravity:
$Task

Read AGENTS.md, relevant code and tests, and docs/development/multi-agent-workflow.md. Review security, tenant boundaries, concurrency, tests and likely regressions. STRICTLY read-only, no source changes, push, commit, deploy or real external credentials. Output concrete risks, test gaps and file paths. Separate verified evidence from hypotheses.
"@
$worker = {
    param([string]$tool,[string]$exe,[string]$root,[string]$prompt,[string]$folder,[string]$model)
    $ErrorActionPreference = 'Continue'
    Set-Location -LiteralPath $root
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $stderrPath = Join-Path $folder "$tool.stderr.txt"
    $stdoutPath = Join-Path $folder "$tool.stdout.txt"
    $exitCode = -1
    $result = ''
    $message = ''
    try {
        if ($tool -eq 'agy') {
            $response = (& $exe --print $prompt --output-format json --print-timeout 12m --sandbox 2> $stderrPath | Out-String)
        } else {
            $commandArgs = @('exec','--json','--ephemeral','--sandbox','read-only','-C',$root)
            if ($model) { $commandArgs += @('-m',$model) }
            $commandArgs += $prompt
            $response = (& $exe @commandArgs 2> $stderrPath | Out-String)
        }
        $exitCode = $LASTEXITCODE
        [IO.File]::WriteAllText($stdoutPath,$response,([System.Text.UTF8Encoding]::new($false)))
        $stderrText = if (Test-Path $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue } else { '' }
        if ($tool -eq 'agy') {
            $parsed = $response | ConvertFrom-Json -ErrorAction Stop
            $turnCompleted = $parsed.status -eq 'SUCCESS'
        } else {
            $turnCompleted = $response -match '"type"\s*:\s*"turn.completed"'
        }
        $internalFailure = ($response + $stderrText) -match 'collab spawn failed|no rollout found for thread|subagent spawn failed|turn.failed|model_not_found'
        $processOk = $exitCode -eq 0
        $taskOk = $processOk -and $turnCompleted
        $result = if (-not $taskOk) { 'FAILED' } elseif ($internalFailure) { 'DEGRADED' } else { 'COMPLETE' }
        $message = if ($internalFailure) { 'Nonfatal internal/delegation error detected; inspect local logs' } else { 'Terminal outcome checked' }
    }
    catch {
        $result = 'FAILED'
        $message = $_.Exception.Message
    }
    finally { $watch.Stop() }
    [pscustomobject]@{
        tool = $tool; result = $result; exitCode = $exitCode
        processOk = $exitCode -eq 0
        taskOk = $result -eq 'COMPLETE' -or $result -eq 'DEGRADED'
        delegationOk = if ($result -eq 'DEGRADED') { $false } else { $null }
        durationSeconds = [math]::Round($watch.Elapsed.TotalSeconds,2)
        detail = $message
    }
}
$jobs = @(
    (Start-Job -Name "agy-$runId" -ScriptBlock $worker -ArgumentList @('agy',$agy,$repo,$agyPrompt,$outputDir,'')),
    (Start-Job -Name "codex-$runId" -ScriptBlock $worker -ArgumentList @('codex',$codex,$repo,$codexPrompt,$outputDir,$CodexModel))
)
try {
    $null = Wait-Job -Job $jobs -Timeout $TimeoutSeconds
    $records = @()
    foreach ($job in $jobs) {
        if ($job.State -eq 'Running') {
            Stop-Job -Job $job
            $records += [pscustomobject]@{tool=$job.Name;result='TIMEOUT';exitCode=-1;processOk=$false;taskOk=$false;delegationOk=$null;durationSeconds=$TimeoutSeconds;detail='Supervisor timeout; inspect child processes'}
            continue
        }
        $out = @(Receive-Job -Job $job)
        $record = $out | Where-Object { $_.PSObject.Properties.Name -contains 'tool' } | Select-Object -Last 1
        if ($null -eq $record) {
            $records += [pscustomobject]@{tool=$job.Name;result='FAILED';exitCode=-1;processOk=$false;taskOk=$false;delegationOk=$null;durationSeconds=$null;detail="JOB_$($job.State)"}
        } else { $records += $record }
    }
    $finalHead = (& $git -C $repo rev-parse HEAD | Out-String).Trim()
    $finalStatus = @(& $git -C $repo status --porcelain=v1 --untracked-files=normal)
    $unchanged = $finalHead -eq $head -and $finalStatus.Count -eq 0
    $summary = [ordered]@{
        runId=$runId; head=$head; unchanged=$unchanged; finishedAt=(Get-Date).ToUniversalTime().ToString('o')
        result=$(if (-not $unchanged -or @($records | Where-Object { -not $_.taskOk }).Count -gt 0) { 'FAILED' } elseif (@($records | Where-Object {$_.result -eq 'DEGRADED'}).Count -gt 0) {'DEGRADED'} else {'COMPLETE'})
        agents=@($records)
    }
    $summary | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $outputDir 'summary.json') -Encoding UTF8
    $records | Format-Table tool,result,exitCode,durationSeconds,detail -AutoSize
    Write-Host "Summary: $($summary.result) | HEAD and worktree unchanged: $unchanged"
    Write-Host "Evidence (local only): $outputDir"
    if ($summary.result -eq 'FAILED') { throw 'One or more agents failed, timed out or altered the checkout.' }
}
finally {
    $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
}

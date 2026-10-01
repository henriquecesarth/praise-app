# agent-manager.ps1
# Agent Manager V2 - autonomous Engineer/Reviewer GitHub Issue pipeline.
# PowerShell 5.1 compatible, ASCII-only source.
#
# Usage:
#   .\agent-manager.ps1                      # single pass over actionable issues
#   .\agent-manager.ps1 -Once                # process exactly one issue then stop
#   .\agent-manager.ps1 -MaxReviewCycles 3   # override loop limit
#   .\agent-manager.ps1 -DryRun              # plan only, no mutations/workers
#   .\agent-manager.ps1 -PollInterval 60     # keep polling every N seconds
#   .\agent-manager.ps1 -Target 42           # target a specific issue
#   .\agent-manager.ps1 -SmokeTest           # controlled end-to-end smoke test
#
# Flags:
#   -Repo <owner/repo>       GitHub repository (default: from git remote)
#   -BaseBranch <name>       worktree base branch (default: main)
#   -WorktreesDir <path>     worktrees root (default: <repo>/.worktrees)
#   -LogDir <path>           logs root (default: <repo>/.logs)
#   -EngineerModel <model>   opencode model for the engineer worker
#   -InstanceId <id>         lock identity for tests/claim
#   -NoClaim                 skip lock comment (test/CI mode)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. "$scriptDir\agent-manager.lib.ps1"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
$AM2_LABEL_DESCRIPTIONS = @{
    $AM2_LABEL_READY             = 'Queued for the autonomous agent pipeline. Permissions: none unless granted.'
    $AM2_LABEL_ENGINEERING       = 'Engineer worker is implementing the issue in its worktree.'
    $AM2_LABEL_REVIEW            = 'Reviewer worker is evaluating the engineer diff.'
    $AM2_LABEL_CHANGES_REQUESTED = 'Reviewer requested fixes; engineer remediation is queued.'
    $AM2_LABEL_BLOCKED_HUMAN     = 'Pipeline stopped; a human decision is required.'
    $AM2_LABEL_DONE              = 'Issue completed (engineer PASS + reviewer PASS).'
    $AM2_LABEL_FAILED            = 'Pipeline failed; a human must inspect the logs.'
    $AM2_LABEL_NO_PUSH           = 'Explicitly forbids git push for this issue.'
    $AM2_LABEL_NO_DEPLOY         = 'Explicitly forbids deploy for this issue.'
    $AM2_LABEL_ALLOW_PUSH        = 'Permits git push for this issue.'
    $AM2_LABEL_ALLOW_DEPLOY      = 'Permits deploy for this issue.'
}
$AM2_LABEL_COLORS = @{
    $AM2_LABEL_READY             = '0E8A16'
    $AM2_LABEL_ENGINEERING       = 'FBCA04'
    $AM2_LABEL_REVIEW            = '1D76DB'
    $AM2_LABEL_CHANGES_REQUESTED = 'E99695'
    $AM2_LABEL_BLOCKED_HUMAN     = 'B60205'
    $AM2_LABEL_DONE              = 'C5DEF5'
    $AM2_LABEL_FAILED            = 'D93F0B'
    $AM2_LABEL_NO_PUSH           = '6A737D'
    $AM2_LABEL_NO_DEPLOY         = '6A737D'
    $AM2_LABEL_ALLOW_PUSH        = '0E8A16'
    $AM2_LABEL_ALLOW_DEPLOY      = '0E8A16'
}

$AM2_WORKER_TIMEOUT_SEC = 1500
$AM2_POLL_INTERVAL_DEFAULT = 0

# ---------------------------------------------------------------------------
# CLI parsing (manual to stay PS 5.1 safe)
# ---------------------------------------------------------------------------
$cfg = @{
    Once = $false
    DryRun = $false
    SmokeTest = $false
    MaxReviewCycles = $AM2_DEFAULT_MAX_REVIEW_CYCLES
    PollInterval = $AM2_POLL_INTERVAL_DEFAULT
    Target = $null
    Repo = ''
    BaseBranch = 'main'
    WorktreesDir = ''
    LogDir = ''
    EngineerModel = ''
    InstanceId = ''
    NoClaim = $false
}

$i = 0
while ($i -lt $args.Count) {
    $flag = $args[$i]
    $val = ''
    if ($i + 1 -lt $args.Count) { $val = $args[$i + 1] }
    switch -exact ($flag.ToLower()) {
        '-once' { $cfg.Once = $true; $i++ }
        '-dryrun' { $cfg.DryRun = $true; $i++ }
        '-smoketest' { $cfg.SmokeTest = $true; $i++ }
        '-maxreviewcycles' { $cfg.MaxReviewCycles = [int]$val; $i += 2 }
        '-pollinterval' { $cfg.PollInterval = [int]$val; $i += 2 }
        '-target' { $cfg.Target = [int]$val; $i += 2 }
        '-issue' { $cfg.Target = [int]$val; $i += 2 }
        '-repo' { $cfg.Repo = $val; $i += 2 }
        '-basebranch' { $cfg.BaseBranch = $val; $i += 2 }
        '-worktreesdir' { $cfg.WorktreesDir = $val; $i += 2 }
        '-logdir' { $cfg.LogDir = $val; $i += 2 }
        '-engineermodel' { $cfg.EngineerModel = $val; $i += 2 }
        '-instanceid' { $cfg.InstanceId = $val; $i += 2 }
        '-noclaim' { $cfg.NoClaim = $true; $i++ }
        default {
            Write-Host "Unknown flag: $flag"
            Write-Host "Usage: .\agent-manager.ps1 [-Once] [-DryRun] [-SmokeTest] [-MaxReviewCycles N] [-PollInterval N] [-Target N] [-Repo owner/repo] [-BaseBranch name] [-EngineerModel model]"
            exit 1
        }
    }
}

# ---------------------------------------------------------------------------
# Repo resolution / paths (deferred: see Initialize-Am2Env below)
# ---------------------------------------------------------------------------
$repo = $cfg.Repo
$instanceId = $cfg.InstanceId
$repoRoot = ''
$worktreesDir = $cfg.WorktreesDir
$GLOBAL_logDirRoot = $cfg.LogDir

function Initialize-Am2Env() {
    if ($repo -eq '') {
        $remoteResult = Git-Run @('remote', 'get-url', 'origin')

        if ($remoteResult.exit -ne 0) {
            throw "Nao foi possivel obter o remote origin."
        }

        $remoteUrl = Safe-Trim $remoteResult.out

        # Suporta:
        # https://github.com/owner/repo.git
        # git@github.com:owner/repo.git
        if ($remoteUrl -match 'github\.com[/:](?<owner>[^/]+)/(?<name>[^/]+?)(?:\.git)?$') {
            $script:repo = "$($Matches.owner)/$($Matches.name)"
        }
        else {
            throw "Nao foi possivel extrair owner/repo do remote origin: $remoteUrl"
        }
    }

    if ($instanceId -eq '') {
        $script:instanceId = "am2-$(hostname)-$(Get-Date -Format 'yyyyMMddHHmmss')-$(Get-Random -Maximum 99999)"
    }

    $rr = Git-Run @('rev-parse', '--show-toplevel')

    if ($rr.exit -ne 0) {
        throw "Nao foi possivel determinar a raiz do repositorio Git."
    }

    $script:repoRoot = Safe-Trim $rr.out

    if ([string]::IsNullOrWhiteSpace($script:repoRoot)) {
        throw "A raiz do repositorio retornada pelo Git esta vazia."
    }

    if ($worktreesDir -eq '') {
        $script:worktreesDir = Join-Path $script:repoRoot '.worktrees'
    }

    if ($GLOBAL_logDirRoot -eq '') {
        $script:GLOBAL_logDirRoot = Join-Path $script:repoRoot '.logs'
    }
}

function Write-AsciiFile([string]$path, [string]$text) {
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $text = Sanitize-Ascii $text
    # ASCII-only content: Set-Content -Encoding ASCII is safe and adds no BOM.
    Set-Content -Path $path -Value $text -Encoding ASCII -Force
}

function Log-Write([string]$file, [string]$msg) {
    $dir = Split-Path -Parent $file
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $safe = Sanitize-Secrets $msg
    $line = "$stamp | $safe"
    Add-Content -Path $file -Value $line -Encoding ASCII
}

# ---------------------------------------------------------------------------
# Byte-faithful gh runner (avoids PS 5.1 console-encoding corruption)
# ---------------------------------------------------------------------------
# Byte-faithful native runner: writes the command line into a temp .cmd file
# and runs it via cmd /c. This avoids the Java-PowerShell stderr-is-fatal quirk
# AND the cmd.exe/PowerShell quoting minefield entirely (cmd parses the file
# natively). Returns @{ exit; out } where out is the trimmed stdout.
function Invoke-CmdCapture($argsArr) {
    $cmdFile = Get-TempFile '.cmd'
    $outFile = Get-TempFile '.out'
    $exitFile = Get-TempFile '.exit'
    $quoted = @()
    foreach ($a in $argsArr) {
        $str = [string]$a
        if ($str -match '[\s"\\]') { $str = '"' + $str.Replace('"', '""') + '"' }
        $quoted += $str
    }
    $cmdLine = ($quoted -join ' ')
    $cmdBody = "@echo off`n$cmdLine > `"$outFile`" 2>&1`necho %errorlevel% > `"$exitFile`""
    Set-Content -Path $cmdFile -Value $cmdBody -Encoding ASCII
    $null = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmdFile -Wait -WindowStyle Hidden -RedirectStandardOutput (Get-TempFile '.co') -RedirectStandardError (Get-TempFile '.ce')
    $code = 9999
    if (Test-Path $exitFile) {
        $raw = (Get-Content -Raw -Encoding ASCII $exitFile | Out-String).Trim()
        Remove-Item -Force $exitFile -ErrorAction SilentlyContinue
        if ($raw -match '^\d+$') { $code = [long]$raw }
    } else {
        Remove-Item -Force $exitFile -ErrorAction SilentlyContinue
    }
    $out = ''
    if (Test-Path $outFile) {
        $raw = Get-Content -Raw -Encoding UTF8 $outFile
        if ($null -ne $raw) { $out = [string]$raw }
        Remove-Item -Force $outFile
    }
    Remove-Item -Force $cmdFile -ErrorAction SilentlyContinue
    return @{ exit = $code; out = (($out.TrimEnd([char]10, [char]13))) }
}

function Invoke-Gh($argsArr, [string]$outFile) {
    $pre = @('gh') + $argsArr
    $r = Invoke-CmdCapture $pre
    if (Test-Path (Split-Path -Parent $outFile)) {
        Set-Content -Path $outFile -Value $r.out -Encoding UTF8
    }
    return $r.exit
}

# Native call for commands where output capture is not needed.
function Invoke-GhNative($argsArr) {
    $pre = @('gh') + $argsArr
    $r = Invoke-CmdCapture $pre
    return $r.exit
}

function Get-TempFile([string]$ext) {
    if ($null -eq $GLOBAL_logDirRoot -or $GLOBAL_logDirRoot -eq '') {
        $GLOBAL_logDirRoot = Join-Path (Split-Path -Parent $PSScriptRoot) '.logs'
    }
    if (-not (Test-Path $GLOBAL_logDirRoot)) { New-Item -ItemType Directory -Force -Path $GLOBAL_logDirRoot | Out-Null }
    $name = ".am2-" + (Get-Random -Maximum 99999999) + "$ext"
    return Join-Path $GLOBAL_logDirRoot $name
}

function Safe-Trim($v) {
    if ($null -eq $v) { return '' }
    return ($v.Trim())
}

function Gh-Json($argsArr) {
    $tmp = Get-TempFile '.json'
    if (-not (Test-Path (Split-Path -Parent $tmp))) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $tmp) | Out-Null }
    $code = Invoke-Gh $argsArr $tmp
    $json = $null
    if (Test-Path $tmp) {
        $raw = Get-Content -Raw -Encoding UTF8 $tmp
        if ($raw -ne '') { try { $json = ConvertFrom-Json $raw } catch { $json = $null } }
        Remove-Item -Force $tmp
    }
    if ($code -ne 0) { throw "gh failed (exit $code): $($argsArr -join ' ')" }
    return $json
}

function Gh-Capture($argsArr) {
    $tmp = Get-TempFile '.txt'
    if (-not (Test-Path (Split-Path -Parent $tmp))) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $tmp) | Out-Null }
    $code = Invoke-Gh $argsArr $tmp
    $text = ''
    if (Test-Path $tmp) { $text = Get-Content -Raw -Encoding UTF8 $tmp; Remove-Item -Force $tmp }
    if ($code -ne 0) { throw "gh failed (exit $code): $($argsArr -join ' ')" }
    return $text
}

# ---------------------------------------------------------------------------
# Label management
# ---------------------------------------------------------------------------
function Test-HasItemLoose($arr, $item) {
    foreach ($x in $arr) { if ($x -eq $item) { return $true } }
    return $false
}

function Ensure-Am2Labels() {
    $existing = @()
    $tmp = Get-TempFile '.labels.json'
    if (-not (Test-Path (Split-Path -Parent $tmp))) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $tmp) | Out-Null }
    $code = Invoke-Gh @('label','list','--repo',$repo,'--limit','100','--json','name') $tmp
    if ($code -eq 0 -and (Test-Path $tmp)) {
        $json = ConvertFrom-Json (Get-Content -Raw -Encoding UTF8 $tmp)
        foreach ($l in $json) { $existing += $l.name }
        Remove-Item -Force $tmp
    } else {
        Remove-Item -Force $tmp -ErrorAction SilentlyContinue
    }
    foreach ($name in $AM2_LABEL_DESCRIPTIONS.Keys) {
        if (Test-HasItemLoose $existing $name) { continue }
        $desc = $AM2_LABEL_DESCRIPTIONS[$name]
        $color = $AM2_LABEL_COLORS[$name]
        $code = Invoke-GhNative @('label','create',$name,'--repo',$repo,'--description',$desc,'--color',$color)
        if ($code -ne 0) { Write-Host "WARN: could not create label $name (exit $code)" }
    }
}

function Apply-Am2State([int]$issue, [string]$newLabel, $currentLabels) {
    $delta = Get-Am2LabelDelta $currentLabels $newLabel
    $editArgs = @('issue', 'edit', $issue, '--repo', $repo)
    foreach ($a in $delta.add) { $editArgs += '--add-label'; $editArgs += $a }
    foreach ($r in $delta.remove) { $editArgs += '--remove-label'; $editArgs += $r }
    if ($delta.add.Count -eq 0 -and $delta.remove.Count -eq 0) { return }
    $tmpOut = Get-TempFile '.label-apply.txt'
    $code = Invoke-Gh $editArgs $tmpOut
    Remove-Item -Force $tmpOut -ErrorAction SilentlyContinue
    if ($code -ne 0) { throw "failed to apply label $newLabel (exit $code)" }
}

function Post-Comment([int]$issue, [string]$body) {
    $bodyFile = Get-TempFile '.comment.txt'
    Write-AsciiFile $bodyFile $body
    $code = Invoke-GhNative @('issue','comment',$issue,'--repo',$repo,'--body-file',$bodyFile)
    Remove-Item -Force $bodyFile -ErrorAction SilentlyContinue
    if ($code -ne 0) { throw "failed to post comment (exit $code)" }
}

# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------
function Git-C([string]$worktree, $argsArr) {
    # NOTE: routes through Invoke-CmdCapture for stderr-safety.
    $pre = @('git','-C', $worktree) + $argsArr
    $r = Invoke-CmdCapture $pre
    return $r.out
}

function Quote-CmdArg([string]$a) {
    if ($a -match '[\s]') { return '"""' + $a + '"""' }
    return $a
}

function Git-Run($argsArr) {
    # Runs arbitrary git args via cmd /c (stderr-safe); returns @{ exit; out }.
    $pre = @('git') + $argsArr
    return Invoke-CmdCapture $pre
}

function Git-Clean([string]$worktree) {
    if (-not (Test-Path $worktree)) { return $false }
    $out = Git-C $worktree @('status','--porcelain')
    $joined = ($out | Out-String).Trim()
    return ($joined -eq '')
}

function Git-HasCommits([string]$worktree, [string]$base) {
    if (-not (Test-Path $worktree)) { return $false }
    $out = Git-C $worktree @('rev-list', "--count=1", "$base..HEAD", '--no-merges')
    $count = ($out | Out-String).Trim()
    if ($count -eq '') { return $false }
    if ($count -match '^\d+$') { return ([long]$count -gt 0) }
    return $false
}

function Get-WorktreePath([int]$issue) {
    return (Join-Path $worktreesDir (Get-Am2WorktreeName $issue))
}

function Build-PushGuardHook() {
    return @(
        '#!/bin/sh'
        'if [ "$AM2_ALLOW_PUSH" = "1" ]; then exit 0; fi'
        'echo "AGENT MANAGER: push blocked. Add agent:allow-push to the issue." >&2'
        'exit 1'
    ) -join [char]10
}

function Ensure-Worktree([int]$issue) {
    $path = Get-WorktreePath $issue
    $branch = Get-Am2BranchName $issue
    $exists = $false
    if (Test-Path (Join-Path $path '.git')) {
        $cur = (Git-C $path @('rev-parse','--abbrev-ref','HEAD') | Out-String).Trim()
        if ($cur -eq $branch) { $exists = $true }
    }
    if ($exists) {
        [void](Install-PushGuard $issue $path)
        return $path
    }
    if (-not (Test-Path $worktreesDir)) { New-Item -ItemType Directory -Force -Path $worktreesDir | Out-Null }
    $base = $cfg.BaseBranch
    $r = Git-Run @('show-ref','--verify','--quiet',"refs/heads/$base")
    if ($r.exit -ne 0) {
        throw "base branch $base not found locally; run `git fetch` or pass -BaseBranch"
    }
    # Clean any stale path where branch/file-state is ambiguous
    if (Test-Path $path) { $null = Git-Run @('worktree','remove','--force',$path) }
    $r2 = Git-Run @('show-ref','--verify','--quiet',"refs/heads/$branch")
    if ($r2.exit -eq 0) {
        # branch exists but worktree missing
        $r3 = Git-Run @('worktree','add','-f',$path,$branch)
    } else {
        $r3 = Git-Run @('worktree','add','-f','-b',$branch,$path,$base)
    }
    if ($r3.exit -ne 0) { throw "could not create worktree: $($r3.out)" }
    $verify = (Git-C $path @('rev-parse','--abbrev-ref','HEAD') | Out-String).Trim()
    if ($verify -ne $branch) { throw "worktree verification failed: on $verify expected $branch" }
    [void](Install-PushGuard $issue $path)
    return $path
}

function Install-PushGuard([int]$issue, [string]$worktree) {
    # Hooks live OUTSIDE the worktree so git status stays clean.
    $hooksBase = Join-Path $GLOBAL_logDirRoot 'hooks'
    $hooksDir = Join-Path $hooksBase "issue-$issue"
    if (-not (Test-Path $hooksDir)) { New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null }
    $hookPath = Join-Path $hooksDir 'pre-push'
    Write-AsciiFile $hookPath (Build-PushGuardHook)
    $null = Git-Run @('-C',$worktree,'config','--worktree','core.hooksPath',$hooksDir)
}

function Remove-Worktree([int]$issue) {
    $path = Get-WorktreePath $issue
    if (Test-Path (Join-Path $path '.git')) { $null = Git-Run @('worktree','remove','--force',$path) }
    # remove leftover directory that is not a registered worktree
    if (Test-Path $path) { Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue }
    $branch = Get-Am2BranchName $issue
    $r = Git-Run @('show-ref','--verify','--quiet',"refs/heads/$branch")
    if ($r.exit -eq 0) { $null = Git-Run @('branch','-D',$branch) }
}

function Verify-WorktreeBranch([int]$issue, [string]$worktree) {
    $branch = Get-Am2BranchName $issue
    $cur = (Git-C $worktree @('rev-parse','--abbrev-ref','HEAD') | Out-String).Trim()
    return ($cur -eq $branch)
}

# ---------------------------------------------------------------------------
# Workers
# ---------------------------------------------------------------------------
function Run-Worker([string]$commandLine, [string]$outFile, [string]$errFile, [int]$timeoutSec, [string]$workDir) {
    if ($null -eq $workDir -or $workDir -eq '') { $workDir = $repoRoot }
    # Robust PS 5.1/Java-PS approach: the .cmd wrapper writes the real exit
    # code to a side file so we never rely on Process.ExitCode.
    $cmdFile = Get-TempFile '.cmd'
    $exitFile = Get-TempFile '.exit'
    # `call` is required: opencode/codex are .cmd shims; without `call`, cmd.exe
    # transfers control and our trailing `echo %errorlevel%` never executes.
    $cmdBody = "@echo off`ncd /d `"$workDir`"`n" + "call " + $commandLine + "`n" + "echo %errorlevel% > `"$exitFile`"`nexit /b 0"
    Set-Content -Path $cmdFile -Value $cmdBody -Encoding ASCII
    $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmdFile -RedirectStandardOutput $outFile -RedirectStandardError $errFile -PassThru -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    $timedOut = $false
    while (-not $proc.HasExited) {
        if ((Get-Date) -gt $deadline) { $proc.Kill(); $timedOut = $true; break }
        Sleep 2
    }
    Remove-Item -Force $cmdFile -ErrorAction SilentlyContinue
    $exit = 9999   # sentinel: unknown
    if (-not $timedOut -and (Test-Path $exitFile)) {
        $raw = (Get-Content -Raw -Encoding ASCII $exitFile | Out-String).Trim()
        Remove-Item -Force $exitFile -ErrorAction SilentlyContinue
        if ($raw -match '^\d+$') { $exit = [long]$raw }
    } else {
        Remove-Item -Force $exitFile -ErrorAction SilentlyContinue
    }
    $outText = ''
    $errText = ''
    if (Test-Path $outFile) { $outText = Get-Content -Raw -Encoding UTF8 $outFile }
    if (Test-Path $errFile) { $errText = Get-Content -Raw -Encoding UTF8 $errFile }
    return @{ exit = $exit; timedOut = $timedOut; stdout = $outText; stderr = $errText }
}

function Parse-OpencodeJsonText([string]$stdout) {
    $texts = @()
    foreach ($line in $stdout.Split([char]10)) {
        $line = $line.Trim()
        if ($line -eq '') { continue }
        $obj = $null
        try { $obj = ConvertFrom-Json $line } catch { continue }
        if ($null -eq $obj) { continue }
        if ($obj.type -eq 'text' -and $null -ne $obj.part -and $null -ne $obj.part.text) {
            $texts += $obj.part.text
        }
    }
    if ($texts.Count -eq 0) { return $stdout }
    return $texts[$texts.Count - 1]
}

function Run-Engineer([int]$issue, [string]$worktree, [string]$promptFile, [string]$logPrefix) {
    $issueDir = Join-Path $GLOBAL_logDirRoot "issue-$issue"
    $outLog = Join-Path $issueDir "$logPrefix-stdout.log"
    $errLog = Join-Path $issueDir "$logPrefix-stderr.log"
    $modelArgs = ''
    if ($cfg.EngineerModel -ne '') { $modelArgs = '--model ' + $cfg.EngineerModel + ' ' }
    $msg = 'Execute the agent instructions attached as --file. Work ONLY inside the directory you are started in. Complete the task fully and end with the required machine-readable output block.'
    $cmd = 'opencode run ' + $modelArgs + '--auto --format json --file "' + $promptFile + '" "' + $msg + '"'
    $r = Run-Worker $cmd $outLog $errLog $AM2_WORKER_TIMEOUT_SEC $worktree
    $log = Join-Path $issueDir "$logPrefix.log"
    Log-Write $log "engineer exit=$($r.exit) timedOut=$($r.timedOut)"
    if ($r.timedOut) {
        Log-Write $log 'engineer worker timed out'
        return @{ ok = $false; error = 'engineer worker timed out'; output = '' }
    }
    if ($null -eq $r.exit -or $r.exit -ne 0) {
        Log-Write $log "engineer worker failed with exit $($r.exit)"
        $shortErr = (Sanitize-Secrets ($r.stderr -replace '[ \r\n]+', ' ')).Substring(0, [Math]::Min(500, ((($r.stderr -replace '[ \r\n]+', ' ')).Length)))
        return @{ ok = $false; error = "engineer worker exit $($r.exit): $shortErr"; output = ($r.stderr + [char]10 + $r.stdout) }
    }
    $parsed = Parse-OpencodeJsonText $r.stdout
    return @{ ok = $true; exit = $r.exit; output = $parsed; raw = $r.stdout }
}

function Run-Reviewer([int]$issue, [string]$worktree, [string]$promptFile, [string]$logPrefix) {
    $issueDir = Join-Path $GLOBAL_logDirRoot "issue-$issue"
    $outLog = Join-Path $issueDir "$logPrefix-stdout.log"
    $errLog = Join-Path $issueDir "$logPrefix-stderr.log"
    $outLast = Join-Path $issueDir "$logPrefix-last.txt"
    $cmd = 'codex exec --approve-for-me -o "' + $outLast + '" - < "' + $promptFile + '"'
    $r = Run-Worker $cmd $outLog $errLog $AM2_WORKER_TIMEOUT_SEC $worktree
    $log = Join-Path $issueDir "$logPrefix.log"
    Log-Write $log "reviewer exit=$($r.exit) timedOut=$($r.timedOut)"
    if ($r.timedOut) {
        Log-Write $log 'reviewer worker timed out'
        return @{ ok = $false; error = 'reviewer worker timed out'; output = '' }
    }
    if ($null -eq $r.exit -or $r.exit -ne 0) { return @{ ok = $false; error = "reviewer worker exit $($r.exit)"; output = ($r.stderr + [char]10 + $r.stdout) } }
    $last = ''
    if (Test-Path $outLast) { $last = Get-Content -Raw -Encoding UTF8 $outLast }
    if ($last -eq '') { $last = $r.stdout }
    return @{ ok = $true; exit = $r.exit; output = $last; raw = $r.stdout }
}

# ---------------------------------------------------------------------------
# Prompt building
# ---------------------------------------------------------------------------
function Load-Permanent([string]$name) {
    $p = Join-Path $repoRoot ".agents\$name"
    if (-not (Test-Path $p)) { return "MISSING: $p" }
    return Get-Content -Raw -Encoding UTF8 $p
}

function Build-EngineerPrompt([int]$issueNumber, [string]$title, [string]$body, [string]$stage, $perms, $remediation) {
    $eng = Load-Permanent 'feature-engineer.md'
    $pol = Load-Permanent 'policies.md'
    $wf  = Load-Permanent 'workflow.md'
    $permText = "PERMISSIONS FOR THIS TICKET (label-derived):`npush allowed:   $($perms.pushAllowed)`ndeploy allowed: $($perms.deployAllowed)"
    $remText = ''
    if ($null -ne $remediation -and $remediation.Count -gt 0) {
        $remLines = $remediation | ForEach-Object { "- $_" }
        $remText = "PREVIOUS REVIEWER REMEDIATION ITEMS (fix ONLY these plus any regressions they cause):`n" + ($remLines -join [char]10)
    }
    $stageText = "STAGE: $stage"
    if ($stage -eq 'remediation') { $stageText += " - re-engaging in the SAME worktree (branch agent/issue-$issueNumber). Do not create a new branch." }

    $prompt = @"
TICKET: issue #$issueNumber
TITLE: $title
$stageText

ISSUE BODY:
$body

$permText

$remText

PERMANENT ROLE INSTRUCTIONS
===========================
$eng

SAFETY POLICIES
===============
$pol

WORKFLOW REFERENCE
==================
$wf
"@
    return (Sanitize-Ascii $prompt)
}

function Build-ReviewerPrompt([int]$issueNumber, [string]$title, [string]$body, $perms, [string]$diffStat) {
    $rev = Load-Permanent 'feature-reviewer.md'
    $pol = Load-Permanent 'policies.md'
    $permText = "PERMISSIONS FOR THIS TICKET (label-derived):`npush allowed:   $($perms.pushAllowed)`ndeploy allowed: $($perms.deployAllowed)"
    $prompt = @"
TICKET: issue #$issueNumber
TITLE: $title

ISSUE BODY:
$body

$permText

CURRENT DIFF AGAINST BASELINE (git diff --stat):
$diffStat

PERMANENT REVIEWER INSTRUCTIONS
===============================
$rev

SAFETY POLICIES
===============
$pol
"@
    return (Sanitize-Ascii $prompt)
}

# ---------------------------------------------------------------------------
# Issue data access
# ---------------------------------------------------------------------------
function Get-Am2Issue([int]$number) {
    return Gh-Json @('issue','view',$number,'--repo',$repo,'--json','number,title,body,state,labels,comments')
}

function List-AgentIssues() {
    $json = Gh-Json @('issue','list','--repo',$repo,'--state','open','--limit','100','--json','number,title,body,state,labels')
    if ($null -eq $json) { return @() }
    $arr = @()
    foreach ($x in $json) {
        $hasAgentLabel = $false
        foreach ($l in $x.labels) {
            $n = Normalize-LabelName $l
            if ($n.StartsWith('agent:')) { $hasAgentLabel = $true }
        }
        if ($hasAgentLabel) { $arr += $x }
    }
    return $arr
}

# ---------------------------------------------------------------------------
# Claim
# ---------------------------------------------------------------------------
function Claim-Am2Issue([int]$issue, $currentLabels, [string]$logFile) {
    if ($cfg.NoClaim) { return $true }
    $state = Get-Am2StateFromLabels $currentLabels
    $step = Get-Am2NextStateLabel $state
    if ($step -eq '') { return $false }
    [void](Apply-Am2State $issue $step $currentLabels)
    $iso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
    $lockBody = "AGENT MANAGER - engineering started.`n`nam-lock:$instanceId`:$iso"
    [void](Post-Comment $issue $lockBody)
    [void](Log-Write $logFile "claim: issue=$issue instance=$instanceId state=$step")
    $fresh = Get-Am2Issue $issue
    $freshState = Get-Am2StateFromLabels $fresh.labels
    if ($freshState -ne $step) {
        Log-Write $logFile "claim race: issue now $freshState"
        return $false
    }
    $newestLock = Parse-Am2LockComments $fresh.comments
    if ($null -ne $newestLock -and $newestLock.instance -ne $instanceId) {
        Log-Write $logFile "claim lost: newer lock from $($newestLock.instance)"
        return $false
    }
    return $true
}

# ---------------------------------------------------------------------------
# Core issue processing
# ---------------------------------------------------------------------------
function Process-Am2Issue($issueObj, $origState) {
    $number = [int]$issueObj.number
    $issueDir = Join-Path $GLOBAL_logDirRoot "issue-$number"
    if (-not (Test-Path $issueDir)) { New-Item -ItemType Directory -Force -Path $issueDir | Out-Null }
    $issueLog = Join-Path $issueDir 'manager.log'

    $title = [string]$issueObj.title
    $body = [string]$issueObj.body
    $state = Get-Am2StateFromLabels $issueObj.labels
    $perms = Get-Am2Permissions $issueObj.labels

    Write-Host "=== Processing issue #$number [$state] ==="

    if ($state -eq $AM2_LABEL_DONE -or $state -eq $AM2_LABEL_FAILED -or $state -eq $AM2_LABEL_BLOCKED_HUMAN) {
        Write-Host "Issue #$number is in terminal state $state; skipping."
        return
    }

    if ($null -eq $origState -or $origState -eq '') { $origState = $state }
    $stage = Get-Am2ResumeStage $origState $false
    if (($origState -eq $AM2_LABEL_ENGINEERING) -or ($origState -eq $AM2_LABEL_REVIEW)) {
        # Recovery after restart: if the worktree branch already has a commit
        # ahead of base, engineering is considered complete -> send to review.
        $path = Get-WorktreePath $number
        if (Test-Path $path) {
            if (Git-HasCommits $path $cfg.BaseBranch) { $stage = 'review' }
        }
    }

    $worktree = $null
    $cycle = 0
    $latestCommit = ''
    $remediation = @()

    Log-Write $issueLog "processing issue=$number state=$state stage=$stage maxCycles=$($cfg.MaxReviewCycles)"

    while ($true) {
        if ($stage -eq 'implement' -or $stage -eq 'remediation') {
            # ---------- ENGINEER ----------
            if ($worktree -eq $null) { $worktree = Ensure-Worktree $number }
            if (-not (Verify-WorktreeBranch $number $worktree)) {
                Log-Write $issueLog 'engineer gate: worktree branch mismatch; re-deriving'
                Remove-Worktree $number
                $worktree = Ensure-Worktree $number
            }
            $promptFile = Join-Path $issueDir "engineer-$($cycle + 1)-prompt.txt"
            $prompt = Build-EngineerPrompt $number $title $body $stage $perms $remediation
            Write-AsciiFile $promptFile $prompt
            Log-Write $issueLog "engineer started (cycle $($cycle + 1), stage $stage)"
            Post-Comment $number 'AGENT MANAGER - engineering started.'
            $res = Run-Engineer $number $worktree $promptFile "engineer-$($cycle + 1)"
            if (-not $res.ok) {
                $cur = Get-Am2Issue $number
                Apply-Am2State $number $AM2_LABEL_FAILED $cur.labels
                Post-Comment $number "AGENT MANAGER - fatal worker error.`n$(Sanitize-Ascii $res.error)"
                return
            }
            $parsed = Parse-EngineerOutput $res.output
            if ($parsed.malformed) {
                Log-Write $issueLog 'engineer output malformed; failing safe'
                $cur = Get-Am2Issue $number
                Apply-Am2State $number $AM2_LABEL_FAILED $cur.labels
                Post-Comment $number "AGENT MANAGER - worker output could not be parsed deterministically. See logs: .logs/issue-$number/"
                return
            }
            Log-Write $issueLog "engineer result=$($parsed.result) commit=$($parsed.commit) tests=$($parsed.tests) human=$($parsed.human)"

            if ($parsed.result -eq 'PASS') {
                $latestCommit = $parsed.commit
                $cur = Get-Am2Issue $number
                Apply-Am2State $number $AM2_LABEL_REVIEW $cur.labels
                Post-Comment $number "ENGINEERING COMPLETE`nCommit: $latestCommit`nTests: $($parsed.tests)"
                $cycle++
                $stage = 'review'
                continue
            }
            if ($parsed.human -or $parsed.result -eq 'BLOCKED') {
                $cur = Get-Am2Issue $number
                Apply-Am2State $number $AM2_LABEL_BLOCKED_HUMAN $cur.labels
                $blocker = $parsed.blocker
                if ($blocker -eq '') { $blocker = "AGENT_RESULT: $($parsed.result)" }
                Post-Comment $number "AGENT MANAGER - human decision required.`n$(Sanitize-Ascii $blocker)"
                return
            }
            # FAIL
            $cur = Get-Am2Issue $number
            Apply-Am2State $number $AM2_LABEL_FAILED $cur.labels
            Post-Comment $number "AGENT MANAGER - engineering failed (AGENT_RESULT: FAIL). See logs: .logs/issue-$number/"
            return
        }

        if ($stage -eq 'review') {
            # ---------- REVIEWER ----------
            if ($worktree -eq $null) { $worktree = Ensure-Worktree $number }
            if (-not (Verify-WorktreeBranch $number $worktree)) {
                Log-Write $issueLog 'reviewer gate: worktree branch mismatch; re-deriving'
                Remove-Worktree $number
                $worktree = Ensure-Worktree $number
            }
            $base = $cfg.BaseBranch
            $diffStat = (Git-C $worktree @('diff','--stat',"$base...HEAD",'--no-color') | Out-String).Trim()
            $promptFile = Join-Path $issueDir "reviewer-$($cycle + 1)-prompt.txt"
            $prompt = Build-ReviewerPrompt $number $title $body $perms $diffStat
            Write-AsciiFile $promptFile $prompt
            Log-Write $issueLog "reviewer started (cycle $($cycle + 1))"
            Post-Comment $number 'REVIEW STARTED'
            $res = Run-Reviewer $number $worktree $promptFile "reviewer-$($cycle + 1)"
            if (-not $res.ok) {
                $cur = Get-Am2Issue $number
                Apply-Am2State $number $AM2_LABEL_FAILED $cur.labels
                Post-Comment $number "AGENT MANAGER - reviewer fatal error.`n$(Sanitize-Ascii $res.error)"
                return
            }
            $parsed = Parse-ReviewerOutput $res.output
            if ($parsed.malformed) {
                Log-Write $issueLog 'reviewer output malformed; failing safe'
                $cur = Get-Am2Issue $number
                Apply-Am2State $number $AM2_LABEL_FAILED $cur.labels
                Post-Comment $number "AGENT MANAGER - reviewer output could not be parsed deterministically. See logs: .logs/issue-$number/"
                return
            }
            Log-Write $issueLog "reviewer verdict=$($parsed.verdict) cycle=$cycle max=$($cfg.MaxReviewCycles)"

            if ($parsed.verdict -eq 'PASS') {
                $cur = Get-Am2Issue $number
                Apply-Am2State $number $AM2_LABEL_DONE $cur.labels
                Post-Comment $number "AGENT DONE`nFinal commit: $latestCommit`nReview cycles: $cycle`nTests: PASS"
                Write-Host "Issue #$number DONE"
                return
            }
            if ($parsed.verdict -eq 'BLOCKED') {
                $cur = Get-Am2Issue $number
                Apply-Am2State $number $AM2_LABEL_BLOCKED_HUMAN $cur.labels
                $blocker = $parsed.blocker
                if ($blocker -eq '') { $blocker = 'reviewer BLOCKED without explanation' }
                Post-Comment $number "AGENT MANAGER - human decision required.`n$(Sanitize-Ascii $blocker)"
                return
            }
            # REMEDIATION_REQUIRED
            $remediation = $parsed.remediation
            if ($cycle -ge $cfg.MaxReviewCycles) {
                $cur = Get-Am2Issue $number
                Apply-Am2State $number $AM2_LABEL_BLOCKED_HUMAN $cur.labels
                $items = ($remediation | ForEach-Object { "- $_" }) -join [char]10
                $comment = "AGENT MANAGER - maximum review cycles ($($cfg.MaxReviewCycles)) reached.`nCycles: $cycle`nBranch: agent/issue-$number`nLatest commit: $latestCommit`nUnresolved items:`n$items"
                Post-Comment $number $comment
                return
            }
            $cur = Get-Am2Issue $number
            Apply-Am2State $number $AM2_LABEL_CHANGES_REQUESTED $cur.labels
            $itemsShort = ($remediation | ForEach-Object { "- $_" }) -join [char]10
            Post-Comment $number "REMEDIATION REQUESTED`n$itemsShort"
            $stage = 'remediation'
            continue
        }
    }
}

# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------
function Run-DryRun() {
    Write-Host ""
    Write-Host "AGENT MANAGER V2 - DRY RUN (no mutations, no workers)"
    Write-Host "Repo: $repo  Instance: $instanceId  Base: $($cfg.BaseBranch)"
    Write-Host ""
    $issues = List-AgentIssues
    $ctx = Build-Am2DependencyCtx $issues
    $ready = Select-Am2ReadyIssues $issues $ctx
    Write-Host ("Selected: " + ((@($ready)).Count))
    foreach ($issue in $ready) {
        $state = Get-Am2StateFromLabels $issue.labels
        $perms = Get-Am2Permissions $issue.labels
        $worker = Get-Am2NextIntendedWorker $state
        $next = Get-Am2NextStateLabel $state
        $num = [int]$issue.number
        Write-Host "---"
        Write-Host "Issue:    #$num $($issue.title)"
        Write-Host "State:    $state"
        Write-Host "Worker:   $worker"
        Write-Host "Worktree: $(Get-WorktreePath $num)"
        Write-Host "Branch:   $(Get-Am2BranchName $num)"
        Write-Host "Perms:    push=$($perms.pushAllowed) deploy=$($perms.deployAllowed) (labels: no-push=$($perms.noPush) no-deploy=$($perms.noDeploy) allow-push=$($perms.allowPush) allow-deploy=$($perms.allowDeploy))"
        Write-Host "Next:     $next"
    }
    if ($ready.Count -eq 0) { Write-Host "No actionable issues." }
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Smoke test
# ---------------------------------------------------------------------------
function Run-SmokeTest() {
    Write-Host "=== AGENT MANAGER V2 SMOKE TEST ==="

    $title = '[AGENT MANAGER V2 SMOKE TEST] Fixture doc'
    $body = @"
Objective:
Create docs/agent-manager-smoke-test-v2.md containing exactly this header line:
# Agent Manager V2 smoke marker

Scope:
- create only that file
- run: git diff --check - must not fail

Acceptance:
- relevant tests green
- builds green

Constraints:
- no deploy
- no push
"@
    $tmpBody = Get-TempFile '.smoke-body.txt'
    Write-AsciiFile $tmpBody $body
    $createArgs = @('issue','create','--repo',$repo,'--title',$title,'--body-file',$tmpBody,'--label','agent:ready')
    $createRes = Invoke-CmdCapture (@('gh') + $createArgs)
    $createOut = Safe-Trim $createRes.out
    Remove-Item -Force $tmpBody -ErrorAction SilentlyContinue
    if ($createRes.exit -ne 0) { Write-Host "SMOKE: failed to create issue (exit $($createRes.exit)): $createOut"; exit 1 }
    if ($createOut -match '/(\d+)$') {
        $smokeIssue = [int]$Matches[1]
    } else {
        Write-Host "SMOKE: could not determine created issue number. Output: $createOut"
        exit 1
    }
    Write-Host "Created disposable issue #$smokeIssue"

    try {
        $issueObj = Get-Am2Issue $smokeIssue
        $claimState = Get-Am2StateFromLabels $issueObj.labels
        if ($claimState -eq $AM2_LABEL_READY) {
            $claimed = Claim-Am2Issue $smokeIssue $issueObj.labels (Join-Path $GLOBAL_logDirRoot "issue-$smokeIssue\manager.log")
            $issueObj = Get-Am2Issue $smokeIssue
        }
        Process-Am2Issue $issueObj $AM2_LABEL_READY
        $final = Get-Am2Issue $smokeIssue
        $finalState = Get-Am2StateFromLabels $final.labels
        Write-Host "SMOKE final state: $finalState"
        if ($finalState -eq $AM2_LABEL_DONE) { Write-Host "SMOKE PASSED (agent:done)" }
        else { Write-Host "SMOKE FAILED (final state $finalState)" }
    } finally {
        Write-Host "SMOKE: cleaning up issue #$smokeIssue and worktree"
        $null = Invoke-GhNative @('issue','close',$smokeIssue,'--repo',$repo,'--yes')
        $null = Invoke-GhNative @('issue','delete',$smokeIssue,'--repo',$repo,'--yes')
        $null = Remove-Worktree $smokeIssue
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
function Main() {
    Initialize-Am2Env
    if (-not (Test-Path $GLOBAL_logDirRoot)) { New-Item -ItemType Directory -Force -Path $GLOBAL_logDirRoot | Out-Null }

    $requirements = @('git', 'gh', 'opencode', 'codex')
    foreach ($req in $requirements) {
        if (-not (Get-Command $req -ErrorAction SilentlyContinue)) {
            Write-Host "ERROR: required command not found: $req"
            exit 1
        }
    }

    if ($cfg.DryRun) {
        Run-DryRun
        exit 0
    }

    Ensure-Am2Labels

    if ($cfg.SmokeTest) {
        Run-SmokeTest
        exit 0
    }

    $mainLog = Join-Path $GLOBAL_logDirRoot 'manager.log'
    Log-Write $mainLog "manager started repo=$repo instance=$instanceId maxCycles=$($cfg.MaxReviewCycles)"

    while ($true) {
        $issues = List-AgentIssues
        $ctx = Build-Am2DependencyCtx $issues
        $processed = $false

        $targetCandidates = @()
        if ($null -ne $cfg.Target) {
            $t = Get-Am2Issue $cfg.Target
            $targetCandidates = @($t)
        } else {
            $targetCandidates = Select-Am2ReadyIssues $issues $ctx
        }

        foreach ($issue in $targetCandidates) {
            $num = [int]$issue.number
            $state = Get-Am2StateFromLabels $issue.labels
            if ($state -eq $AM2_LABEL_DONE -or $state -eq $AM2_LABEL_FAILED -or $state -eq $AM2_LABEL_BLOCKED_HUMAN) {
                Write-Host "Issue #$num is in terminal state $state; nothing to do."
                $processed = $true
                break
            }
            if ($state -eq $AM2_LABEL_READY -or $state -eq $AM2_LABEL_CHANGES_REQUESTED) {
                $claimed = Claim-Am2Issue $num $issue.labels (Join-Path $GLOBAL_logDirRoot "issue-$num\manager.log")
                if (-not $claimed) {
                    Write-Host "Claim lost for #$num (another manager active)."
                    $processed = $true
                    break
                }
                $fresh = Get-Am2Issue $num
                Process-Am2Issue $fresh $state
                $processed = $true
                break
            }
            # engineering/review states -> continue pipeline (resume)
            $fresh = Get-Am2Issue $num
            Process-Am2Issue $fresh
            $processed = $true
            break
        }

        # Recovery: tickets stuck in engineering/review not already processed
        if (-not $processed) {
            foreach ($issue in $issues) {
                $state = Get-Am2StateFromLabels $issue.labels
                if ($state -ne $AM2_LABEL_ENGINEERING -and $state -ne $AM2_LABEL_REVIEW) { continue }
                $num = [int]$issue.number
                if ($null -ne $cfg.Target -and $num -ne $cfg.Target) { continue }
                Write-Host "Recovering issue #$num from state $state"
                $fresh = Get-Am2Issue $num
                Process-Am2Issue $fresh
                $processed = $true
                break
            }
        }

        if ($cfg.Once -or $cfg.PollInterval -le 0) { exit 0 }

        Write-Host "No actionable issues; sleeping $($cfg.PollInterval)s (Ctrl+C to stop)..."
        Sleep $cfg.PollInterval
    }
}

Main
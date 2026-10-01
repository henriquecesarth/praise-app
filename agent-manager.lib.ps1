# agent-manager.lib.ps1
# Agent Manager V2 - pure logic library (no network, no git, no side effects).
# PowerShell 5.1 compatible, ASCII-only.
# Dot-source this file from the manager or from Pester tests; then call functions.

# ---------------------------------------------------------------------------
# Label constants
# ---------------------------------------------------------------------------
$AM2_LABEL_READY             = 'agent:ready'
$AM2_LABEL_ENGINEERING       = 'agent:engineering'
$AM2_LABEL_REVIEW            = 'agent:review'
$AM2_LABEL_CHANGES_REQUESTED = 'agent:changes-requested'
$AM2_LABEL_BLOCKED_HUMAN     = 'agent:blocked-human'
$AM2_LABEL_DONE              = 'agent:done'
$AM2_LABEL_FAILED            = 'agent:failed'

$AM2_LABEL_NO_PUSH      = 'agent:no-push'
$AM2_LABEL_NO_DEPLOY    = 'agent:no-deploy'
$AM2_LABEL_ALLOW_PUSH   = 'agent:allow-push'
$AM2_LABEL_ALLOW_DEPLOY = 'agent:allow-deploy'

# Legacy v5 labels (read-mapped only; never written by V2 manager)
$AM2_LEGACY_RUNNING = 'agent:running'
$AM2_LEGACY_PR      = 'agent:pr'
$AM2_LEGACY_BLOCKED = 'agent:blocked'

# Default loop safety
$AM2_DEFAULT_MAX_REVIEW_CYCLES = 3

# Machine-readable output tokens
$AM2_TOKEN_AGENT_RESULT   = 'AGENT_RESULT:'
$AM2_TOKEN_COMMIT         = 'COMMIT:'
$AM2_TOKEN_TESTS          = 'TESTS:'
$AM2_TOKEN_HUMAN_DECISION = 'HUMAN_DECISION_REQUIRED:'
$AM2_TOKEN_BLOCKER        = 'BLOCKER:'
$AM2_TOKEN_REVIEW_VERDICT = 'REVIEW_VERDICT:'
$AM2_TOKEN_REMEDIATION    = 'REMEDIATION:'

$AM2_VALID_RESULTS  = @('PASS', 'BLOCKED', 'FAIL')
$AM2_VALID_VERDICTS = @('PASS', 'REMEDIATION_REQUIRED', 'BLOCKED')
$AM2_VALID_TESTS    = @('PASS', 'FAIL', 'NOT_RUN')

# ---------------------------------------------------------------------------
# Sanitization (encoding / secrets)
# ---------------------------------------------------------------------------
function Sanitize-Ascii([string]$text) {
    if ($null -eq $text) { return '' }
    $chars = $text.ToCharArray()
    $out = New-Object System.Text.StringBuilder
    foreach ($ch in $chars) {
        $code = [int][char]$ch
        if (($code -ge 32 -and $code -le 126) -or $code -eq 10 -or $code -eq 13 -or $code -eq 9) { [void]$out.Append($ch) }
        else { [void]$out.Append('?') }
    }
    return $out.ToString()
}

function Sanitize-Secrets([string]$text) {
    # Redact common credential shapes before logging.
    if ($null -eq $text) { return '' }
    $t = $text
    $t = [regex]::Replace($t, '(?i)(gh[osu]_)[A-Za-z0-9_]+', '$1<<REDACTED>>')
    $t = [regex]::Replace($t, '(?i)(github_pat_)[A-Za-z0-9_]+', '$1<<REDACTED>>')
    $t = [regex]::Replace($t, '(?i)(Bearer\s+)[A-Za-z0-9._-]+', '$1<<REDACTED>>')
    $t = [regex]::Replace($t, '(?i)(sk-[A-Za-z0-9]{8,})', 'sk-<<REDACTED>>')
    $t = [regex]::Replace($t, '(?i)(password\s*[=:]\s*)[^\s]+', '$1<<REDACTED>>')
    return $t
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Normalize-LabelName($lbl) {
    if ($null -eq $lbl) { return '' }
    if ($lbl -is [string]) { return $lbl }
    if ($lbl -is [object]) {
        try { return $lbl.name } catch { return '' }
    }
    return $lbl.ToString()
}

function Has-Item($arr, [string]$item) {
    if ($null -eq $arr) { return $false }
    foreach ($x in $arr) {
        if ((Normalize-LabelName $x) -eq $item) { return $true }
    }
    return $false
}

function Join-Labels($labels) {
    $names = @()
    foreach ($lbl in $labels) { $names += Normalize-LabelName $lbl }
    return ($names -join ' ')
}

# ---------------------------------------------------------------------------
# State machine: labels -> canonical state
# ---------------------------------------------------------------------------
function Get-Am2StateFromLabels($labels) {
    if ($null -eq $labels) { return $null }
    $s = Join-Labels $labels
    if ($s -match '\bagent:ready\b') { return $AM2_LABEL_READY }
    if ($s -match '\bagent:engineering\b') { return $AM2_LABEL_ENGINEERING }
    if ($s -match '\bagent:review\b') { return $AM2_LABEL_REVIEW }
    if ($s -match '\bagent:changes-requested\b') { return $AM2_LABEL_CHANGES_REQUESTED }
    if ($s -match '\bagent:blocked-human\b') { return $AM2_LABEL_BLOCKED_HUMAN }
    if ($s -match '\bagent:done\b') { return $AM2_LABEL_DONE }
    if ($s -match '\bagent:failed\b') { return $AM2_LABEL_FAILED }
    # legacy read mapping (v5)
    if ($s -match '\bagent:running\b') { return $AM2_LABEL_ENGINEERING }
    if ($s -match '\bagent:pr\b') { return $AM2_LABEL_DONE }
    if ($s -match '\bagent:blocked\b') { return $AM2_LABEL_BLOCKED_HUMAN }
    return $null
}

# ---------------------------------------------------------------------------
# Permissions (label-driven only; issue text can never override)
# ---------------------------------------------------------------------------
function Get-Am2Permissions($labels) {
    if ($null -eq $labels) { $labels = @() }
    $noPush      = Has-Item $labels $AM2_LABEL_NO_PUSH
    $noDeploy    = Has-Item $labels $AM2_LABEL_NO_DEPLOY
    $allowPush   = Has-Item $labels $AM2_LABEL_ALLOW_PUSH
    $allowDeploy = Has-Item $labels $AM2_LABEL_ALLOW_DEPLOY

    return @{
        pushAllowed   = ($allowPush -and (-not $noPush))
        deployAllowed = ($allowDeploy -and (-not $noDeploy))
        noPush        = $noPush
        noDeploy      = $noDeploy
        allowPush     = $allowPush
        allowDeploy   = $allowDeploy
    }
}

# ---------------------------------------------------------------------------
# Label delta when moving to a new state label (single source of truth).
# Removes all other AM2 state labels (canonical + legacy) and adds target.
# ---------------------------------------------------------------------------
function Get-Am2LabelDelta($currentLabels, [string]$newStateLabel) {
    $allStates = @(
        $AM2_LABEL_READY, $AM2_LABEL_ENGINEERING, $AM2_LABEL_REVIEW,
        $AM2_LABEL_CHANGES_REQUESTED, $AM2_LABEL_BLOCKED_HUMAN,
        $AM2_LABEL_DONE, $AM2_LABEL_FAILED,
        $AM2_LEGACY_RUNNING, $AM2_LEGACY_PR, $AM2_LEGACY_BLOCKED
    )
    $remove = @()
    foreach ($st in $allStates) {
        if (($st -ne $newStateLabel) -and (Has-Item $currentLabels $st)) { $remove += $st }
    }
    $add = @()
    if (-not (Has-Item $currentLabels $newStateLabel)) { $add = @($newStateLabel) }
    return @{ add = $add; remove = $remove }
}

# ---------------------------------------------------------------------------
# Engineer output parsing (deterministic, fail-safe)
# ---------------------------------------------------------------------------
function Parse-EngineerOutput([string]$text) {
    $res = @{
        result = $null
        commit = ''
        tests  = 'NOT_RUN'
        human  = $false
        blocker = ''
        malformed = $false
    }
    if ($null -eq $text) { $text = '' }

    if ($text -match '(?m)^\s*AGENT_RESULT:\s*([A-Z_]+)') {
        $res.result = $Matches[1].Trim()
    } else {
        $res.malformed = $true
        return $res
    }
    if (-not ($AM2_VALID_RESULTS -contains $res.result)) { $res.malformed = $true; return $res }

    if ($text -match '(?m)^\s*COMMIT:\s*([0-9a-fA-F]{40}|NONE)\b') {
        $res.commit = $Matches[1]
    } else {
        $res.malformed = $true
        return $res
    }
    if ($text -match '(?m)^\s*TESTS:\s*([A-Z_]+)') {
        $res.tests = $Matches[1].Trim().ToUpper()
        if (-not ($AM2_VALID_TESTS -contains $res.tests)) { $res.tests = 'NOT_RUN' }
    }
    if ($text -match '(?m)^\s*HUMAN_DECISION_REQUIRED:\s*(YES|NO)') {
        $res.human = ($Matches[1].Trim().ToUpper() -eq 'YES')
    }
    if ($text -match '(?m)^\s*BLOCKER:\s*(.+)') {
        $res.blocker = [string](Sanitize-Secrets $Matches[1]).Trim()
    }
    # Consistency rules
    if ($res.result -eq 'PASS' -and $res.commit -eq 'NONE') { $res.malformed = $true; return $res }
    if ($res.result -eq 'PASS' -and $res.commit -ne '') {
        if (-not ($res.commit -match '^[0-9a-fA-F]{40}$')) { $res.malformed = $true; return $res }
    }
    if ($res.result -ne 'PASS' -and $res.commit -ne '' -and $res.commit -ne 'NONE') {
        $res.commit = ''
    }
    return $res
}

# ---------------------------------------------------------------------------
# Reviewer output parsing (deterministic, fail-safe)
# ---------------------------------------------------------------------------
function Parse-ReviewerOutput([string]$text) {
    $res = @{
        verdict = $null
        remediation = @()
        blocker = ''
        malformed = $false
    }
    if ($null -eq $text) { $text = '' }

    if ($text -match '(?m)^\s*REVIEW_VERDICT:\s*([A-Z_]+)') {
        $res.verdict = $Matches[1].Trim().ToUpper()
    } else {
        $res.malformed = $true
        return $res
    }
    if (-not ($AM2_VALID_VERDICTS -contains $res.verdict)) { $res.malformed = $true; return $res }

    if ($res.verdict -eq 'REMEDIATION_REQUIRED') {
        $items = @()
        $inRemediation = $false
        foreach ($raw in $text.Split([char]10)) {
            $ln = $raw.Trim()
            if ($ln -match '(?i)^REMEDIATION:') { $inRemediation = $true; continue }
            if ($inRemediation) {
                if ($ln.StartsWith('- ')) {
                    $items += [string](Sanitize-Secrets ($ln.Substring(2))).Trim()
                } elseif ($ln -match '^(AGENT_RESULT|COMMIT|TESTS|HUMAN_DECISION|REVIEW_VERDICT|BLOCKER):') {
                    $inRemediation = $false
                } elseif ($ln -ne '') {
                    $inRemediation = $false
                }
            }
        }
        $res.remediation = $items
    }
    if ($text -match '(?m)^\s*BLOCKER:\s*(.+)') {
        $res.blocker = [string](Sanitize-Secrets $Matches[1]).Trim()
    }
    return $res
}

# ---------------------------------------------------------------------------
# Human decision comments (AM2-HUMAN-DECISION marker)
# ---------------------------------------------------------------------------
# Chronological list of all AM2-HUMAN-DECISION values from issue comments.
function Get-Am2HumanDecisions($comments) {
    $out = @()
    if ($null -eq $comments) { return $out }
    $sorted = @($comments | Sort-Object { [string]$_.createdAt })
    foreach ($c in $sorted) {
        $body = ''
        if ($c -is [object]) { try { $body = [string]$c.body } catch { } } elseif ($c -is [string]) { $body = $c }
        foreach ($m in [regex]::Matches($body, '(?im)^\s*AM2-HUMAN-DECISION:\s*(.+?)\s*$')) {
            $out += [string](Sanitize-Secrets ($m.Groups[1].Value.Trim()))
        }
    }
    return $out
}

# True when any comment after $iso carries a decision marker.
function Test-Am2AnyDecisionAfter($comments, [string]$iso) {
    if ($null -eq $comments) { return $false }
    foreach ($c in $comments) {
        $body = ''
        $created = ''
        if ($c -is [object]) {
            try { $body = [string]$c.body } catch { }
            try { $created = [string]$c.createdAt } catch { }
        } elseif ($c -is [string]) { $body = $c }
        if ($body -notmatch '(?im)^\s*AM2-HUMAN-DECISION:') { continue }
        if ($iso -eq '') { return $true }
        if ($created -ne '' -and $created -gt $iso) { return $true }
    }
    return $false
}

# Normalized comparison key for blocker texts (case/punctuation/whitespace insensitive).
function Get-Am2BlockerFingerprint([string]$text) {
    if ($null -eq $text) { return '' }
    $t = [string](Sanitize-Secrets $text).ToLower()
    $t = $t -replace '[^a-z0-9]+', ' '
    return $t.Trim()
}

# Chronological @{ iso; fingerprint } for each manager 'human decision required' comment.
function Get-Am2BlockerHistory($comments) {
    $out = @()
    if ($null -eq $comments) { return $out }
    $sorted = @($comments | Sort-Object { [string]$_.createdAt })
    foreach ($c in $sorted) {
        $body = ''
        $created = ''
        if ($c -is [object]) {
            try { $body = [string]$c.body } catch { }
            try { $created = [string]$c.createdAt } catch { }
        } elseif ($c -is [string]) { $body = $c }
        if ($body -notmatch '(?i)human decision required') { continue }
        $idx = $body.IndexOf([char]10)
        $blockerText = ''
        if ($idx -ge 0) { $blockerText = $body.Substring($idx + 1) }
        $out += @{ iso = $created; fingerprint = (Get-Am2BlockerFingerprint $blockerText) }
    }
    return $out
}

# True when the SAME blocker was already requested before and a human decision
# exists after that request: re-asking is a worker failure, not a new blocker.
function Test-Am2BlockerAlreadyAnswered($comments, [string]$newBlockerText) {
    $fp = Get-Am2BlockerFingerprint $newBlockerText
    if ($fp -eq '') { return $false }
    foreach ($b in (Get-Am2BlockerHistory $comments)) {
        if ($b.fingerprint -ne $fp) { continue }
        if (Test-Am2AnyDecisionAfter $comments $b.iso) { return $true }
    }
    return $false
}

function Build-Am2HumanContext([string[]]$decisions) {
    if ($null -eq $decisions -or $decisions.Count -eq 0) { return '' }
    $lines = $decisions | ForEach-Object { "- $_" }
    return "HUMAN DECISIONS (binding, provided by the repository owner after blockers):`n" + ($lines -join [char]10)
}

# ---------------------------------------------------------------------------
# Dependencies (Depends-On: #42, #43)
# ---------------------------------------------------------------------------
function Get-Am2Dependencies([string]$body) {
    $deps = @()
    if ($null -eq $body -or $body -eq '') { return $deps }
    foreach ($raw in $body.Split([char]10)) {
        $ln = $raw.Trim()
        if ($ln -match '(?i)^Depends-On\s*:') {
            $rest = $ln.Substring($ln.IndexOf(':') + 1)
            foreach ($m in [regex]::Matches($rest, '#\s*(\d+)')) {
                $deps += [int]$m.Groups[1].Value
            }
        }
    }
    return ($deps | Sort-Object -Unique)
}

# dependencyCtx: hashtable issueNumber(string) -> labels array
function Test-Am2DependenciesMet($deps, $dependencyCtx) {
    $missing = @()
    foreach ($d in $deps) {
        $labels = $null
        if ((Has-Key $dependencyCtx $d.ToString())) { $labels = $dependencyCtx[$d.ToString()] }
        $state = Get-Am2StateFromLabels $labels
        if ($state -ne $AM2_LABEL_DONE) { $missing += $d }
    }
    return @{ met = ($missing.Count -eq 0); missing = $missing }
}

function Has-Key($hash, [string]$key) {
    if ($null -eq $hash) { return $false }
    foreach ($k in $hash.Keys) { if ($k.ToString() -eq $key) { return $true } }
    return $false
}

# Build dependency context: hashtable issueNumber(string) -> labels array
function Build-Am2DependencyCtx($issues) {
    $ctx = @{}
    foreach ($x in $issues) {
        $ctx[(($x.number).ToString())] = $x.labels
    }
    return $ctx
}

# ---------------------------------------------------------------------------
# State transitions
# ---------------------------------------------------------------------------
function Get-Am2NextStateForEngineer($result, $humanDecision) {
    if ($humanDecision) { return $AM2_LABEL_BLOCKED_HUMAN }
    if ($result -eq 'PASS') { return $AM2_LABEL_REVIEW }
    if ($result -eq 'BLOCKED') { return $AM2_LABEL_BLOCKED_HUMAN }
    return $AM2_LABEL_FAILED
}

function Get-Am2NextStateForReview($verdict, $remediationFound, $cycle, $maxCycles) {
    if ($verdict -eq 'PASS') { return $AM2_LABEL_DONE }
    if ($verdict -eq 'BLOCKED') { return $AM2_LABEL_BLOCKED_HUMAN }
    if ($verdict -eq 'REMEDIATION_REQUIRED') {
        if ($remediationFound) {
            if ($cycle -ge $maxCycles) { return $AM2_LABEL_BLOCKED_HUMAN }
            return $AM2_LABEL_CHANGES_REQUESTED
        }
        # remediation requested but no items -> cannot act, ask human
        return $AM2_LABEL_BLOCKED_HUMAN
    }
    return $AM2_LABEL_FAILED
}

# ---------------------------------------------------------------------------
# Claim / concurrency (comment lock)
# ---------------------------------------------------------------------------
function Get-Am2LockToken([string]$instance, [string]$iso) {
    return "am-lock:$instance`:$iso"
}

function Parse-Am2LockComments($comments) {
    # returns newest lock: @{ instance; iso; createdAt } or $null
    $newest = $null
    if ($null -eq $comments) { return $newest }
    foreach ($c in $comments) {
        $body = ''
        $created = ''
        if ($c -is [object]) {
            try { $body = $c.body } catch { }
            try { $created = $c.createdAt } catch { }
        } elseif ($c -is [string]) { $body = $c }
        foreach ($m in [regex]::Matches([string]$body, 'am-lock:([^:\s]+):([0-9TZ:.\-]+)')) {
            $tok = @{ instance = $m.Groups[1].Value; iso = $m.Groups[2].Value; createdAt = $created }
            if ($null -eq $newest) { $newest = $tok }
            elseif ($created -gt $newest.createdAt) { $newest = $tok }
        }
    }
    return $newest
}

# ---------------------------------------------------------------------------
# Worktree / branch naming
# ---------------------------------------------------------------------------
function Get-Am2WorktreeName([int]$issueNumber) { return "issue-$issueNumber" }
function Get-Am2BranchName([int]$issueNumber) { return "agent/issue-$issueNumber" }

# Recovery stage derivation (restart-safe, pure logic).
# state: canonical state labels; hasCommit: worktree branch ahead of base.
function Get-Am2ResumeStage($state, [bool]$hasCommit) {
    if ($state -eq $AM2_LABEL_CHANGES_REQUESTED) { return 'remediation' }
    if ($state -eq $AM2_LABEL_REVIEW) { return 'review' }
    if ($state -eq $AM2_LABEL_ENGINEERING) {
        if ($hasCommit) { return 'review' }
        return 'implement'
    }
    return 'implement'
}

# ---------------------------------------------------------------------------
# Event type -> worker intent (used by dry-run and orchestration)
# ---------------------------------------------------------------------------
function Get-Am2NextIntendedWorker($state) {
    if ($state -eq $AM2_LABEL_READY -or $state -eq $AM2_LABEL_CHANGES_REQUESTED) { return 'feature-engineer' }
    if ($state -eq $AM2_LABEL_ENGINEERING) { return 'feature-engineer' }
    if ($state -eq $AM2_LABEL_REVIEW) { return 'feature-reviewer' }
    return ''
}

function Get-Am2NextStateLabel($state) {
    # returns the label the manager should apply as the next step.
    if ($state -eq $AM2_LABEL_READY -or $state -eq $AM2_LABEL_CHANGES_REQUESTED) { return $AM2_LABEL_ENGINEERING }
    if ($state -eq $AM2_LABEL_ENGINEERING) { return $AM2_LABEL_REVIEW }
    return ''
}

# ---------------------------------------------------------------------------
# Readiness filter for issue selection
# issues: array of hashtables { number, labels, body }
# dependencyCtx: issueNumber(string) -> labels
# ---------------------------------------------------------------------------
function Select-Am2ReadyIssues($issues, $dependencyCtx) {
    $ready = @()
    if ($null -eq $issues) { return $ready }
    foreach ($issue in $issues) {
        $state = Get-Am2StateFromLabels $issue.labels
        if ($state -ne $AM2_LABEL_READY -and $state -ne $AM2_LABEL_CHANGES_REQUESTED) { continue }
        $deps = Get-Am2Dependencies $issue.body
        if ($deps.Count -eq 0) { $ready += $issue; continue }
        $check = Test-Am2DependenciesMet $deps $dependencyCtx
        if ($check.met) { $ready += $issue }
    }
    return $ready
}
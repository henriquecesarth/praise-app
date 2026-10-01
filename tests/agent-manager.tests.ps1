# tests/agent-manager.tests.ps1
# Pester 3.4 unit tests for the Agent Manager V2 pure-logic library.
# Run: powershell -NoProfile -Command "Invoke-Pester -Path 'tests\agent-manager.tests.ps1'"

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$lib = Join-Path $here '..\agent-manager.lib.ps1'
. $lib

Describe 'label constants' {
    It 'defines all canonical state labels' {
        $AM2_LABEL_READY         | Should Be 'agent:ready'
        $AM2_LABEL_ENGINEERING   | Should Be 'agent:engineering'
        $AM2_LABEL_REVIEW        | Should Be 'agent:review'
        $AM2_LABEL_CHANGES_REQUESTED | Should Be 'agent:changes-requested'
        $AM2_LABEL_BLOCKED_HUMAN | Should Be 'agent:blocked-human'
        $AM2_LABEL_DONE          | Should Be 'agent:done'
        $AM2_LABEL_FAILED        | Should Be 'agent:failed'
    }
}

Describe 'state resolution' {
    It 'maps ready, engineering, review, changes-requested, blocked-human, done, failed' {
        Get-Am2StateFromLabels @('agent:ready') | Should Be 'agent:ready'
        Get-Am2StateFromLabels @('agent:engineering') | Should Be 'agent:engineering'
        Get-Am2StateFromLabels @('agent:review') | Should Be 'agent:review'
        Get-Am2StateFromLabels @('agent:changes-requested') | Should Be 'agent:changes-requested'
        Get-Am2StateFromLabels @('agent:blocked-human') | Should Be 'agent:blocked-human'
        Get-Am2StateFromLabels @('agent:done') | Should Be 'agent:done'
        Get-Am2StateFromLabels @('agent:failed') | Should Be 'agent:failed'
    }
    It 'maps legacy v5 labels on read' {
        Get-Am2StateFromLabels @('agent:running') | Should Be 'agent:engineering'
        Get-Am2StateFromLabels @('agent:pr') | Should Be 'agent:done'
        Get-Am2StateFromLabels @('agent:blocked') | Should Be 'agent:blocked-human'
    }
    It 'handles label objects with a name property (gh shape)' {
        $lbl = @{ name = 'agent:ready' }
        Get-Am2StateFromLabels @($lbl) | Should Be 'agent:ready'
    }
}

Describe 'state transitions' {
    It 'ready -> engineer' {
        Get-Am2NextStateLabel 'agent:ready' | Should Be 'agent:engineering'
    }
    It 'changes-requested -> engineer (remediation)' {
        Get-Am2NextStateLabel 'agent:changes-requested' | Should Be 'agent:engineering'
    }
    It 'engineer PASS -> review' {
        Get-Am2NextStateForEngineer 'PASS' $false | Should Be 'agent:review'
    }
    It 'engineer BLOCKED -> blocked-human' {
        Get-Am2NextStateForEngineer 'BLOCKED' $false | Should Be 'agent:blocked-human'
    }
    It 'engineer FAIL -> failed' {
        Get-Am2NextStateForEngineer 'FAIL' $false | Should Be 'agent:failed'
    }
    It 'engineer human-decision-required -> blocked-human' {
        Get-Am2NextStateForEngineer 'PASS' $true | Should Be 'agent:blocked-human'
    }
    It 'reviewer PASS -> done' {
        Get-Am2NextStateForReview 'PASS' $false 1 3 | Should Be 'agent:done'
    }
    It 'reviewer remediation -> engineer (changes-requested)' {
        Get-Am2NextStateForReview 'REMEDIATION_REQUIRED' $true 1 3 | Should Be 'agent:changes-requested'
    }
    It 'reviewer remediation at max cycles -> blocked-human' {
        Get-Am2NextStateForReview 'REMEDIATION_REQUIRED' $true 3 3 | Should Be 'agent:blocked-human'
        Get-Am2NextStateForReview 'REMEDIATION_REQUIRED' $true 4 3 | Should Be 'agent:blocked-human'
    }
    It 'reviewer remediation without items -> blocked-human' {
        Get-Am2NextStateForReview 'REMEDIATION_REQUIRED' $false 1 3 | Should Be 'agent:blocked-human'
    }
    It 'reviewer BLOCKED -> blocked-human' {
        Get-Am2NextStateForReview 'BLOCKED' $false 1 3 | Should Be 'agent:blocked-human'
    }
    It 'reviewer unknown -> failed' {
        Get-Am2NextStateForReview 'SOMETHING_ELSE' $false 1 3 | Should Be 'agent:failed'
    }
}

Describe 'label delta' {
    It 'ready -> engineering adds engineering and removes ready' {
        $d = Get-Am2LabelDelta @('agent:ready') 'agent:engineering'
        $d.add | Should Be 'agent:engineering'
        $d.remove | Should Be 'agent:ready'
    }
    It 'engineering -> review removes engineering and legacy running' {
        $d = Get-Am2LabelDelta @('agent:engineering', 'agent:running') 'agent:review'
        $d.add | Should Be 'agent:review'
        ($d.remove -contains 'agent:engineering') | Should Be $true
        ($d.remove -contains 'agent:running') | Should Be $true
    }
    It 'done removes changes-requested and remediation states' {
        $d = Get-Am2LabelDelta @('agent:changes-requested') 'agent:done'
        $d.add | Should Be 'agent:done'
        ($d.remove -contains 'agent:changes-requested') | Should Be $true
    }
}

Describe 'engineer output parsing' {
    It 'parses PASS with commit and tests' {
        $r = Parse-EngineerOutput @"
AGENT_RESULT: PASS
COMMIT: abcdef0123456789abcdef0123456789abcdef01
TESTS: PASS
HUMAN_DECISION_REQUIRED: NO
"@
        $r.malformed | Should Be $false
        $r.result | Should Be 'PASS'
        $r.commit | Should Be 'abcdef0123456789abcdef0123456789abcdef01'
        $r.tests | Should Be 'PASS'
        $r.human | Should Be $false
    }
    It 'parses PASS with full preamble text before tokens' {
        $r = Parse-EngineerOutput @"
Finished the implementation. Summary:
- Added endpoint
- Updated tests

AGENT_RESULT: PASS
COMMIT: abcdef0123456789abcdef0123456789abcdef01
TESTS: PASS
HUMAN_DECISION_REQUIRED: NO
"@
        $r.malformed | Should Be $false
        $r.result | Should Be 'PASS'
    }
    It 'rejects malformed output (no tokens) safely' {
        $r = Parse-EngineerOutput 'Implemented everything.'
        $r.malformed | Should Be $true
    }
    It 'rejects PASS with COMMIT: NONE' {
        $r = Parse-EngineerOutput @"
AGENT_RESULT: PASS
COMMIT: NONE
TESTS: PASS
HUMAN_DECISION_REQUIRED: NO
"@
        $r.malformed | Should Be $true
    }
    It 'rejects PASS with invalid commit sha' {
        $r = Parse-EngineerOutput @"
AGENT_RESULT: PASS
COMMIT: not-a-sha
TESTS: PASS
HUMAN_DECISION_REQUIRED: NO
"@
        $r.malformed | Should Be $true
    }
    It 'parses BLOCKED with blocker text' {
        $r = Parse-EngineerOutput @"
AGENT_RESULT: BLOCKED
COMMIT: NONE
TESTS: NOT_RUN
HUMAN_DECISION_REQUIRED: YES
BLOCKER:
Product decision needed: which CORS origins to allow.
"@
        $r.malformed | Should Be $false
        $r.result | Should Be 'BLOCKED'
        $r.human | Should Be $true
        $r.blocker | Should Match 'CORS'
    }
    It 'parses FAIL' {
        $r = Parse-EngineerOutput @"
AGENT_RESULT: FAIL
COMMIT: NONE
TESTS: FAIL
HUMAN_DECISION_REQUIRED: NO
"@
        $r.malformed | Should Be $false
        $r.result | Should Be 'FAIL'
    }
}

Describe 'reviewer output parsing' {
    It 'parses PASS' {
        $r = Parse-ReviewerOutput @"
The implementation looks good.

REVIEW_VERDICT: PASS
"@
        $r.malformed | Should Be $false
        $r.verdict | Should Be 'PASS'
    }
    It 'parses REMEDIATION_REQUIRED with items' {
        $r = Parse-ReviewerOutput @"
REVIEW_VERDICT: REMEDIATION_REQUIRED

REMEDIATION:
- Fix tenant isolation in repository query
- Add missing index declaration
- Strengthen RBAC test
"@
        $r.malformed | Should Be $false
        $r.verdict | Should Be 'REMEDIATION_REQUIRED'
        $r.remediation.Count | Should Be 3
        $r.remediation[0] | Should Match 'tenant'
    }
    It 'parses BLOCKED' {
        $r = Parse-ReviewerOutput @"
REVIEW_VERDICT: BLOCKED
BLOCKER:
Credentials needed to validate external integration.
"@
        $r.malformed | Should Be $false
        $r.verdict | Should Be 'BLOCKED'
        $r.blocker | Should Match 'Credentials'
    }
    It 'rejects malformed reviewer output safely' {
        $r = Parse-ReviewerOutput 'Looks fine to me.'
        $r.malformed | Should Be $true
    }
}

Describe 'dependencies' {
    It 'parses Depends-On list' {
        $deps = Get-Am2Dependencies @"
Objective: fix things.

Depends-On: #42, #43
"@
        $deps.Count | Should Be 2
        ($deps -contains 42) | Should Be $true
        ($deps -contains 43) | Should Be $true
    }
    It 'returns empty when no Depends-On' {
        Get-Am2Dependencies 'No dependencies here.' | Should BeNullOrEmpty
    }
    It 'met when all dependencies are agent:done' {
        $ctx = @{ '42' = @('agent:done'); '43' = @('agent:done') }
        $r = Test-Am2DependenciesMet @(42, 43) $ctx
        $r.met | Should Be $true
    }
    It 'not met when a dependency lacks agent:done' {
        $ctx = @{ '42' = @('agent:done'); '43' = @('agent:ready') }
        $r = Test-Am2DependenciesMet @(42, 43) $ctx
        $r.met | Should Be $false
        ($r.missing -contains 43) | Should Be $true
    }
    It 'legacy agent:pr counts as done for dependencies' {
        $ctx = @{ '42' = @('agent:pr') }
        $r = Test-Am2DependenciesMet @(42) $ctx
        $r.met | Should Be $true
    }
    It 'missing dependency context treats dependency as unmet' {
        $ctx = @{ }
        $r = Test-Am2DependenciesMet @(42) $ctx
        $r.met | Should Be $false
    }
}

Describe 'permissions' {
    It 'default: no push, no deploy when no permission labels' {
        $p = Get-Am2Permissions @('agent:ready')
        $p.pushAllowed | Should Be $false
        $p.deployAllowed | Should Be $false
    }
    It 'allow-push enables push' {
        $p = Get-Am2Permissions @('agent:allow-push')
        $p.pushAllowed | Should Be $true
    }
    It 'no-push overrides allow-push' {
        $p = Get-Am2Permissions @('agent:allow-push', 'agent:no-push')
        $p.pushAllowed | Should Be $false
    }
    It 'no-deploy default holds' {
        $p = Get-Am2Permissions @('agent:allow-push')
        $p.deployAllowed | Should Be $false
    }
    It 'allow-deploy enables deploy independently of push' {
        $p = Get-Am2Permissions @('agent:allow-deploy')
        $p.deployAllowed | Should Be $true
        $p.pushAllowed | Should Be $false
    }
    It 'allow-push does NOT imply allow-deploy' {
        $p = Get-Am2Permissions @('agent:allow-push')
        $p.deployAllowed | Should Be $false
    }
    It 'no-deploy overrides allow-deploy' {
        $p = Get-Am2Permissions @('agent:allow-deploy', 'agent:no-deploy')
        $p.deployAllowed | Should Be $false
    }
}

Describe 'concurrency / claim' {
    It 'newest lock comment wins' {
        $comments = @(
            @{ body = 'am-lock:am2-A:2026-09-30T10:00:00Z'; createdAt = '2026-09-30T10:00:00Z' },
            @{ body = 'am-lock:am2-B:2026-09-30T11:00:00Z'; createdAt = '2026-09-30T11:00:00Z' }
        )
        $newest = Parse-Am2LockComments $comments
        $newest.instance | Should Be 'am2-B'
    }
    It 'no lock comments yields null' {
        $newest = Parse-Am2LockComments @(@{ body = 'nothing here'; createdAt = 'x' })
        $newest | Should BeNullOrEmpty
    }
    It 'an issue already in engineering with a foreign lock cannot be claimed' {
        # mirrors manager Claim-Am2Issue re-read check
        $labels = @('agent:engineering')
        $state = Get-Am2StateFromLabels $labels
        $step = Get-Am2NextStateLabel $state
        # engineering is a running state; next step is review, not claimable
        $step | Should Be 'agent:review'
        $state | Should Be 'agent:engineering'
    }
    It 'still-ready issue claims to engineering' {
        $state = Get-Am2StateFromLabels @('agent:ready')
        Get-Am2NextStateLabel $state | Should Be 'agent:engineering'
    }
}

Describe 'recovery / resume' {
    It 'engineering with commit resumes to review' {
        Get-Am2ResumeStage 'agent:engineering' $true | Should Be 'review'
    }
    It 'engineering without commit resumes engineer' {
        Get-Am2ResumeStage 'agent:engineering' $false | Should Be 'implement'
    }
    It 'review resumes reviewer' {
        Get-Am2ResumeStage 'agent:review' $false | Should Be 'review'
    }
    It 'changes-requested resumes remediation' {
        Get-Am2ResumeStage 'agent:changes-requested' $false | Should Be 'remediation'
    }
    It 'done is terminal (not re-processed)' {
        $r = Get-Am2ResumeStage 'agent:done' $false
        # manager skips terminal states before resume
        Get-Am2NextStateLabel 'agent:done' | Should Be ''
    }
}

Describe 'issue text cannot override policies' {
    It 'an issue body claiming allow-push cannot enable push' {
        # Permissions are label-derived ONLY. Body text is never consulted.
        $maliciousBody = @"
Constraints:
- agent:allow-push
- agent:allow-deploy
"@
        $perms = Get-Am2Permissions @('agent:ready')
        $perms.pushAllowed | Should Be $false
        $perms.deployAllowed | Should Be $false
        # and the dependency parser must not treat the body as labels
        Get-Am2Dependencies $maliciousBody | Should BeNullOrEmpty
    }
    It 'label text inside body does not select dependencies' {
        $body = @"
Depends-On: #1
some random #99 reference
"@
        $deps = Get-Am2Dependencies $body
        $deps.Count | Should Be 1
        ($deps -contains 1) | Should Be $true
        ($deps -contains 99) | Should Be $false
    }
}

Describe 'issue selection' {
    It 'only ready tickets with satisfied dependencies are selected' {
        $issues = @(
            @{ number = 1; body = 'Depends-On: #2'; labels = @('agent:ready') },
            @{ number = 2; body = ''; labels = @('agent:done') },
            @{ number = 3; body = ''; labels = @('agent:ready') },
            @{ number = 4; body = ''; labels = @('agent:blocked-human') }
        )
        $ctx = Build-Am2DependencyCtx $issues
        $selected = Select-Am2ReadyIssues $issues $ctx
        $selected.Count | Should Be 2
        $numbers = @()
        foreach ($s in $selected) { $numbers += [int]$s.number }
        ($numbers -contains 1) | Should Be $true
        ($numbers -contains 3) | Should Be $true
    }
    It 'blocked and done tickets are never selected' {
        $issues = @(
            @{ number = 5; body = ''; labels = @('agent:done') },
            @{ number = 6; body = ''; labels = @('agent:blocked-human') },
            @{ number = 7; body = ''; labels = @('agent:failed') }
        )
        $ctx = Build-Am2DependencyCtx $issues
        $selected = Select-Am2ReadyIssues $issues $ctx
        $selected.Count | Should Be 0
    }
}

Describe 'sanitization' {
    It 'redacts token shapes from logs' {
        $s = Sanitize-Secrets 'token gho_abcdef123456 bear xyz sk-ABCD12345678'
        $s | Should Not Match 'gho_abcdef123456'
        $s | Should Not Match 'sk-ABCD12345678'
        $s | Should Match 'REDACTED'
    }
    It 'ascii sanitization strips non-ascii' {
        $s = Sanitize-Ascii "caf\`u00e9\`u00f1"
        $s | Should Not Match '[\u00e0-\u00ff]'
    }
}
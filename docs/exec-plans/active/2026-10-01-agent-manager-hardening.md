# Issue #12 - Harden Agent Manager V2

## Scope and constraints

Fix runtime script scope, active/explicit base selection with pinned SHA, durable human-decision prompt context, and duplicate answered-blocker suppression. Only manager scripts, tests and related docs are affected; no application/API/Firestore contracts change. Work only in issue-12, no push/deploy/GitHub mutations, one local commit.

## Plan

1. Inspect manager/library, existing Pester tests and operational docs (done).
2. Use script-scoped initialization; validate base before work; create worktrees from resolved SHA and log branch/SHA.
3. Read all issue comments, collect structured decisions after blockers in chronological order, include context in engineer/remediation/reviewer prompts, suppress repeated answered blockers as worker failures.
4. Add Pester runtime/integration regressions plus local-only git smoke fixture inside this worktree.
5. Run suite, inspect diff, document results, archive plan, make one commit.

## Decisions

- No silent fallback on detached HEAD or unresolved requested local branch.
- Existing issue worktrees are reused, not reset; current selected baseline is logged separately from existing HEAD.
- Human comments use AM2-HUMAN-DECISION; blocker fingerprints and optional explicit references allow deterministic duplicate detection without guessing semantic equivalence.
- Duplicate answered blocker -> agent:failed, preserving GitHub decision history and prompt context; no new human request.
- Baseline: Windows PowerShell/Pester 3.4, 58 tests passing.

## Validation / outcome

Pending implementation and validation. Live GitHub/worker smoke: Unknown / Not yet verified (not authorized; use local-only smoke).

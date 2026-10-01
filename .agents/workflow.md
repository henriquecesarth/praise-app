# Agent Manager V2 — Workflow

## Roles

| Role | Worker | Mode |
| --- | --- | --- |
| Feature Engineer | Antigravity-style worker (verified: `opencode run --auto`) | Implements, tests, commits locally |
| Feature Reviewer | Codex (`codex exec --approve-for-me`) | Read-only review, verdict |

## Prompt Building

The Agent Manager builds worker prompts automatically from:

1. permanent role instructions (`.agents/feature-engineer.md` / `.agents/feature-reviewer.md`);
2. safety policies (`.agents/policies.md`);
3. Issue title/body;
4. current stage (implement / remediate / review);
5. relevant git diff/commit information;
6. previous reviewer remediation items when applicable.

## State Machine

```
agent:ready
  → agent:engineering     (engineer implements + commits)
  → agent:review          (reviewer runs)
      ├─ PASS              → agent:done
      ├─ REMEDIATION_REQUIRED → agent:changes-requested → agent:engineering (remediation) → agent:review
      └─ BLOCKED           → agent:blocked-human
Human decision required  → agent:blocked-human
Fatal worker/system error → agent:failed
```

Loop safety: default `MAX_REVIEW_CYCLES = 3`; after the limit the ticket goes to `agent:blocked-human` with a concise comment (cycles, unresolved items, branch/worktree, latest commit).

## Labels

State labels:

- `agent:ready` — queued, dependencies satisfied, waiting for claim.
- `agent:engineering` — engineer working/claimed.
- `agent:review` — reviewer reviewing.
- `agent:changes-requested` — remediation needed, engineer re-engaged.
- `agent:blocked-human` — human decision required.
- `agent:done` — completed.
- `agent:failed` — fatal worker/system failure.

Permission labels: `agent:no-push`, `agent:no-deploy`, `agent:allow-push`, `agent:allow-deploy`.

Legacy labels (read-mapped only; manager never writes them): `agent:running` → engineering, `agent:pr` → done, `agent:blocked` → blocked-human.

## Dependencies

In the Issue body:

    Depends-On: #42, #43

Before claiming an `agent:ready` issue, every dependency must carry `agent:done` (or legacy `agent:pr`). Otherwise the ticket stays queued without failure.

## Concurrency / Claim

- Claim = label transition to `agent:engineering` + lock comment (`am-lock:<instance>:<ts>`).
- Two managers cannot execute the same Issue simultaneously: on claim, the manager re-reads labels/comments; if another lock comment from another instance is newer, the claim is abandoned and labels are restored.
- Worktree `worktrees/issue-<N>/`, branch `agent/issue-<N>`. Existing valid worktrees are reused.

## Comments (concise)

- Claim: `AGENT MANAGER — engineering started.`
- Engineering complete: `ENGINEERING COMPLETE\nCommit: <sha>\nTests: <PASS|FAIL|NOT_RUN>`
- Review: `REVIEW STARTED`
- Remediation: `REMEDIATION REQUESTED` + short items
- Done: `AGENT DONE\nFinal commit: <sha>\nReview cycles: <n>\nTests: PASS`

## Recovery

Labels + git/worktree state are authoritative after restart:

- `agent:engineering` with commit → advance to review.
- `agent:review` → resume reviewer.
- `agent:changes-requested` → resume remediation.
- `agent:done` / `agent:failed` / `agent:blocked-human` → no redo.
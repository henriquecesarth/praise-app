# Agent Manager V2 — Autonomous Engineer/Reviewer Ticket Pipeline

Agent Manager V2 (`agent-manager.ps1`) is a Windows PowerShell pipeline that turns GitHub Issues into autonomous implementation + review cycles without copying prompts between agents:

```
GitHub Issue
→ feature-engineer worker (Antigravity-style: verified `opencode run --auto`)
→ feature-reviewer worker (Codex: verified `codex exec --approve-for-me`)
→ remediation loop when required
→ done
```

## Quick Start

Prerequisites (all verified locally):

- Git for Windows
- GitHub CLI (`gh`) authenticated with `repo` scope
- `opencode` CLI (v2.x) authenticated (engineer worker)
- `codex` CLI (v0.159+) logged in (reviewer worker)

Run a single pass:

```powershell
.\agent-manager.ps1
```

Process exactly one issue then stop:

```powershell
.\agent-manager.ps1 -Once
```

Plan only (no GitHub mutations, no worker runs):

```powershell
.\agent-manager.ps1 -DryRun
```

Unlimited polling loop:

```powershell
.\agent-manager.ps1 -PollInterval 60
```

Target a specific issue:

```powershell
.\agent-manager.ps1 -Target 42
```

Safety net for interrupts / restarts: labels + git worktrees are the source of truth; re-run the manager to resume (`-Once` is recommended).

## How the Pipeline Works

1. The manager lists open issues carrying any `agent:` label.
2. Only `agent:ready` issues whose `Depends-On:` dependencies are all `agent:done` are selected.
3. The manager **claims** the issue: label → `agent:engineering` + a lock comment (`am-lock:<instance>:<iso>`). A second concurrent manager detects the foreign lock and skips the issue.
4. A git **worktree** `worktrees/issue-<N>/` is created on branch `agent/issue-<N>`.
5. The **engineer worker** implements the ticket (reads `.agents/feature-engineer.md`, `.agents/policies.md`, `.agents/workflow.md` + the issue) and commits locally.
6. The **reviewer worker** (Codex) reviews the diff against the base branch.
7. On `PASS` → `agent:done`. On `REMEDIATION_REQUIRED` → `agent:changes-requested` → engineer re-engages in the same worktree → review again. On `BLOCKED` → `agent:blocked-human`.
8. If the reviewer keeps requesting remediation beyond `MAX_REVIEW_CYCLES` (default 3), the issue goes to `agent:blocked-human`.

No prompt is copied manually: the manager composes every worker prompt from permanent instructions + issue + stage + git diff + previous remediation items.

## Labels

### State labels

| Label | Meaning |
| --- | --- |
| `agent:ready` | Queued; dependencies satisfied; waiting for a manager. |
| `agent:engineering` | Engineer claim/entry. |
| `agent:review` | Reviewer is running. |
| `agent:changes-requested` | Reviewer asked for fixes; engineer remediation pending. |
| `agent:blocked-human` | Human decision required (product, credentials, legal, production permission, destructive behavior). |
| `agent:done` | Engineer PASS + reviewer PASS. |
| `agent:failed` | Fatal worker/system failure; inspect `.logs/`. |

### Permission labels

| Label | Meaning |
| --- | --- |
| `agent:no-push` | Explicit no-push (highest priority). |
| `agent:no-deploy` | Explicit no-deploy (highest priority). |
| `agent:allow-push` | Push permitted for this issue. |
| `agent:allow-deploy` | Deploy permitted for this issue (never inferred from push). |

**Default when permission labels are absent: NO PUSH, NO DEPLOY.**

Resolution order: `no-push`/`no-deploy` > `allow-push`/`allow-deploy` > absent → blocked.

## State Machine

```
agent:ready
  → agent:engineering
  → agent:review
      ├─ PASS                → agent:done
      ├─ REMEDIATION_REQUIRED (cycle < MAX_REVIEW_CYCLES)
      │                      → agent:changes-requested → agent:engineering (remediation) → agent:review
      ├─ REMEDIATION_REQUIRED (cycle ≥ MAX_REVIEW_CYCLES) → agent:blocked-human
      └─ BLOCKED             → agent:blocked-human
Human decision required     → agent:blocked-human
Fatal worker/system error   → agent:failed
```

## Always-Accept Behavior (verified)

The manager does NOT guess CLI flags. The supported non-interactive modes were verified against the installed tools before coding:

- **Engineer worker (opencode, feature-engineer role):** `opencode run --auto --format json --file <prompt> <worktree>`. `--auto` auto-approves permissions that are not explicitly denied (write files, run project commands, install project-local deps, run tests/builds, create local commits).
- **Reviewer worker (codex, feature-reviewer role):** `codex exec --approve-for-me -C <worktree> -o <last-message> - < prompt`. `--approve-for-me` routes approval requests through automatic review using the `workspace-write` sandbox.

Even in always-accept mode the workers NEVER push, deploy, modify production, read/print secrets unnecessarily, modify files outside the repo/worktree, delete arbitrary external files, or change GitHub/Vercel/Firebase production configuration without explicit ticket permission.

## Safety Boundaries

See `.agents/policies.md` and `.agents/workflow.md` for the canonical, permanent rules:

- No push / no deploy by default.
- Physical push guard: every issue worktree gets a `pre-push` git hook (via worktree-scoped `core.hooksPath`) that refuses `git push` unless `AM2_ALLOW_PUSH=1` is present — the manager only sets it when the ticket carries `agent:allow-push`.
- The manager itself never executes push/deploy.
- Workers operate only inside their issue worktree.
- Logs land in `.logs/issue-<N>/` (gitignored), never contain secrets, and never print token values.

## Engineer / Reviewer Roles

- **feature-engineer** (`.agents/feature-engineer.md`): implement the ticket; inspect repository/docs before changing code; preserve architecture/security/tenant isolation; run relevant tests; make ONE local commit; output a machine-readable result.
- **feature-reviewer** (`.agents/feature-reviewer.md`): independent read-only review; inspect ticket + diff + tests; identify regressions/security/design gaps; return a machine-readable verdict; NEVER modifies source.

## Machine-Readable Output

Engineer final block:

```
AGENT_RESULT: PASS | BLOCKED | FAIL
COMMIT: <sha> | NONE
TESTS: PASS | FAIL | NOT_RUN
HUMAN_DECISION_REQUIRED: YES | NO
```

When blocked: `BLOCKER:` + concise explanation.

Reviewer final block:

```
REVIEW_VERDICT: PASS | REMEDIATION_REQUIRED | BLOCKED
```

When remediation required: `REMEDIATION:` followed by `- item` lines.

Malformed/absent tokens fail safe → `agent:failed` (never `agent:done`).

## Dependencies

In the issue body:

```
Depends-On: #42, #43
```

Before claiming an `agent:ready` issue, every dependency must carry `agent:done` (legacy `agent:pr` counts as done). Otherwise the ticket stays queued without failure.

## Human-Blocked Workflow

If either agent returns `HUMAN_DECISION_REQUIRED`, `BLOCKER:` or `REVIEW_VERDICT: BLOCKED`:

1. The manager applies `agent:blocked-human`.
2. One concise GitHub comment is posted describing exactly what is needed.
3. Processing stops for that issue.
4. After the human resolves it and reapplies `agent:ready`, the pipeline continues (the worktree/branch state is reused).

The same happens when the remediation loop exhausts `MAX_REVIEW_CYCLES`.

## Concurrency / Claim Protection

- A claim = label transition to `agent:engineering` + a lock comment.
- After claiming, the manager re-reads the issue: if the state advanced away or a newer foreign lock comment exists, the claim is abandoned.
- Two manager processes cannot execute the same issue simultaneously.
- Worktrees/branches are reused across restarts.

## Logs

`.logs/issue-<N>/manager.log`, `engineer-<n>.log`, `reviewer-<n>.log`, `*-prompt.txt`, `*-stdout.log`, `*-stderr.log`.

Detailed transcripts stay local; GitHub comments stay concise.

## Recovery After Restart

Labels + git/worktree state are authoritative:

- `agent:engineering` with a completed commit → engineering is considered complete → advance to `agent:review`.
- `agent:engineering` without a commit → resume engineer.
- `agent:review` → resume reviewer.
- `agent:changes-requested` → resume remediation.
- `agent:done` / `agent:failed` / `agent:blocked-human` → never re-processed.

## Smoke Test Mode

```powershell
.\agent-manager.ps1 -SmokeTest
```

Creates a disposable `agent:ready` issue, runs the full loop (engineer → reviewer → terminal state), closes/deletes the issue and its worktree/branch afterward. Requires explicit user authorization before running; it mutates GitHub state of the configured repo.

## Example Minimal Ticket

Title:

```
PC2-PC3-R1 — Compliance fixes
```

Body:

```
Objective:
Correct factual compliance inconsistencies.

Scope:
- deletion disclosures
- privacy claims
- deletion polling

Acceptance:
- relevant tests green
- builds green

Constraints:
- no deploy
```

The manager supplies all permanent operating instructions automatically. Keep issue bodies short.

## Files

| Path | Purpose |
| --- | --- |
| `agent-manager.ps1` | Orchestrator: gh/git wrappers, worktrees, claim, workers, loop, recovery, dry-run, smoke test. |
| `agent-manager.lib.ps1` | Pure logic (state machine, parsing, permissions, dependencies) — unit-tested. |
| `tests/agent-manager.tests.ps1` | Pester unit/regression tests (`Invoke-Pester -Path tests\agent-manager.tests.ps1`). |
| `.agents/feature-engineer.md` | Permanent engineer instructions. |
| `.agents/feature-reviewer.md` | Permanent reviewer instructions. |
| `.agents/policies.md` | Permanent safety policies. |
| `.agents/workflow.md` | State machine + workflow reference. |
| `.logs/` | Per-issue structured logs (gitignored). |
| `.worktrees/` | Per-issue git worktrees (gitignored). |
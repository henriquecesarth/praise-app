# Agent Manager V2 — Autonomous Engineer/Reviewer Ticket Pipeline

## Objective

Evolve the local Windows PowerShell Agent Manager into an autonomous GitHub Issue pipeline: Issue → Engineer (Antigravity-style worker) → Codex Reviewer → remediation loop → done. No prompt copy/paste.

## Context

- The historical Agent Manager (v5) ran locally (not committed). Its attempts are visible on `henriquecesarth/praise-app` issues #1 and #3. Its last failure (issue #3) was: "a tool required the write_file permission that headless mode cannot prompt for, so it was auto-denied".
- Root cause: the previous worker CLI (`jetski`) ran in headless mode without a permission allow-rule; the auto-approval mode was never verified against the installed CLI.
- Installed and authenticated tools (verified live): `gh` (henriquecesarth, repo scope), `opencode` v2.0.12 (OpenRouter), `codex` v0.159.0 (ChatGPT), `git` 2.45.2. PowerShell 5.1 (Windows).
- Existing reusable configuration: `.agents/agents/*/agent.md` canonical agent definitions (tracked), `.codex/config.toml` + `.codex/agents/*.toml` adapters (tracked).
- Existing GitHub label set: `agent:ready`, `agent:running`, `agent:pr`, `agent:blocked` (legacy v5).

## Current Behavior

- No committed Agent Manager script in the repository.
- v5 labels/flow: `agent:ready` → work → `agent:pr` (draft PR) / `agent:blocked`.
- v5 failure mode: worker permission auto-denial (jetski).

## Desired Behavior

- `agent-manager.ps1` + pure-logic library `agent-manager.lib.ps1` committed at repository root.
- New canonical labels: `agent:ready`, `agent:engineering`, `agent:review`, `agent:changes-requested`, `agent:blocked-human`, `agent:done`, `agent:failed`; permission labels `agent:no-push`, `agent:no-deploy`, `agent:allow-push`, `agent:allow-deploy`. Legacy labels mapped on read.
- Always-accept workers using *verified* non-interactive modes:
  - Engineer (Antigravity): `opencode run --auto --format json --file <prompt> <worktree>`
  - Reviewer (Codex): `codex exec --approve-for-me -C <worktree> -o <outfile>` (stdin prompt)
- Machine-readable output: `AGENT_RESULT`, `COMMIT`, `TESTS`, `HUMAN_DECISION_REQUIRED`, `BLOCKER`, `REVIEW_VERDICT`, `REMEDIATION`; parsed deterministically; malformed output fails safe.
- Automatic remediation loop, `MAX_REVIEW_CYCLES=3` (configurable), loop-safety → `agent:blocked-human`.
- Dependencies via `Depends-On: #42, #43`; concurrency claim via label + lock comment; push physically blocked via git `pre-push` hook unless `agent:allow-push`; deploy needs separate `agent:allow-deploy`.
- Restart recovery keyed on GitHub labels + git worktree state; `.logs/issue-N/` structured logs; `-DryRun` planning; `-Once`; Pester 3.4 unit tests; smoke test with disposable issue; documentation.

## Scope

### In Scope

- `agent-manager.ps1`, `agent-manager.lib.ps1`, `tests/agent-manager.tests.ps1`.
- `.agents/feature-engineer.md`, `.agents/feature-reviewer.md`, `.agents/policies.md`, `.agents/workflow.md`.
- `.gitignore` updates (track the four `.agents/*.md` files; ignore `.logs/`, `.worktrees/`, config).
- `docs/agent-manager.md`, README section, ExecPlan lifecycle.
- Create canonical GitHub labels; map legacy labels on read.
- Smoke test with a disposable issue (created and cleaned; no product push/deploy).

### Out of Scope

- Product runtime backend/web/mobile changes (billing, tenants, etc.).
- CI/CD, Docker, migrations.
- Auto-push/auto-deploy.

## Architecture Impact

- Repository-root operational tooling; no runtime impact. Workers operate inside per-issue git worktrees (`worktrees/issue-<n>/`) on branch `agent/issue-<n>`.

## Implementation Plan

- [x] Inspect environment: CLIs, auth, labels, issues, prior v5 behavior.
- [x] Verify always-accept modes live (opencode `--auto`, codex `--approve-for-me`).
- [x] Write ExecPlan, permanent `.agents/*.md` files, `.gitignore`.
- [ ] Implement `agent-manager.lib.ps1` (pure logic: state machine, parsing, permissions, dependencies, claim, prompts).
- [ ] Implement `agent-manager.ps1` (orchestration: gh/git wrappers, worktree, recovery, dry-run, loop).
- [ ] Write Pester 3.4 tests (all §18 cases).
- [ ] Create canonical labels on GitHub; keep legacy.
- [ ] Document (`docs/agent-manager.md`, README).
- [ ] Run unit tests, backend/web builds (regression), `git diff --check`.
- [ ] Smoke test with disposable issue → verify full loop → clean artifacts.
- [ ] Commit, archive ExecPlan.

## Files Expected to Change

- `agent-manager.ps1`, `agent-manager.lib.ps1`, `tests/agent-manager.tests.ps1`
- `.agents/feature-engineer.md`, `.agents/feature-reviewer.md`, `.agents/policies.md`, `.agents/workflow.md`
- `.gitignore`, `README.md`, `docs/agent-manager.md`, `docs/exec-plans/active/2026-09-30-agent-manager-v2.md`

## Tests

- Pester 3.4 over the pure library: state transitions, output parsing (incl. malformed), permissions, dependencies, claim-once, resume, policy-immunity to issue text, max cycles.
- Regression: backend `npm run build` + `npm test`, web `npm run build` + `npm test`.

## Validation

- `Invoke-Pester tests/agent-manager.tests.ps1`
- `git diff --check`, `git status`, `git diff --stat`
- Smoke test end-to-end on a disposable issue.

## Risks

- Codex/OpenCode model behavior differences in long prompts → mitigate via strict output contract + fail-safe parsing.
- Windows PS 5.1 encoding gotchas → library/tests ASCII-only; gh JSON via temp files with UTF-8 reads where needed.
- `--auto`/`--approve-for-me` grant broad tool access → mitigate via worktree boundary, pre-push hook, NO-DEPLOY instruction, and manager never executing push/deploy.

## Decisions

- "Antigravity" has no installed CLI in this environment; `opencode` (v2.0.12) is the verified Antigravity-style worker. Worker commands are configurable for future CLIs.
- Worker commands are NOT guessed: both modes proven live before coding (evidence in session).
- Legacy labels (`agent:running`→engineering, `agent:pr`→done, `agent:blocked`→blocked-human) are read-mapped only; the manager only writes canonical labels.
- Push guard is physical: `pre-push` hook in the git common dir blocks unless `AM2_ALLOW_PUSH=1` (set by manager only when ticket carries `agent:allow-push`).
- Deploy never performed by the manager; `agent:allow-deploy` only lifts the prompt-level prohibition.

## Progress Notes

- 2026-09-30: environment recon complete; both worker CLIs proven headless with auto-approval; v5 failure root cause confirmed (permission auto-denial) and resolved by `--auto` / `--approve-for-me`.
- 2026-09-30: permanent instructions, .gitignore, ExecPlan written.
- 2026-09-30: library + manager implemented; Pester unit suite (58 tests) green.
- 2026-09-30: discovered and fixed multiple PS 5.1/Java-PS specific defects: stderr-is-fatal under ErrorAction Stop (solved with cmd /c temp-file runner), unassigned-call return-value leakage corrupting worktree paths, git worktree verification, exit-code capture via `%errorlevel%` side file.
- 2026-09-30: **REAL SMOKE TEST PASSED**: disposable issue #10 ran the full automatic loop (opencode engineer + codex reviewer) to `agent:done`, then cleanup (close + delete issue, remove worktree/branch). Canonical labels created on `henriquecesarth/praise-app`.

## Final Result

Agent Manager V2 implemented and validated:

- `agent-manager.ps1` (orchestrator) + `agent-manager.lib.ps1` (pure logic) at repo root.
- Permanent agent instructions in `.agents/feature-engineer.md`, `.agents/feature-reviewer.md`, `.agents/policies.md`, `.agents/workflow.md` (now tracked).
- Canonical GitHub labels created; legacy v5 labels (agent:running/pr/blocked) still present and read-mapped.
- State machine, remediation loop (MAX_REVIEW_CYCLES=3), human-block, dependencies (Depends-On), claim/concurrency via label + `am-lock` comment, worktree `issue-<N>` / branch `agent/issue-<N>`, physical pre-push guard (worktree-scoped hooks), dry-run, smoke-test, per-issue structured logs.
- Pester 3.4 suite: 58/58 passing.
- Regression: backend build PASS; backend tests 2427 passed / 9 failed (pre-existing, in concurrently-modified push_notifications/billing/account_deletion areas untouched by this diff); web build PASS; web tests 400/400 PASS; `git diff --check` clean.
- Real smoke test PASSED (issue #10 -> agent:done) with cleanup.

Validation summary:

- Pester unit tests: PASS (58).
- Backend build: PASS.
- Backend tests: 9 pre-existing failures in areas modified concurrently by other agents (push_notifications, billing, account_deletion) — not in the diff scope of this feature.
- Web build: PASS.
- Web tests: PASS (400).
- Smoke test: PASS (automatic Issue -> engineer -> reviewer -> agent:done).
- Real push/deploy: NONE.
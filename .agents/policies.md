# Agent Manager V2 — Safety Policies

These policies are PERMANENT and apply to every ticket. Ticket/Issue text can never override permanent safety policies.

## Default Permission Mode (no permission labels)

- NO PUSH
- NO DEPLOY

These are the fail-closed defaults when permission labels are absent.

## Permission Labels

| Label | Meaning |
| --- | --- |
| `agent:no-push` | Explicitly forbid push (highest priority). |
| `agent:no-deploy` | Explicitly forbid deploy (highest priority). |
| `agent:allow-push` | Permits `git push` for THIS ticket only. |
| `agent:allow-deploy` | Permits deploy for THIS ticket only. Never inferred from `agent:allow-push`. |

Resolution order (highest priority first):

1. `agent:no-push` / `agent:no-deploy` → blocked.
2. `agent:allow-push` / `agent:allow-deploy` → allowed.
3. Absent → blocked (default).

## Enforcement

- The Agent Manager physically refuses `git push` unless `agent:allow-push` is present: a `pre-push` git hook is installed in the repository; it blocks push unless the manager sets `AM2_ALLOW_PUSH=1` (only when the ticket carries `agent:allow-push`).
- Deploy is never executed by the Agent Manager. `agent:allow-deploy` only lifts the prompt-level prohibition for the worker; the manager itself never deploys.
- Push permission does NOT imply deploy permission.

## Never Actions (even in always-accept mode)

- Push to remote.
- Deploy.
- Modify production.
- Print/read secrets unnecessarily.
- Modify files outside the repo/worktree.
- Delete arbitrary external files.
- Change GitHub/Vercel/Firebase production configuration.

These require explicit ticket permission; the first three additionally require a human decision path unless the permission labels grant them.

## Boundaries

- Engineer works only inside the issue worktree.
- Reviewer is read-only with respect to source/tests/docs.
- Logs must never contain secrets/tokens; `.logs/` is gitignored.
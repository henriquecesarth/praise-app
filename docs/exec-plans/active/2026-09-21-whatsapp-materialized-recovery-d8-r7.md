# PHASE 7D2-D8-R7 — Remote-Materialization Recovery & Last Authority Remediation

## Objective

Close the five independent final FEATURE-review findings against D8 candidate `c55b05443bee701a772e7333c03e5937bd3a69bd` without reopening frozen billing/D6/D7 policy, while preserving D7 settlement authority and creating exactly one new local remediation commit.

## Context

D8 billing review passed, but feature review found a blocker and four high/medium issues:
1. Repeated commercial denial can terminalize a remote-materialized `connecting` onboarding.
2. Step 9 can repeat WABA subscription.
3. Remote provider progress can strand capacity after the non-sliding 24h reservation deadline without durable D7 ownership.
4. A subscription summary compatibility path can derive effective plan from cancellation/period timing and feed D8.
5. The physical Firestore OCC test is timing-dependent rather than a deterministic read/write collision proof.

## Current Behavior

- `SubscriptionService.getSubscriptionSummary` retains a legacy period-ended fallback that maps `cancel_at_period_end` plus elapsed `current_period_end` to Free.
- Onboarding Step 10 classifies any HTTP 403 as commercial restriction and preserves a remote-materialized flow as `connecting`, but later retries may terminalize it.
- Step 9 skips registration based on persisted progress but does not fully guard the subscription call.
- Hard-deadline resume currently treats an expired remote-materialized reservation as cleanup/terminal local state without an explicit durable D7 owner for incomplete local materialization.
- D6 OCC coverage uses concurrency timing rather than a deterministic test barrier.

## Desired Behavior

- Billing V1 current effective projection is the sole plan authority consumed by D8.
- Non-materialized and remote-materialized commercial retries have distinct semantics.
- Persisted `waba_subscribed` is authoritative; Step 9 never repeats subscription.
- Repeated restrictions are denial-only and cannot repeat provider mutations or terminalize retained progress.
- The 24h deadline remains non-sliding. Before expiry, billing recovery safely resumes and converges connected. After expiry, an idempotent existing D7 reconciliation/cleanup owner controls remote settlement; only strong D7 settlement releases claims/secret/final lifecycle and capacity.
- Physical Firestore OCC collision is deterministic and proves the required read-before-write abort/retry behavior.

## Scope

### In Scope

- Canonical compatibility/summary authority consumed by D8.
- WhatsApp onboarding classification, Step 9 idempotency, repeated restriction recovery, and hard-deadline D7 ownership.
- Existing `whatsapp_waba_reconciliation_jobs` / `whatsapp_provider_cleanup_jobs` machinery.
- Deterministic Firestore Emulator OCC regression for D6.
- Required targeted/full regressions, builds, documentation, and one selective local commit.

### Out of Scope

- Premium-only policy, strict civil grace validation, real-anchor requirement, missing subscription `integrity_failure`, Billing V1 transition authority, canonical public D8 DTO, `CAPACITY_ACCOUNTING_SATURATED`, D6 commercial admission, generic provider-403 separation policy, PR-0/PR-1/PR-2, D7 settlement invariants, D6 at-most-once invariants, TTL durations, automation-only WhatsApp product decision.
- Frozen billing/subscription code except read/audit and the narrowly required compatibility authority removal.
- Production Firestore, indexes, Asaas, Meta, Zernio, WhatsApp, Vercel, cron, paid resources, push, or deployment.

## Architecture Impact

- Commercial plan authority remains in `evaluateWhatsAppCommercialEntitlement` and Billing V1 current effective projection.
- Onboarding remains route/controller → service → repositories → Firestore, with provider calls outside transactions.
- D8 may ensure an existing D7 durable owner but may not duplicate D7 provider settlement or cleanup authority.
- D6 dispatch retains its repository transaction linearization contract.

## Implementation Plan

- [x] Read repository operating manual, memory, system status, relevant WhatsApp architecture, ExecPlan convention, git topology, and current candidate diff.
- [x] Repository-wide authority and D7 machinery search.
- [ ] Add failing regressions for compatibility authority, repeated remote-materialized restriction/idempotency/recovery, hard-deadline D7 ownership/settlement, and deterministic OCC/inverse race.
- [ ] Remove summary clock-derived effective-plan authority and route D8 through Billing V1 current effective projection.
- [ ] Implement durable retry classification and Step 9 progress idempotency.
- [ ] Integrate remote-materialized hard-deadline handoff with the smallest existing D7 owner without duplicating settlement.
- [ ] Replace timing-dependent OCC test with a deterministic Firestore Emulator barrier.
- [ ] Run targeted gates A-N and required serialized/full suites P-R.
- [ ] Update documentation and ExecPlan, audit static authority hits, review diff, and create exactly one selective local commit.

## Files Expected to Change

- `backend/src/features/subscriptions/subscription.service.ts`
- `backend/src/features/subscriptions/subscription.service.test.ts`
- `backend/src/features/subscriptions/whatsapp-commercial-evaluator*.test.ts`
- `backend/src/features/whatsapp/whatsapp-connection.service.ts`
- `backend/src/features/whatsapp/whatsapp.onboarding.test.ts`
- `backend/src/features/whatsapp/whatsapp-reconciliation.service.ts` and/or its tests if required for ownership handoff
- `backend/src/features/whatsapp/whatsapp-commercial-entitlement.integration.test.ts`
- D6 outbound/OCC test file determined by inspection
- `docs/system-status.md`
- `docs/product/system-overview.md`
- This ExecPlan

## Tests

- Exact compatibility/summary clock-authority regression.
- Repeated denial after `waba_subscribed` preserves lifecycle.
- Second/third restricted retry mutation counts remain exactly one.
- Billing recovery before TTL converges connected with counts unchanged.
- TTL expiry after materialization creates/reuses one durable D7 owner.
- D7 strong settlement releases capacity without losing evidence.
- No capacity deadlock and generic provider 403 remains provider error.
- Payment-grace prior admission resumable; restricted-before-provider calls zero.
- Deterministic real Firestore OCC collision and inverse D6 race.
- Scheduled transition, PR-0, full serialized WhatsApp, serialized subscriptions/billing regressions.

## Validation

- Targeted evaluator, D8 integration, SubscriptionService, capacity, onboarding, Meta, Zernio, D6, D7, OCC, scheduled transition, and PR-0 tests.
- Full serialized WhatsApp suite.
- Full serialized subscriptions/billing suite.
- Backend build.
- `npm --prefix backend test -- --fileParallelism=false --test-timeout=15000`.
- Current-HEAD web tests and build.
- `git diff --check`.

## Risks

- Firestore Emulator transaction retry behavior must be proven with a deterministic barrier; otherwise verdict is BLOCKED.
- Existing D7 machinery must be shown to safely own Meta materialized-but-not-locally-connected state; otherwise verdict is BLOCKED.
- No sliding/renewing 24h TTL is permitted.
- Existing unrelated `.gitignore` modification and `.opencode/` must remain untouched and unstaged.

## Decisions

- Pending; record only decisions made from code evidence.

## Progress Notes

- 2026-09-21: Startup complete. Current HEAD is `c55b054` on `main`, one commit ahead of `origin/main`; unrelated `.gitignore` and `.opencode/` changes pre-exist and will not be touched.
- 2026-09-21: Subagent exploration unavailable because configured subagent depth is already exhausted; repository inspection continues directly.

## Final Result

Pending validation.

# Provider-Polymorphic Identity Claim Verification (7D2-PR2)

## Objective

Correct provider-neutral WhatsApp identity-claim verification so Meta uses its single phone-number-ID claim and Zernio requires its materialized account and canonical-phone claims.

## Context

D3 materializes a Zernio connection with `provider_phone_number_id: null`, `provider_account_id`, a canonical E.164 `phone_number`, and two deterministic claims. Existing connection resolution, configuration assignment, and outbound sender resolution derive a single claim from `provider_phone_number_id`, producing `claim_zernio_undefined`.

## Scope

### In Scope

- One fail-closed provider-polymorphic verification seam.
- Replacing neutral claim-verification call sites in connection resolution, connection configuration, and outbound sender resolution.
- Focused emulator-backed regression tests for claim ownership and real service paths.

### Out of Scope

- Claim materialization, release, cleanup, reconciliation, provider mutation, D6 dispatch semantics, and D8 commercial entitlement logic.

## Architecture Impact

The verifier reads existing claim records only. It verifies the connection and organization owner for every required claim and does not create, update, or release claims.

## Implementation Plan

- [x] Inspect repository state, D3/D6/D7 evidence, service call sites, and claim topology.
- [x] Add failing regression coverage for a D3-style Zernio connection.
- [x] Add canonical provider-polymorphic verifier and transaction-aware claim reads.
- [x] Route neutral verification call sites through the verifier.
- [x] Add focused ownership and service-path coverage.
- [x] Run targeted validation and review the final diff.

## Files Expected to Change

- `backend/src/features/whatsapp/whatsapp-provider-identity-verification.service.ts`
- `backend/src/features/whatsapp/whatsapp-connection.service.ts`
- `backend/src/features/whatsapp/whatsapp-outbound.service.ts`
- `backend/src/repositories/WhatsAppProviderIdentityClaimRepository.ts`
- Focused WhatsApp tests.

## Tests

- Meta single-claim acceptance/failure matrix.
- Zernio dual-claim acceptance/failure matrix and canonical phone handling.
- Resolver, assignment, and outbound sender integration paths.

## Validation

- Targeted PR-2, D3, D6, lifecycle, Meta, WhatsApp, and backend suites as available under the local emulator.
- Backend build and `git diff --check`.

## Risks

- Transactional configuration verification must preserve Firestore read-before-write ordering.
- Existing caller-specific public errors must remain stable.

## Progress Notes

- `docs/project/CURRENT_STATE.md`, D8-P0-BR1, D8-P1, and D7-R3 were not present in the checked-out worktree; current source, git history, and the D7 local commit were inspected instead.

## Final Result

Implementation, focused emulator coverage, and suite stabilization are complete. Cross-suite fixture collisions in `zernio-persistence` and `zernio-webhook` were eliminated using isolated dynamic generators. Both the full serialized WhatsApp suite (20/20 files, 477/477 tests) and the complete backend regression suite (67/67 files, 2121/2121 tests) passed with 100% green results against the Firestore emulator. TypeScript build and git diff checks succeeded cleanly.

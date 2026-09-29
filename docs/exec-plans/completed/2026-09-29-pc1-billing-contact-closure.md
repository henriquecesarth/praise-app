# PC1 Billing Contact Closure

## Objective

Make the canonical billing contact an explicit, durable part of the normal Asaas
billing lifecycle, and fail closed for an active legacy relationship whose contact
is unknown during account-deletion preflight.

## Scope

- Persist the initiating user as billing contact only while establishing a new
  billing relationship with no existing active relationship or contact.
- Provide an explicit admin-only contact-replacement flow that validates the
  selected ministry member and synchronizes the canonical Asaas customer before
  persisting the replacement locally.
- Preserve subscriptions and financial history; never transfer ownership.
- Update account-deletion preflight to block the current contact and active
  unknown-contact legacy relationships without email inference.
- Add focused backend tests and run the complete backend validation suite.

## Verification

1. Billing customer and ministry subscription store the initial contact UID.
2. Explicit replacement updates Asaas before local contact state.
3. Deletion preflight distinguishes current, different, absent, and unknown contacts.
4. `npm --prefix backend run build` and `npm --prefix backend test` pass.

## Result

- The initial paid checkout synchronizes the canonical Asaas customer before
  atomically storing the initiator UID in `billing_customers` and
  `ministry_subscriptions`.
- An explicit admin-only replacement requires a ministry member, synchronizes
  Asaas first, and does not change ownership or subscription records.
- Account-deletion preflight blocks an active current contact and an active
  legacy relationship with unknown contact metadata, including the legacy
  inverted billing-subscription document ID.
- Validation passed: backend TypeScript build; focused PC1 tests (101); billing
  initial-purchase tests (51); paid-to-paid preparation tests (43); billing
  concurrency tests (13); and the complete backend suite (77 files, 2,419
  tests) against the local Firestore emulator.

# PHASE 7D2-PR1 — Premium-only WhatsApp Plan Catalog Hardening

## Scope

Harden only the canonical backend plan catalog. The V1 WhatsApp allowance is
Free/Lite/Lite+/Essential/Pro = 0 and Premium = 1; additional connections stay
disabled. Unknown and malformed runtime plan IDs and invalid allowance metadata
must deny entitlement.

## Evidence and implementation plan

1. Preserve the observed PR-2 base commit `2c88c7e2400d13bbd34f5009dfbaaf80822fe3b9` and unrelated worktree entries.
2. Replace inherited-property plan lookup and the non-free allowance fallback with explicit own-property lookup and runtime validation.
3. Add catalog matrix, adversarial prototype-key, unknown-ID, and invalid-config regression tests.
4. Run targeted, billing, full backend/emulator, build, and diff validation before a selective local commit.

## Boundaries

No D6, D7, D8 commercial evaluator, provider, checkout, billing transition,
quota, price, lifecycle, Firestore-index, push, or deployment changes are in
scope.

## Result

- The catalog now grants one included WhatsApp connection only to `premium`.
- `isPlanId` is the canonical own-property predicate used by catalog lookup,
  subscription mutations, checkout validation, and transition validation.
- Unsupported, inherited, malformed, and invalid allowance runtime values
  resolve to no plan or zero allowance.
- Existing WhatsApp tests that require an eligible connection now use Premium
  fixtures; no D6/D7 behavior was changed.
- Validation passed: focused catalog/subscription/domain tests (165), affected
  WhatsApp regression tests (139), full billing suite (24 files/1092 tests),
  full backend suite with a clean Firestore Emulator and
  `--fileParallelism=false` (67 files/2145 tests), backend build, and
  `git diff --check`.

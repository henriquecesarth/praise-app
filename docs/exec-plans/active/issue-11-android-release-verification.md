# Issue #11 — Android release blocker verification

## Scope and constraints

Verify evaluated Android configuration and signed AAB metadata; audit REL-1 notification claims without changing working behavior. Work only in this worktree. No push, deploy, Play upload, credential disclosure, or automatic version bump.

## Progress

- [x] Inspect repository instructions, mobile release documentation, Gradle configuration, auth routes and notification references.
- [x] Evaluate Gradle metadata: compileSdk 36, targetSdk 36, minSdk 24, com.louvaio.app, 1.0.0+1. No SDK remediation necessary.
- [x] Run Flutter analyze (pass) and full tests (270 pass).
- [x] Attempt release AAB build: fails on absent release signing configuration.
- [x] Record evidence and correct release guide's automatic version-bump advice and SDK description.
- [ ] Owner securely provisions approved signing inputs inside the worktree.
- [ ] Rebuild signed AAB and verify artifact metadata, size, signature and approved signer.
- [ ] Owner provides REL-1 manifest/matching source revision and authoritative Play version history.

## Outcome and decisions

BLOCKED / REMEDIATION_REQUIRED; not complete. Details and owner handoff: `docs/mobile/rel-2-verification.md`. Existing signing loader and fail-closed guard are preserved. No replacement key generated, no secrets inspected, no application source changed. Requested read-all endpoint and notification inbox implementation are absent from this revision; do not invent their method/types/triggers. Keep this plan active until release evidence is available.

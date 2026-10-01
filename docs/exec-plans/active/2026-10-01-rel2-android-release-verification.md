# REL-2 — Android release blocker verification (#11)

Status: BLOCKED — signing provisioning and Play history evidence required.

## Scope and decisions

- Work only in the issue-11 worktree on `agent/issue-11`; no push, deployment or Play upload.
- Inspect actual Gradle values, attempt the signed AAB build, run Flutter analysis/tests, and audit the REL-1 notification claims against source.
- Preserve Android baselines and version unless evidence requires a change. Do not change notification behavior to match a report.
- No API contracts or Firestore collections are changed.

## Progress

- [x] Read repository instructions, memory, system status and mobile release documentation.
- [x] Resolve Gradle metadata: compileSdk 36, targetSdk 36, minSdk 24, applicationId com.louvaio.app, versionName 1.0.0, versionCode 1.
- [x] Attempt `flutter build appbundle --release`: failed at the existing release-signing guard because `mobile/android/key.properties` is absent.
- [x] Audit notification routes, clients, types, producers and recipients; record report-only corrections.
- [x] Run `flutter analyze`: no issues.
- [x] `flutter test --reporter compact`: 395 tests passed, exit 0; initial invocation hit the harness timeout.
- [ ] Provision approved release signing securely inside the worktree, without logging secrets.
- [ ] Rebuild signed AAB and verify artifact manifest, size, signature and approved upload certificate.
- [ ] Obtain authoritative Play version history, then decide whether a versionCode change is required.

## Evidence and handoff

See `docs/mobile/rel2-verification.md`. The original REL-1 manifest is not present in this checkout; the report contains an evidence-backed correction addendum, not a claim that an unavailable report was edited.

This plan remains active because a signed artifact has not been produced. Do not convert source/Gradle metadata evidence into artifact or Play acceptance claims.

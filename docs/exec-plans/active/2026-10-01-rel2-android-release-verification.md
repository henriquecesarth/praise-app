# REL-2 — Android release blocker verification (#11)

Status: BLOCKED — signed AAB rebuilt and metadata verified; Play history, approved upload certificate and production environment confirmation remain required.

Resumed on 2026-10-01 from `eca9ed4`: ignored signing configuration and keystore were already provisioned inside the worktree. Re-run all three requested Flutter commands, verify the actual AAB with bundletool/JDK tools, and replace the obsolete signing blocker with current artifact evidence. No application behavior or version changes are planned.

## Scope and decisions

- Work only in the issue-11 worktree on `agent/issue-11`; no push, deployment or Play upload.
- Inspect actual Gradle values, attempt the signed AAB build, run Flutter analysis/tests, and audit the REL-1 notification claims against source.
- Preserve Android baselines and version unless evidence requires a change. Do not change notification behavior to match a report.
- No API contracts or Firestore collections are changed.

## Progress

- [x] Read repository instructions, memory, system status and mobile release documentation.
- [x] Resolve Gradle metadata: compileSdk 36, targetSdk 36, minSdk 24, applicationId com.louvaio.app, versionName 1.0.0, versionCode 1.
- [x] Initial attempt failed for absent signing configuration; resumed `flutter build appbundle --release` passed with the provisioned signing files (429.5s). Existing signing guard preserved.
- [x] Audit notification routes, clients, types, producers and recipients; record report-only corrections.
- [x] Run `flutter analyze`: no issues.
- [x] Re-run `flutter test`: 395 tests passed, exit 0 (2m02s); `flutter analyze`: no issues.
- [x] Signing files present inside worktree on resumption, ignored by Git; no credential changes or secret disclosure.
- [x] Rebuild signed AAB; bundletool 1.18.3 validates structure and artifact metadata; record 57,404,137-byte size, SHA-256 and public certificate fingerprint.
- [x] `jarsigner -verify -verbose -certs`: jar verified, exit 0; document self-signed, timestamp, POSIX and streaming-reader warnings rather than suppress them.
- [ ] Compare artifact signer to approved Play upload certificate and review verification warnings with release owner.
- [ ] Obtain approved production environment parameters; build and reverify the production candidate (bare requested command uses development defaults).
- [ ] Obtain authoritative Play version history, then decide whether a versionCode change is required.

## Independent rerun from `ddd6f0e`

On 2026-10-01, re-ran analysis (no issues), all 395 Flutter tests (2m21s), and the signed release AAB build (63.2s Gradle task). Reverified resolved Gradle metadata, bundletool structure/manifest, signature and certificate fingerprint. Artifact size/hash are unchanged; signature warnings and human evidence gaps remain. No application, SDK baseline, signing or version changes were needed. This rerun only updates this plan and the verification report.

## Evidence and handoff

See `docs/mobile/rel2-verification.md`. The original REL-1 manifest is not present in this checkout; the report contains an evidence-backed correction addendum, not a claim that an unavailable report was edited.

This plan remains active because Play history, certificate approval and production build parameters require release-owner evidence. Signed metadata-verification artifact is now available and verified locally; do not convert those checks into production runtime or Play acceptance claims. Updated only this plan, `docs/mobile/rel2-verification.md` and the release-guide cross-reference; application source, SDK baselines, dependencies and version are unchanged.

# REL-2 — Android release blocker verification (#11)

Status: COMPLETE — production AAB rebuilt with the ticket-approved parameters; artifact metadata, structure, signature and approved signer fingerprint verified. Authoritative human decisions resolve the previous approval gaps.

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
- [x] Compare production artifact signer to the ticket-approved SHA-256 fingerprint: exact match. Owner acceptance of the recorded JDK warnings is authoritative.
- [x] Build with `APP_ENV=production` and `API_BASE_URL=https://praise-app-gray.vercel.app/api/v1`; repeat bundletool validation/manifest dump and JDK signature/certificate checks.
- [x] Apply authoritative owner history: no AAB uploaded, code 1 unconsumed; preserve `1.0.0+1`.

## Independent rerun from `ddd6f0e`

On 2026-10-01, re-ran analysis (no issues), all 395 Flutter tests (2m21s), and the signed release AAB build (63.2s Gradle task). Reverified resolved Gradle metadata, bundletool structure/manifest, signature and certificate fingerprint. Artifact size/hash are unchanged; signature warnings and human evidence gaps remain. No application, SDK baseline, signing or version changes were needed. This rerun only updates this plan and the verification report.

## Evidence and handoff

See `docs/mobile/rel2-verification.md`. The original REL-1 manifest is not present in this checkout; the report contains an evidence-backed correction addendum, not a claim that an unavailable report was edited.

## Final production verification from `9e01ee0`

The updated ticket supplied all authoritative approvals; no further human decision was requested. Re-ran `flutter analyze` (no issues, 14.6s), `flutter test` (395 passed, 6m31s), and `flutter build appbundle --release` with both approved production dart-defines (exit 0, 304.1s Gradle task). Re-resolved Gradle values: compileSdk/targetSdk 36, minSdk 24, package `com.louvaio.app`, version `1.0.0+1`.

Production AAB: `mobile/build/app/outputs/bundle/release/app-release.aab`, 57,403,920 bytes, SHA-256 `b79cf56cfad056f4b65cc28d59c3d687ab5b28cf9639554ebcdccaf5b40e9219`. Bundletool validation/manifest dump passed; jarsigner returned `jar verified` with accepted warnings; artifact signer exactly matches the approved fingerprint. Approved URL appears in all three compiled ABI libraries; an exploratory absence check for the development fallback URL failed because fallback constants also remain compiled (not proof of runtime selection). Physical production runtime and Play acceptance remain Unknown / Not yet verified and were not claimed.

Rechecked notification producers and PATCH read-all contract; preserved report-only correction addendum. Updated only this plan, `docs/mobile/rel2-verification.md` and `docs/mobile/release.md`. Application source, SDK baselines, dependencies, credentials and version are unchanged. Plan finalized and archived under `completed/`. No push, deployment, Play upload or production mutation.

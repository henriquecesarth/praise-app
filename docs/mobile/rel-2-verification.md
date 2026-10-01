# REL-2 Android release verification — issue #11

Date: 2026-10-01. Audited source baseline: `4edeb66` on `agent/issue-11`.

## Verdict: REMEDIATION_REQUIRED

The configuration meets the API 36 requirement, but a signed AAB could not be rebuilt. Release approval is blocked, not passed.

## Configuration evidence

`mobile/android/app/build.gradle.kts` delegates SDK and version values to Flutter. An evaluated Gradle Android extension (`gradlew.bat help` with a temporary metadata-only init script) returned:

| Field | Evaluated value |
| --- | --- |
| compileSdk | 36 |
| targetSdk | 36 |
| minSdk | 24 |
| applicationId | com.louvaio.app |
| versionName | 1.0.0 |
| versionCode | 1 |

Toolchain: Flutter 3.47.5, Dart 3.13.4, Gradle 9.3.1; configured AGP 9.1.0 and Kotlin 2.4.0. No SDK baseline was lowered; no Gradle, version, or application behavior change was necessary.

These are evaluated configuration values, **not artifact-derived metadata**.

## Build and artifact evidence

- `flutter analyze`: PASS, no issues.
- `flutter test --reporter compact`: PASS, 270 tests. The initial test invocation hit the harness's 120-second timeout; the complete rerun exited 0.
- `flutter build appbundle --release`: FAIL, exit 1. After an initial harness timeout, the complete rerun failed with: `Release build failed: Missing or incomplete release signing configuration in android/key.properties`.
- `mobile/android/key.properties` is absent. The existing release signing loader and fail-closed guard are intact. No credentials were read, printed, generated, or copied from outside the worktree.
- Expected AAB path: `mobile/build/app/outputs/bundle/release/app-release.aab`. No AAB exists under `mobile/` in this worktree.
- AAB size, signature validity, signer identity, and artifact package/minSdk/targetSdk/version: **Unknown / Not yet verified**. There is no artifact to inspect.
- Build warnings flag future built-in Kotlin migration; dependencies/toolchain were not changed incidentally.

## REL-1 manifest audit / correction record

The REL-1 manifest/report and the requested notification implementation are absent from this checkout. This record does not claim to correct an unavailable report in place.

- `backend/src/app.ts` mounts `authRoutes` at `/api/v1/auth`.
- `backend/src/features/auth/auth.routes.ts` exposes only `POST /signup`, `POST /login`, and authenticated `GET /me`.
- `/api/v1/auth/notifications/read-all` has **no supported HTTP method in this checkout**. Assigning POST, PATCH, or PUT would be an invented contract.
- Searching tracked backend source and mobile client source found no notification inbox types, read-all controller, notification creation triggers, or push registration. Supported inbox notification types/triggers: none implemented in the audited source. The Asaas customer `notificationDisabled: false` setting is provider configuration, not a mobile notification contract; Flutter `notifyListeners()` calls are state updates, not notification delivery.
- Claims about notification behavior in another revision or deployed environment are **Unknown / Not yet verified**. A release owner must supply the intended REL-1 report and matching source revision to finish that comparison. No working API or mobile behavior was changed to match an unavailable report.

## Version and Play history

`mobile/pubspec.yaml` remains `1.0.0+1`. Whether this version has ever been uploaded to any Play track is **Unknown / Not yet verified**; repository metadata cannot prove store history. No Play access or upload was attempted.

Before choosing a new code, the owner must inspect Play Console's artifact/version history across all tracks. Recommend the highest previously used versionCode plus one; recommend `2` only if the highest used code is confirmed to be `1`. A local rebuild alone does not require a version bump.

## Required owner handoff

1. Provision the existing approved upload key and ignored signing configuration securely inside this worktree, without putting credentials in issue comments or logs. Do not create a replacement signing identity to bypass the blocker.
2. Supply the REL-1 manifest and intended notification source revision, plus authoritative Play version history.
3. Rerun analyze, tests, and the release AAB build. For a production candidate, use the approved production Dart defines described in `release.md`; the bare requested build command does not establish production environment settings.
4. Inspect the resulting AAB using `bundletool dump manifest --bundle=<AAB> --module=base`; verify package, minSdk, targetSdk >= 36, versionName and versionCode. Verify JAR signing with `jarsigner -verify -verbose -certs <AAB>` and compare the signer to the approved upload certificate (signature presence alone is insufficient). Record size and SHA-256. APK `aapt`/`apksigner` checks are not AAB verification.

No push, deploy, Play upload, production modification, or backend/web runtime changes occurred.

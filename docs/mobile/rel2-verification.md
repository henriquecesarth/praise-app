# REL-2 — Android release verification / REL-1 correction addendum

Date: 2026-10-01. Ticket: #11. Source baseline: `8f95627`.

**Verdict: REMEDIATION_REQUIRED.** Signed AAB verification is blocked by missing release signing configuration in the issue worktree. This is not approval for production integration.

## Android metadata: configuration evidence, not artifact evidence

Inspected `mobile/android/app/build.gradle.kts`, `mobile/android/settings.gradle.kts`, `mobile/android/gradle/wrapper/gradle-wrapper.properties` and `mobile/pubspec.yaml`. SDK values are delegated to Flutter, not literal values in the app Gradle script.

An ephemeral, ignored Gradle init script in `mobile/build/rel2-metadata.gradle` registered `:app:rel2Metadata` after project evaluation and printed only the following allowlisted Android properties. Ran from `mobile/android`:

```powershell
.\gradlew.bat :app:rel2Metadata -I ..\build\rel2-metadata.gradle --quiet
```

| Property | Resolved Gradle value | Verified from resulting AAB? |
| --- | --- | --- |
| compileSdk | 36 | No artifact produced |
| targetSdk | 36 | No artifact produced |
| minSdk | 24 | No artifact produced |
| applicationId | `com.louvaio.app` | No artifact produced |
| versionName | `1.0.0` | No artifact produced |
| versionCode | `1` | No artifact produced |

Toolchain: `flutter --version` returned Flutter 3.47.5 stable / Dart 3.13.4; checked-in AGP 9.1.0, Gradle 9.3.1, Kotlin 2.4.0. Gradle emitted warnings about future incompatibility of the Kotlin Gradle Plugin; no dependency/toolchain migration was attempted.

The resolved target already meets API 36+. No SDK baseline, package, version or application behavior was changed. `compileSdk` is a build configuration property; an AAB manifest alone is not a substitute for resolving Gradle configuration.

## Build and artifact status

Ran the exact requested command from `mobile`:

```powershell
flutter build appbundle --release
```

Exit 1 at the existing fail-closed signing guard:

> Release build failed: Missing or incomplete release signing configuration in android/key.properties.

`mobile/android/key.properties` is absent. No credentials or private keystore contents were read, printed, created or substituted; debug signing was not used as a workaround.

- Expected output: `mobile/build/app/outputs/bundle/release/app-release.aab`.
- Actual output: no AAB found under `mobile/`; no tracked AAB exists.
- AAB size: not available (not produced).
- AAB signature, certificate identity and artifact metadata: **Unknown / Not yet verified**.
- Production endpoint/runtime validation: **Unknown / Not yet verified**. The exact bare build command does not select production: `AppEnvironment.fromDartDefines` defaults to development. The eventual production candidate needs `--dart-define=APP_ENV=production` and an explicitly approved HTTPS `API_BASE_URL`; do not infer endpoint health from documentation.

### Required release-owner follow-up

1. Securely provision the approved upload keystore and ignored `mobile/android/key.properties` inside this worktree. Relative `storeFile` paths resolve from `mobile/android/app`; do not paste credentials into reports or commit them.
2. Confirm Play history and the approved production API endpoint before choosing build parameters. Preserve `1.0.0+1` unless evidence requires a new version code.
3. Rebuild the release AAB with the production defines, without bypassing the signing guard.
4. Use a trusted bundletool to `validate --bundle=<AAB>` and `dump manifest --bundle=<AAB> --module=base`. Verify package `com.louvaio.app`, minSdk, targetSdk >= 36, versionName and versionCode directly from that artifact. Record artifact byte size and SHA-256.
5. Use JDK `jarsigner -verify -verbose -certs <AAB>` to check AAB/JAR signature integrity and compare the signer certificate SHA-256 to the release owner's approved upload certificate. A self-signed certificate warning is not by itself an invalid Android upload key; signature verification does not establish Play certificate identity. `apksigner` and `aapt dump badging` in the older release guide are APK-only checks, not AAB proof.
6. Record evidence and close the active ExecPlan only after the outstanding checks pass. No upload is authorized by this ticket.

## Version / Play history

Whether `1.0.0+1` has ever been uploaded to Play: **Unknown / Not yet verified**. No authoritative Play Console history/export is available in this worktree. Repository version and commit history cannot prove that a code was never uploaded.

No automatic version change. Request Play Console evidence across all tracks/artifacts. If code 1 is the highest used value, recommend code 2; if a higher value exists, recommend the verified maximum plus 1. Do not assume 2 is available without that evidence.

## REL-1 notification manifest correction addendum

No original REL-1 manifest/report was found among tracked files, documentation content or commits with a REL-1 subject available locally. Therefore a line-by-line correction of that report is **Unknown / Not yet verified**. Apply the following source-verified facts to that report when provided; these are documentation corrections, not changes to working behavior.

### HTTP contract

**`PATCH /api/v1/auth/notifications/read-all`**, not POST or PUT.

Evidence: `backend/src/app.ts` mounts auth routes under `/api/v1/auth`; `auth.routes.ts` mounts authenticated `/notifications`; `notification.routes.ts` registers `router.patch('/read-all', ...)`. `mobile/lib/features/notifications/data/notification_repository.dart` uses `dio.patch` for the same endpoint and reads `updatedCount`. The controller derives the user from authentication and the repository updates that user's unread records in `user_notifications`.

### Persisted types and actual producers

| Persisted type | Actual trigger / recipients | FCM routing type |
| --- | --- | --- |
| `schedule_assigned` | Schedule creation with participants, or newly added participants on update; resolved ministry participant user IDs, excluding actor when supplied | `schedule` |
| `schedule_updated` | Changes to title, date, time or duration (`duration_minutes` / `durationMinutes`); remaining existing participants, excluding actor when supplied | `schedule` |
| `schedule_comment` | New schedule comment; resolved participants excluding comment author | `schedule_comment` |
| `announcement` | New announcement; ministry member user IDs plus ministry owner, deduplicated and excluding author | `announcement` |

Evidence: `backend/src/features/notifications/notification.types.ts`, `notification.service.ts` (`hasMaterialScheduleChanges`, recipient resolution and dispatch), `backend/src/features/schedules/schedule.service.ts`, and `backend/src/features/announcements/announcement.service.ts`.

Important report distinctions:

- Four persisted business types are not four distinct FCM routing types. Mobile's `PushNotificationType.fromString` also accepts `schedule_assigned` / `schedule_updated` aliases and maps them to schedule navigation; unknown values map to `unknown`.
- Title and duration changes count as material schedule updates, not just date/time. Songs, liturgy and general non-material edits alone do not trigger `schedule_updated`.
- Schedule deletion and participation confirmation do not dispatch these notifications; announcement update/deletion do not dispatch them either. No reminder or cancellation type is declared in this notification contract.
- Recipient resolution queries ministry membership and linked `user_id`; despite comments saying “active”, it does not explicitly filter a membership status field. Manual members without a linked user ID are not recipients.
- Persistent notification creation is deduplicated; FCM is best-effort for newly created records. Do not claim guaranteed push delivery, durable retry or new physical-device validation from this audit.

## Validation and changes

- `flutter analyze`: PASS, no issues.
- `flutter test --reporter compact`: PASS, 395 tests, exit 0 (2m24s). Initial `flutter test` invocation exceeded the 120-second harness timeout; the longer rerun completed successfully.
- `flutter build appbundle --release`: FAIL, missing signing configuration, no AAB.
- Gradle metadata probe: PASS after correcting the temporary init script to skip included builds without `:app`.
- Backend/web tests: not run; their source and behavior are unchanged. Notification audit is source inspection, not a live API/FCM test.
- Changes: this report, release-guide corrections (API 36 naming and evidence-based version policy), and the active REL-2 ExecPlan. No tracked application source, dependency or version changes.
- No push, deploy or Play upload performed.

# REL-2 — Android release verification / REL-1 correction addendum

Date: 2026-10-01. Ticket: #11. Application source baseline: `8f95627`; this production verification resumed from `9e01ee0`.

**Verdict: PASS for REL-2.** The signed production candidate was rebuilt with the approved parameters, validated with bundletool, and its metadata and signer verified. No SDK, version, signing configuration or application behavior changes were necessary. This verdict does not authorize push, deployment, production mutation or Play upload.

## Authoritative release-owner decisions

The updated ticket supplies these final decisions, superseding the approval gaps recorded in earlier audit commits:

- No AAB has ever been uploaded to Google Play; `versionCode 1` is not consumed. Preserve `versionName 1.0.0` / `versionCode 1`. No increment is required. This history is release-owner attestation, not an independent Play Console query.
- Use the existing locally provisioned signing files, alias `louvaio-release`, and compare against the approved public SHA-256 fingerprint below. Do not generate another key or replace the certificate.
- The owner accepts the recorded self-signed/untrusted chain, absent timestamp, unsigned POSIX attributes and JarFile/JarInputStream warnings when signature verification, bundletool validation and approved fingerprint match pass. Do not re-sign/repackage merely to suppress warnings.
- Approved build parameters: `APP_ENV=production`, `API_BASE_URL=https://praise-app-gray.vercel.app/api/v1`.

## Android metadata: resolved configuration and resulting artifact

Inspected `mobile/android/app/build.gradle.kts`, `mobile/android/settings.gradle.kts`, `mobile/android/gradle/wrapper/gradle-wrapper.properties` and `mobile/pubspec.yaml`. SDK values are delegated to Flutter, not literal values in the app Gradle script.

Re-ran the existing ignored Gradle init script `mobile/build/rel2-metadata.gradle`, which registers `:app:rel2Metadata` after project evaluation and prints only allowlisted Android properties. From `mobile/android`:

```powershell
.\gradlew.bat :app:rel2Metadata -I ..\build\rel2-metadata.gradle --quiet
```

| Property | Resolved Gradle value | Verified from production AAB |
| --- | --- | --- |
| compileSdk | 36 | `compileSdkVersion="36"` |
| targetSdk | 36 | `targetSdkVersion="36"` |
| minSdk | 24 | `minSdkVersion="24"` |
| applicationId | `com.louvaio.app` | `package="com.louvaio.app"` |
| versionName | `1.0.0` | `versionName="1.0.0"` |
| versionCode | `1` | `versionCode="1"` |

Toolchain: `flutter --version` returned Flutter 3.47.5 stable / Dart 3.13.4; checked-in AGP 9.1.0, Gradle 9.3.1, Kotlin 2.4.0. The resolved target already meets API 36+. No established Android baseline was lowered. Gradle metadata resolution supplements, rather than relies solely on, the artifact manifest.

## Production build and artifact evidence

Ran from `mobile`:

```powershell
flutter analyze
flutter test
flutter build appbundle --release --dart-define=APP_ENV=production --dart-define=API_BASE_URL=https://praise-app-gray.vercel.app/api/v1
```

Results for this run:

- Analysis: exit 0, no issues (14.6s).
- Tests: exit 0, **395 passed** (6m31s).
- Production release build: exit 0, Gradle task 304.1s. Existing release signing guard preserved; no debug signing, keystore generation, credential editing or manual reading of signing secrets.
- AAB: **`mobile/build/app/outputs/bundle/release/app-release.aab`** (ignored, not committed).
- Size: **57,403,920 bytes** (54.7 MiB).
- SHA-256: **`b79cf56cfad056f4b65cc28d59c3d687ab5b28cf9639554ebcdccaf5b40e9219`**.
- Google bundletool **1.18.3** `validate`: exit 0. Existing tool SHA-256 rechecked: `a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29` (official release asset provenance recorded in `ddd6f0e`).
- `dump manifest --module=base`: exit 0; actual artifact XML retained in ignored `mobile/build/rel2-aab-manifest.xml`. Values match the table above.
- `jarsigner -verify -verbose -certs`: exit 0, **jar verified**. Bundle signature SHA256withRSA, 2048-bit key. Certificate self-signature SHA384withRSA. Public subject: `CN=LouvAIO, OU=Mobile, O=LouvAIO, L=Sao Paulo, ST=SP, C=BR`.
- `keytool -printcert -jarfile`: exit 0. Artifact signer SHA-256 **`4E:5B:70:85:7C:B9:9D:8F:52:2E:C6:B7:B7:3B:64:1C:62:54:F8:8A:AA:E5:0A:09:49:52:25:A8:83:45:A8:C1`**, exact match to the ticket-approved upload certificate.
- The accepted JDK warnings recur: self-signed/untrusted certificate chain, absent timestamp (expiry 2054-02-13), POSIX attributes not signature-protected, and JarFile/JarInputStream inconsistency. Full output remains locally in ignored `mobile/build/rel2-signature-verification.txt`. No warning suppression or re-signing/repackaging was performed.
- Read-only ZIP inspection found the approved API URL in all three compiled `libapp.so` entries (arm64-v8a, armeabi-v7a, x86_64). An exploratory assertion that the development URL must be absent failed: fallback strings remain compiled too. That assertion is not a valid environment test. The successful explicit build invocation and `AppEnvironment.fromDartDefines` establish build configuration; string presence alone does not prove runtime branch selection. No application code was changed to remove fallback constants.
- `git check-ignore` confirms the signing properties, keystore and AAB remain ignored.

Reproduction (repository root, verified bundletool already present):

```powershell
java -jar mobile/build/bundletool-all-1.18.3.jar validate --bundle=mobile/build/app/outputs/bundle/release/app-release.aab
java -jar mobile/build/bundletool-all-1.18.3.jar dump manifest --bundle=mobile/build/app/outputs/bundle/release/app-release.aab --module=base
jarsigner -verify -verbose -certs mobile/build/app/outputs/bundle/release/app-release.aab
keytool -printcert -jarfile mobile/build/app/outputs/bundle/release/app-release.aab
Get-FileHash mobile/build/app/outputs/bundle/release/app-release.aab -Algorithm SHA256
(Get-Item mobile/build/app/outputs/bundle/release/app-release.aab).Length
```

This production artifact supersedes the earlier **development-default metadata-verification artifact** (57,404,137 bytes; SHA-256 `62a99eb2a345c18090016d025be639c5b550e843883ea3c5ef789c508554070b`) documented in `ddd6f0e` and `9e01ee0`. Do not use that previous hash for this candidate.

## REL-1 notification manifest correction addendum

No original REL-1 report is present in the tracked checkout (as established by the earlier audit). Direct editing of that external report is **Unknown / Not yet verified**. This source-verified addendum supplies the report-only corrections without modifying working behavior.

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

Rechecked `backend/src/features/notifications/notification.service.ts` (`hasMaterialScheduleChanges`, recipient resolution and dispatch), notification routes/types, `backend/src/features/schedules/schedule.service.ts`, and `backend/src/features/announcements/announcement.service.ts`.

Important report distinctions:

- Four persisted business types are not four distinct FCM routing types. Mobile's `PushNotificationType.fromString` also accepts `schedule_assigned` / `schedule_updated` aliases and maps them to schedule navigation; unknown values map to `unknown`.
- Title and duration changes count as material schedule updates, not just date/time. Songs, liturgy and general non-material edits alone do not trigger `schedule_updated`.
- Schedule deletion and participation confirmation do not dispatch these notifications; announcement update/deletion do not dispatch them either. No reminder or cancellation type is declared in this notification contract.
- Recipient resolution queries ministry membership and linked `user_id`; despite comments saying “active”, it does not explicitly filter a membership status field. Manual members without a linked user ID are not recipients.
- Persistent notification creation is deduplicated; FCM is best-effort for newly created records. Do not claim guaranteed push delivery, durable retry or new physical-device validation from this audit.

## Changes, limitations and handoff

- Documentation only: this verification report, `docs/mobile/release.md`, and the REL-2 ExecPlan finalized under `docs/exec-plans/completed/`. No application source, SDK baseline, version, dependency, public API or Firestore collection changes.
- Backend/web builds and tests not run because their source and behavior are unchanged. No new behavior requiring new tests was introduced.
- Remaining toolchain risk: the build warns that Kotlin Gradle Plugin use in the app/plugins will be incompatible with future Flutter versions. No unrelated migration was attempted.
- Physical-device execution of this production AAB, live production endpoint health/FCM delivery and actual Play acceptance: **Unknown / Not yet verified**; none is implied by local bundle validation. The owner-provided Play history and approvals are no longer blockers for REL-2.
- No push, deploy, Play upload or production mutation performed. Any later rebuild must have its own artifact hash and verification; preserve this candidate for the separately authorized release workflow.

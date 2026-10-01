# REL-2 — Android release verification / REL-1 correction addendum

Date: 2026-10-01. Ticket: #11. Application source baseline: `8f95627`; resumed from audit commit `eca9ed4` after signing files were provisioned in the worktree.

**Verdict: REMEDIATION_REQUIRED.** Signed release AAB build, artifact metadata checks and Flutter tests now pass. The previous missing-signing blocker is resolved without source changes. Production approval still requires Play history, approved upload certificate comparison and production environment confirmation. This is not approval for production integration.

## Android metadata: resolved configuration and resulting artifact

Inspected `mobile/android/app/build.gradle.kts`, `mobile/android/settings.gradle.kts`, `mobile/android/gradle/wrapper/gradle-wrapper.properties` and `mobile/pubspec.yaml`. SDK values are delegated to Flutter, not literal values in the app Gradle script.

An ephemeral, ignored Gradle init script in `mobile/build/rel2-metadata.gradle` registered `:app:rel2Metadata` after project evaluation and printed only the following allowlisted Android properties. Ran from `mobile/android`:

```powershell
.\gradlew.bat :app:rel2Metadata -I ..\build\rel2-metadata.gradle --quiet
```

| Property | Resolved Gradle value | Verified from resulting AAB? |
| --- | --- | --- |
| compileSdk | 36 | Manifest also records `compileSdkVersion="36"` |
| targetSdk | 36 | Yes: `targetSdkVersion="36"` |
| minSdk | 24 | Yes: `minSdkVersion="24"` |
| applicationId | `com.louvaio.app` | Yes: `package="com.louvaio.app"` |
| versionName | `1.0.0` | Yes: `versionName="1.0.0"` |
| versionCode | `1` | Yes: `versionCode="1"` |

Toolchain: `flutter --version` returned Flutter 3.47.5 stable / Dart 3.13.4; checked-in AGP 9.1.0, Gradle 9.3.1, Kotlin 2.4.0. Gradle emitted warnings about future incompatibility of the Kotlin Gradle Plugin; no dependency/toolchain migration was attempted.

The resolved target already meets API 36+. No SDK baseline, package, version or application behavior was changed. `compileSdk` is a build configuration property; an AAB manifest alone is not a substitute for resolving Gradle configuration.

## Build and artifact status

Ran the exact requested command from `mobile`:

```powershell
flutter build appbundle --release
```

Exit 0; Gradle build completed in 429.5 seconds. The earlier attempt recorded in `eca9ed4` failed for missing signing configuration. On this resumed run, ignored `mobile/android/key.properties` and `mobile/android/app/upload-keystore.jks` were already present. No signing files were created, edited or substituted by this run, and no secret values were printed. The existing Gradle release signing guard remains unchanged; debug signing was not used.

- AAB: `mobile/build/app/outputs/bundle/release/app-release.aab` (ignored, not committed).
- Size: **57,404,137 bytes** (54.7 MiB; Flutter reports 54.7MB).
- SHA-256: `62a99eb2a345c18090016d025be639c5b550e843883ea3c5ef789c508554070b`.
- Bundle structure: Google bundletool **1.18.3** `validate` passed, exit 0.
- Artifact metadata: `dump manifest --module=base` passed, exit 0; decoded XML retained locally in `mobile/build/rel2-aab-manifest.xml`. Values are in the table above, not inferred from `pubspec.yaml`.
- Tool provenance: downloaded `bundletool-all-1.18.3.jar` from `google/bundletool` GitHub release into ignored `mobile/build/`; SHA-256 matched the release asset API digest: `a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29`.
- Signing: `jarsigner -verify -verbose -certs` returned **jar verified**, exit 0. Public signer subject: `CN=LouvAIO, OU=Mobile, O=LouvAIO, L=Sao Paulo, ST=SP, C=BR` (not the Android Debug subject). Bundle signature: SHA256withRSA, 2048-bit key.
- Public signer certificate SHA-256, read from the AAB using `keytool -printcert -jarfile`: `4E:5B:70:85:7C:B9:9D:8F:52:2E:C6:B7:B7:3B:64:1C:62:54:F8:8A:AA:E5:0A:09:49:52:25:A8:83:45:A8:C1`. Match to the Play-approved upload certificate: **Unknown / Not yet verified**.
- JDK verification warnings: self-signed/untrusted certificate chain, absent timestamp (certificate expiry reported as 2054-02-13), POSIX attributes not signature-protected, and JarFile/JarInputStream inconsistency (manifest unavailable to the streaming reader, entries verified by JarFile but not JarInputStream). These warnings are retained in `mobile/build/rel2-signature-verification.txt`; they were not suppressed or represented as warning-free verification. Bundletool validates the bundle structure, not Play acceptance. Do not re-sign/repackage the artifact just to hide a warning.
- Production endpoint/runtime validation: **Unknown / Not yet verified**. This exact bare build command uses development defaults from `mobile/lib/app/environment/app_environment.dart`, not production defines. This is a signed **metadata-verification artifact**, not an approved production candidate. The eventual production candidate needs `--dart-define=APP_ENV=production` and an explicitly approved HTTPS `API_BASE_URL`; do not infer endpoint health from documentation.

Reproduction (from repository root, with the verified bundletool already present):

```powershell
java -jar mobile/build/bundletool-all-1.18.3.jar validate --bundle=mobile/build/app/outputs/bundle/release/app-release.aab
java -jar mobile/build/bundletool-all-1.18.3.jar dump manifest --bundle=mobile/build/app/outputs/bundle/release/app-release.aab --module=base
jarsigner -verify -verbose -certs mobile/build/app/outputs/bundle/release/app-release.aab
keytool -printcert -jarfile mobile/build/app/outputs/bundle/release/app-release.aab
Get-FileHash mobile/build/app/outputs/bundle/release/app-release.aab -Algorithm SHA256
```

### Required release-owner follow-up

1. Provide authoritative Play version history and the approved upload certificate fingerprint; compare the latter with the artifact fingerprint above. Do not provide private keys/passwords in reports.
2. Confirm the production API endpoint and whether a new version code is necessary. Preserve `1.0.0+1` unless evidence requires a change.
3. Build the actual production candidate with approved production defines, without bypassing the signing guard. Repeat bundletool manifest/structure verification, signature checks, byte size and SHA-256 for that new artifact; this artifact's hash does not apply to a future rebuild.
4. Review the JDK streaming-reader warnings with the release tooling owner before production acceptance. A self-signed certificate warning alone is not an invalid Android upload key; local signature verification does not prove Play acceptance. `apksigner` and `aapt dump badging` in the older release guide are APK-only checks, not AAB proof.
5. Provide the original REL-1 manifest for direct report correction if it exists outside this checkout. Close the active ExecPlan only after the outstanding release checks pass. No upload is authorized by this ticket.

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
- `flutter test`: PASS, 395 tests, exit 0 (2m02s) on the resumed run.
- `flutter build appbundle --release`: PASS, signed AAB produced, exit 0 (429.5s Gradle task). Kotlin migration/deprecated Java API warnings remain; no unrelated toolchain upgrade was attempted.
- Gradle metadata probe: PASS, re-run confirmed all six values above.
- Bundletool validation and manifest dump: PASS, exit 0 each.
- JDK signature verification: `jar verified`, exit 0, with the warnings documented above. Play certificate approval/acceptance remains unverified.
- Backend/web tests: not run; their source and behavior are unchanged. Notification audit is source inspection, not a live API/FCM test.
- Changes: this report, release-guide corrections (API 36 naming and evidence-based version policy), and the active REL-2 ExecPlan. No tracked application source, dependency or version changes.
- No push, deploy or Play upload performed.

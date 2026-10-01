# LouvAIO Mobile — Android Release Guide (Mobile V1-M8)

## 1. Overview
This document specifies the Android release configuration, signing procedures, version policy, and environment parameters for LouvAIO Mobile (`com.louvaio.app`). For the verified REL-2 production AAB, release-owner approvals and REL-1 notification corrections, see [REL-2 verification](rel2-verification.md). The APK checks below do not establish AAB release readiness.

---

## 2. Release Signing Setup

### 2.1 Configuration File (`key.properties`)
Release signing parameters are read by `mobile/android/app/build.gradle.kts` from:
```
mobile/android/key.properties
```
This file is **strictly gitignored** (configured in both root `.gitignore` and `mobile/android/.gitignore`). A template is provided at `mobile/android/key.properties.example`.

Format:
```properties
storeFile=upload-keystore.jks
storePassword=<STORE_PASSWORD>
keyAlias=louvaio-release
keyPassword=<KEY_PASSWORD>
```

### 2.2 Security & Keystore Invariants
- Private keys and keystores (`*.keystore`, `*.jks`) MUST NOT be committed to git.
- Passwords MUST NOT be hardcoded in Gradle files, committed, or output in logs.
- Debug builds continue using the default Android debug keystore without requiring `key.properties`.
- Release builds enforce signing at configuration time: if `key.properties` is missing or the keystore does not exist, the build terminates with a clear, readable `GradleException`.

### 2.3 Keystore Backup Responsibility
The release keystore (`upload-keystore.jks`) and associated credentials constitute the cryptographic identity of LouvAIO on Android devices and the Google Play Store.
- **Backup Requirement**: The keystore and credentials must be stored securely in the organization's encrypted secrets manager / KMS.
- **Consequence of Loss**: If lost, existing app installations cannot be updated seamlessly and may require re-signing or package namespace reset with user data loss.

---

## 3. Version Policy

### 3.1 Canonical Source
App versioning is maintained canonically in:
```yaml
# mobile/pubspec.yaml
version: 1.0.0+1
```
Flutter maps:
- `1.0.0` → `versionName` in Android (major.minor.patch semantic versioning).
- `1` → `versionCode` in Android (monotonically increasing integer).

### 3.2 Monotonic Release Rules
- Do not increment `versionCode` merely to rebuild or inspect a local release candidate. Before a new Play upload, the release owner must check version codes already used across all tracks/artifacts and select an unused, monotonically increasing code. If the highest used code is 1, recommend 2; otherwise recommend the verified maximum plus 1. Never infer upload history from `pubspec.yaml`.
- `versionName` follows Semantic Versioning 2.0.0 (`MAJOR.MINOR.PATCH`).
- Current baseline for Mobile V1: `versionName: 1.0.0`, `versionCode: 1`.

---

## 4. Production Environment Configuration

### 4.1 Dart Defines
REL-2 production AAB parameters approved by the release owner:
```bash
flutter build appbundle --release \
  --dart-define=APP_ENV=production \
  --dart-define=API_BASE_URL=https://praise-app-gray.vercel.app/api/v1
```
A bare release build uses development defaults; it is not the production candidate. The owner confirms no AAB has been uploaded to Play and code 1 is unconsumed for REL-2; preserve `1.0.0+1`.

### 4.2 Security Guards
- In `production`, `API_BASE_URL` MUST use the `https://` protocol. The application rejects cleartext `http://` at startup with an `ArgumentError`.
- Cleartext traffic is disabled in release builds (no debug `network_security_config.xml` merged).
- Technical diagnostics (UID, API URL, environment badge, internal error stack traces) are hidden in production builds.

---

## 5. Firebase Project & Package Mapping

| Property | Value |
|---|---|
| **Package / Application ID** | `com.louvaio.app` |
| **Firebase Project ID** | `praise-app-7a362` |
| **Firebase App ID** | `1:561790102847:android:03f0df88f33ecb3361b78a` |
| **Configuration File** | `mobile/android/app/google-services.json` |

---

## 6. Android SDK & Toolchain Baseline

| Component | Target Version |
|---|---|
| **compileSdk** | 36 (Android 16; resolved from Flutter during REL-2) |
| **targetSdk** | 36 |
| **minSdk** | 24 (Android 7.0 Nougat) |
| **Android Gradle Plugin (AGP)** | 9.1.0 |
| **Gradle** | 9.3.1 |
| **Kotlin** | 2.4.0 |
| **JDK** | OpenJDK 21 (Amazon Corretto 21.0.12) |

---

## 7. Confirmed Physical Test Device

Authoritative device properties verified via `adb shell getprop`:
- **Manufacturer**: `LENOVO`
- **Model**: `Lenovo TB-J616F` (Lenovo Tab P11 Plus)
- **OS Version**: Android 12
- **SDK Version**: 31

---

## 8. Build & Verification Procedures

### 8.1 Release Build
```bash
cd mobile
flutter build appbundle --release \
  --dart-define=APP_ENV=production \
  --dart-define=API_BASE_URL=https://praise-app-gray.vercel.app/api/v1
```
For this AAB, use the bundletool validation/manifest dump, jarsigner and public certificate checks in [REL-2 verification](rel2-verification.md). APK commands below apply only to a separately built APK and are not substitutes for AAB verification.

### 8.2 APK Signature Verification
```bash
"$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --verbose --print-certs \
  mobile/build/app/outputs/flutter-apk/app-release.apk
```
Expected output:
- `Verified using v2 scheme (APK Signature Scheme v2): true`
- `Signer #1 certificate DN: CN=LouvAIO, ...` (NOT Android Debug certificate).

### 8.3 Package & Manifest Audit
```bash
"$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\aapt.exe" dump badging \
  mobile/build/app/outputs/flutter-apk/app-release.apk
```
Confirm:
- `package: name='com.louvaio.app' versionCode='1' versionName='1.0.0'`
- `targetSdkVersion:'36'`
- `application: label='LouvAIO' icon='res/BW.xml'`

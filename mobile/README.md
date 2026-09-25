# LouvAIO Mobile Client (Flutter Android-First)

Native mobile application for the LouvAIO platform.

- **Application ID**: `com.louvaio.app`
- **Architecture**: Riverpod (DI / State), GoRouter (Navigation), Dio (HTTP), SharedPreferences (Local Preferences).
- **Backend Reference**: Consumes the LouvAIO Express REST API (`/api/v1`).

---

## Prerequisites

- Flutter SDK 3.47.5+ (Channel stable)
- Dart SDK 3.13.4+
- Android SDK (API 36 / build-tools 36.0.0) with Gradle 9.3.1+ and JDK 21+ for Android builds and emulator

---

## Operational Commands

### 1. Install Dependencies
```bash
flutter pub get
```

### 2. Format & Linter Checks
```bash
# Verify formatting
dart format --set-exit-if-changed .

# Static analysis
flutter analyze
```

### 3. Run Automated Tests
```bash
flutter test
```

### 4. Run on Android Emulator (Local Development)
When running against the local Windows backend running at `localhost:3000`:
```bash
flutter run \
  --dart-define=APP_ENV=development \
  --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

### 5. Run on Physical Android Device (via ADB Reverse)
Forward host port 3000 to device, then run:
```bash
adb reverse tcp:3000 tcp:3000
flutter run \
  --dart-define=APP_ENV=development \
  --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1
```

### 6. Build Android Debug APK
```bash
flutter build apk --debug \
  --dart-define=APP_ENV=development \
  --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1
```

### 7. Build Android Release APK (Staging / Production)
Production requires an explicit HTTPS base URL:
```bash
flutter build apk --release \
  --dart-define=APP_ENV=production \
  --dart-define=API_BASE_URL=https://<authoritative-api-host>/api/v1
```

---

## Architecture Documentation

See [docs/mobile/architecture.md](../../docs/mobile/architecture.md) for full architectural decisions and invariants.

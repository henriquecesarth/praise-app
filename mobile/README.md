# LouvAIO Mobile Client (Flutter Android-First)

Native mobile application for the LouvAIO platform.

- **Application ID**: `com.louvaio.app`
- **Architecture**: Riverpod (DI / State), GoRouter (Navigation), Dio (HTTP), SharedPreferences (Local Preferences).
- **Backend Reference**: Consumes the LouvAIO Express REST API (`/api/v1`).

---

## Prerequisites

- Flutter SDK 3.22.2+ (Channel stable)
- Dart SDK 3.4.3+
- Android Studio / Android SDK (API 34+) for Android builds and emulator

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

### 5. Build Android Debug APK
```bash
flutter build apk --debug \
  --dart-define=APP_ENV=development \
  --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

### 6. Build Android Release APK (Staging / Production)
Production requires an explicit HTTPS base URL:
```bash
flutter build apk --release \
  --dart-define=APP_ENV=production \
  --dart-define=API_BASE_URL=https://<authoritative-api-host>/api/v1
```

---

## Architecture Documentation

See [docs/mobile/architecture.md](../../docs/mobile/architecture.md) for full architectural decisions and invariants.

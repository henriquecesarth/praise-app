# LouvAIO Mobile — Native Client Architecture (Mobile V1)

## 1. Overview & Project Placement

LouvAIO Mobile is the native mobile client for the LouvAIO platform. It lives in the repository under:

```
mobile/
```

Alongside the existing packages:
- `backend/`: Express 5 REST API + Firebase Firestore.
- `web/`: React 18 + Vite SPA / PWA (the administrative reference client).

Mobile is **a new client of the SAME LouvAIO backend**. It does not introduce a secondary backend, duplicate domain logic, or diverge from LouvAIO API contracts.

---

## 2. Platform Strategy & Application ID

- **Strategy**: Flutter **Android-first**, designed with clean cross-platform abstraction for future iOS compatibility.
- **Application ID (Android)**: `com.louvaio.app`
- **Project/Package Name**: `louvaio_mobile`
- **User-Facing Label**: `LouvAIO`

---

## 3. Technology Stack & Key Libraries

| Concern | Solution | Rationale |
|---|---|---|
| **Framework** | Flutter (Stable 3.22.2+, Dart 3.4.3+) | High-performance native rendering for mobile. |
| **State Management & DI** | `flutter_riverpod` (v2) | Single, type-safe, compile-time verified dependency injection and state graph. |
| **Routing** | `go_router` | Declarative, URL-driven navigation matching modern Flutter standards. |
| **HTTP Transport** | `dio` (v5) | Robust interceptor pipeline, timeout control, and centralized sanitized logging. |
| **Preferences Storage** | `shared_preferences` | Non-authoritative, lightweight user preferences. |
| **Testing** | `flutter_test`, `mocktail` | Unit, widget, and mock testing without brittle golden fixtures. |

---

## 4. Architectural Boundaries & Invariants

```
Presentation (Widgets / Screens)
       │
       ▼
Riverpod Providers (State / Controllers)
       │
       ▼
ApiClient (Dio HTTP)
       │ (JSON via REST)
       ▼
LouvAIO Backend (/api/v1)
```

1. **Server Authority**: The backend is the sole authority for security, tenancy, permissions, quotas, and business rules. Mobile never implements parallel quota enforcement or offline administrative logic.
2. **Authentication (M2 Preparation)**:
   - Mobile V1 uses Firebase Authentication (Firebase ID Token) as verified bearer authority (`Authorization: Bearer <firebase_id_token>`).
   - ID tokens are managed by the Firebase Auth SDK in M2 and **never stored in local SharedPreferences**.
3. **Non-Authoritative Preferences**: `PreferencesStorage` stores only user convenience preferences:
   - `selectedMinistryId`
   - `themeMode`
   - **Never store**: ID tokens, passwords, provider credentials, or authorization roles.
4. **V1 Feature Scope**:
   - Administrative SaaS operations (Billing/Plan Management) and WhatsApp Integration onboarding remain Web/PWA-exclusive flows in V1.
   - Mobile focuses on musician/leader workflow: schedules, repertoire, availability, and ministry context.

---

## 5. Directory Structure

```
mobile/lib/
├── app/
│   ├── app.dart                   # Root MaterialApp.router
│   ├── bootstrap.dart             # Explicit initialization before runApp
│   ├── providers.dart             # Central Riverpod provider graph
│   ├── environment/
│   │   └── app_environment.dart   # Typed compile-time --dart-define configuration
│   ├── router/
│   │   └── app_router.dart        # GoRouter routes and redirect logic
│   ├── shell/
│   │   └── app_shell.dart         # Foundation shell with brand header and env badge
│   └── theme/
│       └── app_theme.dart         # Material 3 Light/Dark brand themes
├── core/
│   ├── errors/
│   │   └── app_failure.dart       # Failure model mapping backend { error: { message, details } }
│   ├── http/
│   │   └── api_client.dart        # Dio client, timeouts, sanitized logging, error translation
│   ├── logging/
│   │   └── app_logger.dart        # Sanitizing logger (redacts tokens, passwords, secrets)
│   └── storage/
│       └── preferences_storage.dart # SharedPreferences abstraction
├── features/
│   ├── auth/                      # Authentication (M2 target)
│   ├── ministry_context/          # Active ministry tenant context
│   ├── dashboard/                 # Member dashboard
│   ├── schedules/                 # Service schedules and liturgies
│   ├── availability/              # Self-service member availability
│   ├── repertoire/                # Songs and versions
│   └── profile/                   # Member profile
└── shared/
    ├── models/
    └── widgets/
```

---

## 6. Environment & Network Configuration

Configuration is passed via compile-time `--dart-define`:
- `APP_ENV`: `development` | `staging` | `production` (default: `development`)
- `API_BASE_URL`: Full base URL for the backend API.
  - In `development`: defaults to `http://10.0.2.2:3000/api/v1` (routes Android Emulator loopback to Windows host backend).
  - In `production`: **must be explicitly provided** and **must use HTTPS**.

### Android Debug Network Security

To allow local HTTP development against the host machine without weakening production security:
- `mobile/android/app/src/debug/res/xml/network_security_config.xml` enables cleartext traffic **strictly** for `10.0.2.2`, `localhost`, and `127.0.0.1`.
- `mobile/android/app/src/debug/AndroidManifest.xml` attaches this configuration only during debug builds.
- Production/Release builds merge only `main/AndroidManifest.xml`, maintaining strict HTTPS enforcement.

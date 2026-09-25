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
| **Framework** | Flutter (Stable 3.47.5+, Dart 3.13.4+) | High-performance native rendering for mobile. |
| **Android Toolchain** | Android SDK 36 (build-tools 36.0.0, Gradle 9.3.1, Kotlin 2.4.0) | Modern Android SDK with user-space CLI bootstrap and JDK 21 compatibility. |
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
2. **Authentication (Mobile V1-M2)**:
   - Mobile V1 uses Firebase Authentication (Firebase ID Token) as verified bearer authority (`Authorization: Bearer <firebase_id_token>`).
   - Android client registered in canonical project `praise-app-7a362` with App ID `1:561790102847:android:03f0df88f33ecb3361b78a`.
   - ID tokens are managed exclusively by Firebase Auth SDK and **never stored in local SharedPreferences**.
   - `AuthInterceptor` automatically injects `Bearer <token>` on requests requiring auth (`requiresAuth: true`).
   - Single-attempt 401 recovery: interceptor forces token refresh (`forceRefresh: true`), replays the request with `auth_retry: true`, and fails closed without looping on persistent 401s, calling `onAuthenticationFailed` to clear the session.
   - User identity is confirmed authoritatively via backend `GET /api/v1/auth/me`.
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

---

## 7. Ministry Bootstrap & Native Tenant Shell (Mobile V1-M3)

### 7.1 Backend Authority
- Endpoint: `GET /api/v1/ministries/my-ministries`.
- This endpoint is the single source of truth for:
  - Ministries available to the authenticated user.
  - The effective user role for each ministry (`admin` | `member`).
- Mobile **never** treats cached ministry data, cached roles, or local storage as authorization authority.

### 7.2 Bootstrap Lifecycle
State is managed via `MinistryContextNotifier` (`MinistryContextState`):
- `MinistryBootstrapStatus`: `initializing` → `loading` → `ready` | `needsSelection` | `empty` | `error`.
- **0 ministries**: transitions to `MinistryBootstrapStatus.empty`. Router renders `MinistryEmptyScreen` with informative message, "Atualizar" button, and "Sair da Conta" action.
- **1 ministry**: automatically selected and saved to local preference. Transitions to `ready`.
- **>1 ministries**:
  - Checks user-scoped preference `selected_ministry_id_<userId>`.
  - If preferred ID is present and exists in the fresh `my-ministries` list: selected automatically.
  - If preferred ID is null, unknown, or no longer in `my-ministries`: transitions to `needsSelection`. Router renders `MinistrySelectorScreen`.
- **Network / server failure**: transitions to `error` with retry action. Never presents false empty states.

### 7.3 Tenant Switching & User Isolation
- Active ministry context is held in memory by `MinistryContextNotifier`.
- Switching ministry via `MinistrySwitcherSheet` updates the active selection in memory, saves the preference, and executes **zero backend mutations**.
- Context is strictly user-isolated: preferences key is partitioned by Firebase user ID (`selected_ministry_id_<userId>`).
- On logout or user change, `MinistryContextNotifier.reset()` clears all active ministry and role states.

### 7.4 Responsive Navigation Shell
`AppShell` provides the canonical native UI shell conforming to Material 3:
- **Responsive breakpoint**: `600dp`.
  - **Compact (< 600dp, Phone)**: Bottom `NavigationBar` with 4 canonical destinations: *Início*, *Escalas*, *Repertório*, *Perfil*. Top `AppBar` with ministry switcher button and LouvAIO branding.
  - **Expanded (>= 600dp, Tablet / Large screen)**: Left-aligned `NavigationRail` with LouvAIO logo header, ministry indicator button, navigation destinations, and footer user profile tile.
- **Touch target accessibility**: All interactive elements (ministry switcher, navigation items, buttons) satisfy minimum `48x48dp` targets.
- **Clean separation from diagnostics**: Raw UID, token, and backend URL diagnostics are removed from user presentation.

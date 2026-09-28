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

---

## 8. Schedule Member Workflows & Tenant Safety (Mobile V1-M5A)

### 8.1 Civil Date Policy & Sorting
- Mobile schedules follow a strict civil wall-clock policy:
  - Date is strictly a civil `DATE_ONLY` (`YYYY-MM-DD`).
  - Time is local `LOCAL_TIME` (`HH:mm` or `HH:mm:ss`).
  - Dates and times are never converted through UTC or affected by timezone shifts.
- List sorting and tabs:
  - **Próximas**: filters schedules where `date >= today` (or today with time >= now) and sorts nearest first (ascending by date/time).
  - **Anteriores**: filters schedules where `date < today` (or today with time < now) and sorts latest first (descending by date/time).
- Pull-to-refresh is supported; read-only member presentation (no admin creation or editing controls).

### 8.2 Detail & Server-Authoritative Confirmation
- Route and detail state are strictly keyed by `(ministryId, scheduleId)`.
- Detail displays only fields present in authoritative DTO: title, date/time, duration (fallback support for `duration_minutes` / `durationMinutes`), notes, participants, songs/timeline/clothing.
- Confirmation sends strictly `{ confirmed: boolean }` via `PATCH /ministries/:ministryId/schedules/:scheduleId/confirmation`.
  - Backend derives authenticated user identity; client never targets or edits another participant.
  - On HTTP 200, local authoritative detail is replaced by the returned `ScheduleRecord`.
  - No optimistic state invention or blind retries.
  - 403 (not a participant) and 400 (past schedule) errors fail safely with user feedback.

### 8.3 Comments & Commercial Restriction Handling
- First-page chronological read (`GET /ministries/:ministryId/schedules/:scheduleId/comments`).
- Composer enforces 1–1000 character length with submit debounce.
- On `POST`, client waits for HTTP 201 before adding the comment and clearing the composer.
- Commercial restriction error codes (`SUBSCRIPTION_RESTRICTED`, `SUBSCRIPTION_SUSPENDED`) disable the composer and display an informative restriction banner while preserving read access.
- In-flight mutations are never blindly retried upon network failure.

### 8.4 Multi-Tenant Isolation & Stale Protection
- `scheduleDetailNotifierProvider` and `commentsNotifierProvider` are keyed by `(ministryId, scheduleId)`.
- When the active ministry switches, detail and comments notifiers are immediately cleared.
- `ScheduleDetailView` listens to `ministryContextNotifierProvider` and automatically pops if the active ministry changes away from `widget.ministryId`.
- Mismatched states discard stale responses and render loading or refresh, preventing cross-tenant leakage.

---

## 9. Member Availability Self-Service (Mobile V1-M5B)

### 9.1 Endpoints & Data Model
- `GET /api/v1/ministries/:ministryId/availability/my-records`: returns member's own availability declarations.
- `POST /api/v1/ministries/:ministryId/availability`: creates an unavailability entry (`type: 'unavailable'`, `date_start`, `date_end`, optional `reason`).
- `DELETE /api/v1/ministries/:ministryId/availability/:recordId`: deletes an availability declaration.

### 9.2 Authoritative Tenant & User Derivation
- Backend derives user identity (`req.user.id`) directly from the verified Firebase ID token.
- Client never passes or alters member ID; requests are strictly member-scoped.
- Dates are strictly civil wall-clock dates (`YYYY-MM-DD`).
- Multi-tenant isolation: `availabilityListNotifierProvider` is keyed by `ministryId`. Active entries are purged immediately when ministry changes.

---

## 10. Repertoire Browsing & Song Detail (Mobile V1-M6)

### 10.1 Backend Contract & Endpoints
- `GET /api/v1/ministries/:ministryId/songs`: list songs with optional query parameters (`search`, `cursor`, `limit`, `classification_id`).
  - Envelope: `{ data: SongSummary[], total, nextCursor, hasMore, limit, page, totalPages }`.
- `GET /api/v1/ministries/:ministryId/songs/:songId`: single song detail.
  - Envelope: `{ data: SongDetail }`.
- `GET /api/v1/ministries/:ministryId/classifications`: list classification tags.
  - Envelope: `{ data: Classification[] }`.

### 10.2 List, Search & Pagination
- **Search**: backend-supported `search` query with 300ms debounce.
- **Stale Response Protection**: incremental request sequencing token discards out-of-order or stale search responses.
- **Pagination**: cursor-based (`nextCursor`) continuation with limit clamped to backend defaults (20). Songs are deduplicated by ID on append.
- **Pull-to-Refresh**: resets pagination, clears cache, and fetches the latest first page.
- **Classification Filter**: optional horizontal filter chips loaded from backend classifications. Selecting or deselecting resets pagination and triggers a fresh filtered search.

### 10.3 Native Song Detail
- Read-only presentation of real backend fields:
  - Title, artist, musical key badge, BPM chip, duration chip.
  - Classification chip with server-supplied color.
  - Notes / observations in a styled container.
  - Selectable lyrics with readable typography (`letterSpacing: 0.2`, `height: 1.5`), respecting system accessibility font scaling.
  - External links (YouTube, audio, chord sheet, external links) opened safely via `url_launcher` (`LaunchMode.externalApplication`) with URI scheme verification (`http`/`https`).
- **Zero Admin Controls**: no creation, editing, deletion, or chord transposition authoring controls appear.

### 10.4 Multi-Tenant Isolation
- `repertoireListNotifierProvider` is keyed strictly by `ministryId`.
- `songDetailNotifierProvider` is keyed by `(ministryId, songId)`.
- On ministry switch:
  - `AppShell` triggers reset of repertoire list and song detail providers.
  - `SongDetailView` listens to active ministry and automatically pops if the active ministry changes away from the viewed song's ministry.
  - No song data from Ministry A is ever retained or rendered under Ministry B.

### 10.5 Responsive Phone & Tablet Layout
- **Phone (< 600dp)**: full-width list items, bottom navigation bar.
- **Tablet (>= 600dp)**: left navigation rail, content constrained to responsive max-width (800dp) with center alignment to prevent overly stretched lines and maintain lyrics readability.

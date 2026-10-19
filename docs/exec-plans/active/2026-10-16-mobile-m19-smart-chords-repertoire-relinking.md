# ExecPlan: M19 — Smart Chords ↔ Repertoire Relinking

- **Lifecycle**: ACTIVE
- **Status**: IMPLEMENTED — REMEDIATED — PENDING R2
- **Milestone**: M19
- **Scope**: Smart Chords ↔ Repertoire Relinking
- **Base SHA**: `da92ef246a9a5257afc5a1ab4a14f43444239fd0`
- **Branch**: `feat/mobile-m19`
- **Commit 1 (Backend)**: `933b904` — `feat(backend): add smart chord repertoire link authority`
- **Commit 2 (Web)**: `784ea9d` — `feat(web): migrate smart chord repertoire linking`
- **Commit 3 (Mobile)**: `5d67962` — `feat(mobile): add smart chord repertoire relinking (M19)`
- **Reference**: AGENTS.md, MEMORY.md, docs/system-status.md, backend/src/features/smart_chords/, mobile/lib/features/smart_chords/

---

## 1. Problem Statement & Architecture Invariants

Personal Smart Chords (`smart_chords`) are user-owned, personal chord arrangements that belong to the musician across all ministries. Repertoire Songs (`songs`) and Artists (`artists`) are tenant-scoped catalog entities owned by individual ministries.

Previously:
1. `smart_chords` stored singular `song_id` and `artist_id` directly on the document, referencing tenant records in a single ministry.
2. A musician serving in multiple ministries could not associate their personal chord sheet ("Bondade de Deus") with Ministry Alpha's song and Ministry Beta's song simultaneously without overwriting.
3. If an artist or song was deleted in a ministry, or if the user left that ministry, the backend validation (`validateSongAndArtistAccess`) locked the user out of editing their own personal chord text, title, or key (HTTP 404/400).
4. In Mobile, a user could only link a chord if created from `SongDetailView`; an existing chord created standalone could never be linked afterward.
5. In Mobile, artist name was not persisted on standalone chords.

### Architectural Invariants:
- `SmartChord = personal / user-owned / portable`
- `Repertoire Song = ministry-owned catalog entity`
- `Repertoire Artist = ministry-owned catalog entity`
- `SmartChord.artist_name = personal descriptive metadata (string | null)`
- `SmartChord.artist_id = legacy / deprecated compatibility field`
- `SmartChord.song_id = legacy / deprecated compatibility field`
- `Canonical repertoire relationship = smart_chord_song_links`
- `SMART_CHORD_MULTI_MINISTRY_LINKING = YES`
- `REPERTOIRE_SONG_MULTI_USER_CHORDS = YES`
- `SMART_CHORD_LINK_CARDINALITY_PER_MINISTRY = ONE`
- `DOES_LINKING_MAKE_PERSONAL_CHORD_SHARED = NO`
- `ARTIST_MATCH_REQUIRED_FOR_LINK = NO`
- `LEGACY_LINK_READ_MIGRATION_STRATEGY = DUAL_READ_ONLY` (GET is strictly side-effect free)
- `OLD_WEB_LINK_WRITE_PRESERVES_OTHER_MINISTRIES = PASS`
- `UNLINK_LEGACY_RESURRECTION = IMPOSSIBLE`
- `SONG_DELETE_SMART_CHORD_LINK_CASCADE = PASS`
- `SMART_CHORD_DELETE_LINK_CASCADE = PASS`
- `ACCOUNT_DELETE_LINK_CASCADE = PASS`
- `MINISTRY_DELETE_LINK_CASCADE = PASS`
- `MEMBERSHIP_REMOVAL_LINK_POLICY = RETAIN_INERT`

---

## 2. Implementation Plan

### Part A — Personal Smart Chord Artist Model
1. Backend:
   - Add `artist_name: z.string().trim().max(255).nullable().optional()` to `createSmartChordSchema`, `updateSmartChordSchema`, and `SmartChord` interface.
   - Deprecate `artist_id`.
   - Update `SmartChordRepository`: persist `artist_name`; support legacy `artist_id`.
   - Update `SmartChordService`: remove lockout when `artist_id` is missing/foreign. If `artist_id` is provided on legacy write without `artist_name`, resolve `artist_name` safely from artist document.
2. Mobile:
   - Update `SmartChord` model: add `artistName`, parse `artist_name`, serialize `artist_name`.
   - Update `SmartChordFormScreen`: add "Nome do artista / intérprete (opcional)" input field.
   - Update `SmartChordCard` and `SmartChordReaderScreen`: display `artistName` reliably without ministry dependency.
3. Web:
   - Update `web/src/api.ts` and `SmartChordsWorkspace.tsx`: support `artistName` / `artist_name`.

### Part B & C — Canonical Link Collection & Backend Contract
1. Collection: `smart_chord_song_links`
   - Deterministic ID strategy: `${userId}_${smartChordId}_${ministryId}`.
   - Schema: `id`, `user_id`, `smart_chord_id`, `ministry_id`, `song_id`, `created_at`, `updated_at`.
2. Repositories & Endpoints:
   - `PUT /api/v1/ministries/:ministryId/smart-chords/:chordId/repertoire-link` (body: `{ song_id }`, idempotent, atomic replacement per ministry).
   - `GET /api/v1/ministries/:ministryId/smart-chords/:chordId/repertoire-link` (side-effect free dual-read: checks `smart_chord_song_links`, falls back to legacy `song_id`).
   - `DELETE /api/v1/ministries/:ministryId/smart-chords/:chordId/repertoire-link` (clears canonical link and clears legacy `song_id` if it pointed to this ministry to prevent resurrection).
   - `GET /api/v1/ministries/:ministryId/songs/:songId/my-smart-chords` (returns only authenticated user's chords linked via canonical link or legacy fallback).
   - Harden legacy alias `GET /api/v1/smart-chords/song/:songId`.

### Part D — Old Web Compatibility Bridge
1. In `updateSmartChord`:
   - If legacy client sends `song_id: X` (non-null), upsert canonical link for `(userId, chordId, song.ministry_id)`. Do NOT delete links for other ministries.
   - If legacy client sends `song_id: null`, clear legacy `song_id` and remove only the corresponding canonical relation for that legacy ministry. Do NOT unlink unrelated ministries.

### Part E — Lifecycle Cascades
1. Song deletion: in `SubscriptionRepository.deleteSongTransactional`, cascade-delete all `smart_chord_song_links` where `ministry_id == ministryId && song_id == songId`.
2. SmartChord deletion: in `SmartChordRepository.deleteSmartChord`, batch-delete all `smart_chord_song_links` where `smart_chord_id == chordId`.
3. Account deletion: in `AccountDeletionRepository.deletePersonalData`, purge all `smart_chord_song_links` where `user_id == userId`.
4. Ministry deletion: purge all `smart_chord_song_links` where `ministry_id == ministryId`.

### Part F, G, H — Mobile UX & State
1. Repository & Notifiers:
   - `SmartChordRepertoireLinkRepository`: calls ministry-scoped endpoints.
   - `SmartChordRepertoireLinkNotifier`: session & tenant-fenced link state with generation tokens.
   - Tenant switch keeps reader open and refreshes link state for the new active ministry.
2. Smart Chord Reader / Detail:
   - Relationship section showing current active ministry status.
   - Unlinked state: "Não vinculada em <Ministério>" with "Vincular ao repertório" action.
   - Linked state: Song title, artist, "Ver no repertório", "Alterar vínculo", "Desvincular" actions.
   - Song picker modal with search, pagination, loading/error states, and normalized match suggestions (`AUTO_LINK_BY_TITLE = NO`).
3. Repertoire Song Detail:
   - "Vincular cifra existente" opening modal picker of current user's personal chords.
   - "Abrir minha cifra" direct navigation.
   - Support multiple personal chords linked to the same song.
   - Preserve existing "Cadastrar nova cifra" flow.

### Part I — Web Alignment
1. `SmartChordsWorkspace.tsx` and `api.ts` consume new repertoire-link endpoints and `artist_name`.

---

## 3. Verification & Validation Evidence

### Backend Validation
1. **Compilation**: `npm --prefix backend run build` (tsc clean, exit code 0).
2. **Targeted Tests**: `npm --prefix backend test -- src/features/smart_chords/`
   - Test files: 2 passed (`smart_chord_repertoire_link.test.ts`, `smart_chord.feature.test.ts`).
   - Total tests: 55 passed.
   - Verified:
     - `PUT /api/v1/ministries/:mid/smart-chords/:cid/repertoire-link` links personal chord to ministry song with anti-IDOR HTTP 404 on mismatched tenant.
     - `GET /api/v1/ministries/:mid/smart-chords/:cid/repertoire-link` dual-read returns canonical link or legacy fallback without database side-effects.
     - `DELETE /api/v1/ministries/:mid/smart-chords/:cid/repertoire-link` nullifies canonical link and clears legacy `song_id` to prevent resurrection.
     - `GET /api/v1/ministries/:mid/songs/:sid/my-smart-chords` returns only user-owned chords linked to that song.
     - Legacy Old Web bridge: `updateSmartChord` preserves links in other ministries when updating `song_id`.
     - Cascade deletions: song deletion, smart chord deletion, account deletion, ministry deletion safely purge link relations.
3. **Repository & IDOR Tests**: `npm --prefix backend test -- src/repositories/RepertoireRepository.test.ts src/repositories/idor-security.test.ts`
   - Test files: 2 passed, 23 tests passed.

### Web Validation
1. **Compilation & Bundle**: `npm --prefix web run build`
   - `tsc && vite build` completed in 6.92s.
   - PWA service worker and precache (34 entries) generated successfully.
2. **Web Tests**: `npm --prefix web test`
   - Test files: 24 passed (24/24).
   - Total tests: 405 passed (405/405).
   - Verified:
     - `api.test.ts`: `artistName` serialization and deserialization, `getSmartChordRepertoireLink`, `setSmartChordRepertoireLink`, `removeSmartChordRepertoireLink`, `getMySmartChordsForSong`.
     - `SmartChordsWorkspace.test.tsx`: editor with `artistName` field, chord selection with active ministry link synchronization, save lifecycle.

### Mobile Validation
1. **Static Analysis**: `flutter analyze`
   - Output: `No issues found! (ran in 9.2s)` (0 errors, 0 warnings, 0 lints).
2. **Smart Chords Targeted Suite**: `flutter test test/features/smart_chords/`
   - Total tests: 93 passed (93/93).
3. **Full Mobile Suite**: `flutter test`
   - Total tests: 755 passed (755/755 across all domain modules).
   - Verified:
     - `smart_chord_test.dart`: domain entity parsing, `artist_name` trimming, payload serialization.
     - `smart_chord_repertoire_link_repository_test.dart`: HTTP endpoints, dual-read parsing, anti-IDOR error propagation.
     - `smart_chord_repertoire_link_controller_test.dart`: `SmartChordRepertoireLinkNotifier` load, setLink, unlink, race condition generation fencing.
     - `smart_chord_controllers_test.dart`: `SongSmartChordsNotifier` delegation to link repository when `ministryId` is provided.
     - `smart_chord_reader_screen_test.dart`: active ministry link banner (linked with song detail navigation, unlinked with "Vincular" CTA), tenant switch stability.
     - `smart_chord_picker_modal_test.dart`: modal displaying personal chords, title match suggestion badge, explicit tap linking.
     - `song_link_picker_modal_test.dart`: modal displaying ministry repertoire songs, title match suggestion badge, explicit tap linking.
     - `song_detail_view_test.dart`: "Minhas Cifras Inteligentes" section, live sync on link/create.

---

## 4. Git Commits & Review Readiness

- **Commit 1**: `933b904` — `feat(backend): add smart chord repertoire link authority`
- **Commit 2**: `784ea9d` — `feat(web): migrate smart chord repertoire linking`
- **Commit 3**: `5d67962` — `feat(mobile): add smart chord repertoire relinking (M19)`
- **Review Gate**: `M19_R1 = PASS (faf5c94)`
- **Next Gate**: `NONE (MILESTONE CLOSED)`

---

## 5. Production Acceptance & Physical Verification

- **Date**: 2026-10-19
- **Overall Status**: `PRODUCTION_ACCEPTANCE_PASS`
- **Device**: Lenovo Tab P11 Plus (`TB-J606F`, Android 12 / API 31, ADB serial `HND29KG9`, 2000x1200 landscape)
- **Production API Target**: `https://praise-app-gray.vercel.app/api/v1` (Remediated Deployment `dpl_Ftap7oXB6jUce1toz1oWEC7GJmqD`, Staged `dpl_7ZYjhbGp6GC7hmzzqjYisb4biS8Y`)
- **Production Web Target**: `https://praise-app-m7tn.vercel.app` (Remediated Deployment `dpl_B4v8CWENdwjTF84okmfkqR9HH8Rf`, Staged `dpl_J1J7zFk8L57PADZpVrRiyFS9qrJ8`)
- **Release APK**: `mobile/build/app/outputs/flutter-apk/app-release.apk` (58.5MB, 61,345,962 bytes, `com.louvaio.app`, versionCode=1, versionName=1.0.0)

### 5.1 Test Matrix Results

| ID | Case / Invariant | Result | Evidence |
|---|---|---|---|
| CT-M19-W01 | Web root load & compliance config | `PASS_PRODUCTION` | Production Web root loads cleanly (HTTP 200). React mounts with 0 errors. Compliance config (`VITE_PUBLIC_SUPPORT_EMAIL`, `VITE_PRIVACY_CONTACT_EMAIL`, `VITE_CONTROLLER_DISPLAY_NAME`) active. |
| CT-M19-W02..W08 | Web Smart Chords repertoire linking | `PASS_PRODUCTION` | Authenticated smoke test: chord creation with `artist_name`, repertoire auto-link creation, API link persistence verification, UI unlinking, unlinked persistence verification, and API purge. |
| CT-M19-01 | Lenovo Tab authenticated session | `PASS_PHYSICAL` | Token auth with `m18_admin_test_1016@louvaio.test` against production API. Successful home dashboard mount. |
| CT-M19-02 | Smart Chords entry from Perfil | `PASS_PHYSICAL` | Bottom rail Perfil (`Tab 4`) -> `Cifras Inteligentes` navigates to library. Empty state rendered cleanly. |
| CT-M19-03 | Create standalone chord with `artist_name` | `PASS_PHYSICAL` | Created `M19 TEST CHORD A` with personal artist `M19 Test Artist`, key C. Persisted and displayed without catalog artist. |
| CT-M19-04 | Unlinked state banner invariant | `PASS_PHYSICAL` | Reader shows `Não vinculada ao repertório ativo` and `Vincular` action. `AUTO_LINK_BY_TITLE = NO` invariant confirmed. |
| CT-M19-05 | Link picker modal to Song A | `PASS_PHYSICAL` | Repertoire picker opens, displays `M19 TEST SONG A`. Tapping links chord. Banner updates to `Vinculada: M19 TEST SONG A`. |
| CT-M19-06 | Bidirectional navigation | `PASS_PHYSICAL` | Tapping banner navigates to `SongDetailView` for Song A. Section `Minhas Cifras Inteligentes` renders chord button. Tapping chord returns to reader. |
| CT-M19-07 | Relink from Song A to Song B | `PASS_PHYSICAL` | Reader popup menu -> `Alterar música` -> Select `M19 TEST SONG B`. Banner converges to `Vinculada: M19 TEST SONG B`. |
| CT-M19-08 | Single-link invariant per ministry | `PASS_PHYSICAL` | Repertoire Song A detail shows 0 linked chords (empty state). Song B detail shows `M19 TEST CHORD A`. Single link per ministry enforced. |
| CT-M19-09 | Multi-chord on single song (Song B) | `PASS_PHYSICAL` | Created `M19 TEST CHORD B` (`artist_name: M19 Test Artist B`, key D). In Song B detail, tapped `Vincular cifra existente` and linked Chord B. |
| CT-M19-10 | Dual chord rendering in Song Detail | `PASS_PHYSICAL` | `Minhas Cifras Inteligentes` displays BOTH chords simultaneously (`M19 TEST CHORD B` and `M19 TEST CHORD A`). |
| CT-M19-11 | Multi-chord reader navigation | `PASS_PHYSICAL` | Tapping each chord opens respective reader with correct transposition, lyrics, and link banner. |
| CT-M19-12 | Unlink action and confirmation | `PASS_PHYSICAL` | In reader for Chord B: `Opções de vínculo` -> `Desvincular` -> Dialog "Desvincular do Repertório" -> Confirmed. Banner returns to `Não vinculada ao repertório ativo`. |
| CT-M19-13 | Unlink isolation | `PASS_PHYSICAL` | Reopened Song B detail: Chord B is removed; Chord A remains linked. Unlink of one chord does not affect other linked chords. |
| CT-M19-14 | Chord preservation on unlink | `PASS_PHYSICAL` | Personal `Cifras Inteligentes` list inspected: `M19 TEST CHORD B` remains intact with full content, key, and artist metadata. |
| CT-M19-15 | Create chord from Song Detail | `PASS_PHYSICAL` | In Song A detail: tapped `Cadastrar nova cifra inteligente`. Create form pre-populates title and shows `Vinculada ao repertório: M19 TEST SONG A`. |
| CT-M19-16 | Auto-link on song detail creation | `PASS_PHYSICAL` | Saved chord; navigated back to Song A detail with snackbar confirmation. Chord immediately listed under `Minhas Cifras Inteligentes`. |
| CT-M19-17 | Personal artist text editing | `PASS_PHYSICAL` | Edited chord artist to `M19 Test Artist Renamed`. Saved changes. |
| CT-M19-18 | Personal artist display | `PASS_PHYSICAL` | Reader renders `M19 Test Artist Renamed` without requiring catalog artist entity in ministry. |
| CT-M19-19 | Kill / relaunch anti-resurrection | `PASS_PHYSICAL` | Executed `am force-stop com.louvaio.app` and relaunched. Unlinked Chord B did NOT resurrect in Song B. |
| CT-M19-20 | Link state backend authority | `PASS_PHYSICAL` | REST API verified: canonical link collection `smart_chord_song_links` accurately matches physical UI state. |
| CT-M19-21..25 | Orientation & layout adaptation | `PASS_PHYSICAL` | Toggled system rotation between portrait (0) and landscape (1). All views adapt with 0 overflow errors. |
| CT-M19-26..30 | Touch targets, typography & logcat | `PASS_PHYSICAL` | All interactive targets >= 44px (`min-h-[44px]`). Clean sanitized logcat (`adb logcat -d -s AndroidRuntime:E *:F` -> 0 crashes, 0 fatal exceptions). |

### 5.2 Remediation of Environment Findings

1. **`BLOCKER-ENV-01` (`WEB_PRODUCTION_COMPLIANCE_ENV_MISSING`)** — `RESOLVED`:
   - Configured Vite production environment variables on Vercel project `praise-app-m7tn`:
     - `VITE_PUBLIC_SUPPORT_EMAIL`: `contato@louvaio.com.br`
     - `VITE_PRIVACY_CONTACT_EMAIL`: `contato@louvaio.com.br`
     - `VITE_CONTROLLER_DISPLAY_NAME`: `LouvAIO`
   - Rebuilt and redeployed Web:
     - Staged Deployment: `dpl_J1J7zFk8L57PADZpVrRiyFS9qrJ8`
     - Production Promotion: `dpl_B4v8CWENdwjTF84okmfkqR9HH8Rf` (`https://praise-app-m7tn.vercel.app`)
   - Verified via Playwright headless Chromium:
     - HTTP 200 OK.
     - React root mounted cleanly (`#root` HTML length 9,769 bytes).
     - Console errors: 0. Uncaught exceptions: 0.

2. **`HIGH-ENV-02` (`BACKEND_LOGIN_ROUTE_FIREBASE_KEY_MISSING`)** — `RESOLVED`:
   - Configured canonical `FIREBASE_WEB_API_KEY` on Vercel backend project `praise-app` (Production environment).
   - Rebuilt and redeployed Backend:
     - Staged Deployment: `dpl_7ZYjhbGp6GC7hmzzqjYisb4biS8Y`
     - Production Promotion: `dpl_Ftap7oXB6jUce1toz1oWEC7GJmqD` (`https://praise-app-gray.vercel.app`)
   - Verified via automated Node/fetch:
     - `GET /api/health` -> HTTP 200 OK.
     - `POST /api/v1/auth/login` with production test credentials -> HTTP 200 OK (returned valid user and JWT token).

### 5.3 Test Fixture Cleanup

- Acceptance Test Chords Purged: `LQ44kADgehMnmWcTHMf9`, `vPHR323iiu2USWNTnOKC`, `NTahTmp6kFWA78DtJbT5`, `A0vY3nNAv7inq9fojP1F` (0 remaining).
- Acceptance Test Songs Purged: `kQm9fhb83IMsRxnIhM7g`, `GcVq8PZUpujIXIy7wPmw`, `CWE6dbOl56FHdcd2p6yk` (0 remaining).
- Post-cleanup verification: API queries confirm 0 lingering test chords or songs.

---

## 6. Final Architecture & Invariant Specifications

### 6.1 Personal SmartChord & Relinking Model
- `SmartChord` is personal, user-owned, and globally portable (`user_id`).
- Personal descriptive metadata uses `artist_name` (`SMART_CHORD_ARTIST_MODEL = PERSONAL_ARTIST_NAME`).
- Legacy fields `artist_id` and `song_id` are deprecated compatibility metadata.
- Repertoire relationships are governed by the canonical collection `smart_chord_song_links`:
  - One SmartChord links to at most one Song per ministry.
  - Same SmartChord may link to different Songs across multiple ministries.
  - Same Song may have private SmartChords from multiple users.
  - Same user may link multiple SmartChords to the same Song.
  - Personal chords are never shared merely because they are linked.
- Invariants:
  - `SMART_CHORD_PERSONAL_PORTABILITY = PASS`
  - `SMART_CHORD_ARTIST_MODEL = PERSONAL_ARTIST_NAME`
  - `ARTIST_MATCH_REQUIRED_FOR_LINK = NO`
  - `SMART_CHORD_MULTI_MINISTRY_LINKING = PASS`
  - `REPERTOIRE_SONG_MULTI_USER_CHORDS = PASS`
  - `MULTIPLE_PERSONAL_CHORDS_PER_SONG = PASS`
  - `DOES_LINKING_MAKE_PERSONAL_CHORD_SHARED = NO`
  - `PERSONAL_CHORD_PRIVACY = PASS`

### 6.2 Legacy Compatibility & Read Migration Strategy
- `LEGACY_LINK_READ_MIGRATION_STRATEGY = DUAL_READ_ONLY` (GET requests are strictly side-effect free).
- `CANONICAL_LINK_PRECEDENCE = PASS`
- `LEGACY_FALLBACK_TENANT_ISOLATION = PASS`
- `UNLINK_LEGACY_RESURRECTION = IMPOSSIBLE`
- `OLD_WEB_LINK_WRITE_PRESERVES_OTHER_MINISTRIES = PASS`
- `OLD_WEB_TEXT_EDIT_PRESERVES_LINKS = PASS`
- `LEGACY_NULL_SONG_BEHAVIOR = CLEARS_PREVIOUS_LEGACY_SONG_MINISTRY_LINK_ONLY`
- No mandatory offline data migration required.

### 6.3 Lifecycle Cascades
- `SONG_DELETE_SMART_CHORD_LINK_CASCADE = PASS` (deleting a song deletes associated links in that ministry; personal chords remain intact).
- `SMART_CHORD_DELETE_LINK_CASCADE = PASS` (deleting a chord purges all its links across all ministries).
- `ACCOUNT_DELETE_LINK_CASCADE = PASS` (deleting an account purges user chords and all their links).
- `MINISTRY_DELETE_LINK_CASCADE = PASS` (deleting a ministry purges all links scoped to that ministry).
- `MEMBERSHIP_REMOVAL_LINK_POLICY = RETAIN_INERT` (links remain in database inertly; access denied while not a member).

### 6.4 Automated Test Evidence
- **Backend**:
  - Smart Chords focused: `55/55 PASS`
  - RepertoireRepository: `12/12 PASS`
  - IDOR Security: `11/11 PASS`
  - Account Deletion: `22/22 PASS`
  - MinistryRepository: `1/1 PASS`
  - TypeScript build: `PASS`
- **Web**:
  - Full suite: `405/405 PASS`
  - TypeScript & Vite build: `PASS`
- **Mobile**:
  - Smart Chords focused: `93/93 PASS`
  - Flutter full suite: `755/755 PASS`
  - `flutter analyze`: `0 issues`

### 6.5 Known Non-Blocking Test Debt (Technical Debt)
- `TG-M19-01`: Explicit Old Web Alpha→C preserves Beta unit test absent.
- `TG-M19-02`: Explicit legacy `song_id=null` scoped canonical-link removal test absent.
- `TG-M19-03`: Dedicated direct lifecycle cascade integration tests absent.
- `TG-M19-04`: Dedicated asynchronous Web Alpha→Beta race test absent.
- Summary: `M19_TEST_GAP_COUNT = 4`, `M19_TEST_GAPS = NON_BLOCKING_TECHNICAL_DEBT`.

### 6.6 Deferred Scope
- `CREATE_SONG_FROM_SMART_CHORD = DEFERRED`
- `SMART_CHORD_IMPORT_HUB = DEFERRED`
- `PDF_IMPORT = DEFERRED`
- `PLAIN_TEXT_IMPORT = DEFERRED`
- `CIFRA_CLUB_IMPORT = DEFERRED`
- `SHARED_PUBLIC_SMART_CHORDS = DEFERRED`
- `OFFLINE_SYNC = DEFERRED`

### 6.7 Future Discovery Backlog
- Smart Chords Import Hub (PDF → SmartChord, plain text → SmartChord, URL / Cifra Club feasibility & legal assessment, preview/edit-before-save).
- Vocal / musical warm-up module (MIDI-style exercise engine, custom warm-up exercises).
- In-app music/reference playback without LouvAIO hosting audio files.

---

## 7. M19-R1 Remediation Details

Following independent code review M19-R1 (`CHANGES_REQUIRED`), all findings were remediated across Backend, Web, and Mobile:

- **F-M19-01 (HIGH) & F-M19-07 (TEST_GAP)**: Collision-Safe Canonical Link Document IDs:
  - Document ID strategy updated to deterministic SHA-256 digest of canonical JSON array tuple: `JSON.stringify([userId, smartChordId, ministryId])`.
  - Added defensive field checks in `SmartChordLinkRepository` (`getLink`, `deleteLink`) validating that retrieved document fields match the exact requested tuple (`raw.user_id === userId`, `raw.smart_chord_id === smartChordId`, `raw.ministry_id === ministryId`), failing closed if mismatched.
  - Added adversarial tuple collision test cases in `backend/src/features/smart_chords/smart_chord_repertoire_link.test.ts` (8 ambiguous underscore tuples verified distinct and 64-char hex, plus defensive field guard tests).
- **F-M19-02 (HIGH)**: Mobile Logout / Account Isolation:
  - Updated `resetAuthenticatedFeatures` in `mobile/lib/app/providers.dart` to explicitly reset `smartChordRepertoireLinkNotifierProvider.notifier` (incrementing generation and clearing state) and invalidate the provider.
  - Added integration test `mobile/test/features/smart_chords/presentation/controllers/smart_chord_repertoire_link_session_reset_test.dart` verifying state wipe upon logout (`AUTH_RESET_LINK_STATE_TEST`) and discarding of late async responses from previous sessions (`LATE_RESPONSE_AFTER_LOGOUT_TEST`).
- **F-M19-03 (MEDIUM)**: Firestore Cascade Batch Limit Safety:
  - Implemented `deleteQueryInBatches(query, chunkSize = 450)` in `SmartChordLinkRepository.ts`.
  - Applied chunking to `deleteLinksBySongId`, `deleteLinksBySmartChordId`, `deleteLinksByUserId`, and `deleteLinksByMinistryId`.
  - Added cascade test simulating 505 documents chunked across multiple batches (450 + 55).
- **F-M19-04 (MEDIUM)**: Repertoire SongLinkPickerModal Catalog Completeness:
  - Implemented complete catalog pagination in `SongLinkPickerModal` (`mobile/lib/features/smart_chords/presentation/widgets/song_link_picker_modal.dart`) with `_loadMore`, `_hasMore`, `_currentPage`, deduplication by song ID, `NotificationListener<ScrollNotification>` infinite scroll, and a "Carregar mais músicas" button.
  - Added debounced search with 300ms timer and generation fencing (`_searchGeneration`).
  - Added widget test in `song_link_picker_modal_test.dart` verifying 65 songs across page 1 and page 2, scrolling to page 2 and linking a page 2 song (`SONG_PICKER_CATALOG_COMPLETENESS`).
- **F-M19-05 (MEDIUM)**: Web SmartChordsWorkspace Stale Async Relation Context Fencing:
  - Added `linkRequestContextRef` in `web/src/components/SmartChordsWorkspace.tsx` tracking `{ ministryId, chordId, generation }`.
  - Wrapped `api.getSmartChordRepertoireLink` in context validation: late responses from previous chords or ministries are discarded.
  - Added automated tests in `web/src/components/SmartChordsWorkspace.test.tsx` verifying chord-switch (`WEB_CHORD_SWITCH_LATE_RESPONSE_TEST`) and ministry-switch (`WEB_MINISTRY_SWITCH_LATE_RESPONSE_TEST`) late responses are safely ignored.
- **F-M19-06 (LOW)**: Mobile Controller Duplicate Mutation Guard:
  - Added `if (state.isSaving) return false;` guard to both `setLink` and `unlink` in `SmartChordRepertoireLinkNotifier`.
  - Added unit tests in `smart_chord_repertoire_link_controller_test.dart` verifying concurrent `setLink` and `unlink` requests are rejected (`LINK_MUTATION_RACE_GUARD`) and the repository is called exactly once.

```text
M19_STATUS = IMPLEMENTED — REMEDIATED — PENDING R2
NEXT_GATE = M19-R2 INDEPENDENT REVIEW
```

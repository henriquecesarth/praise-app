# ExecPlan: M14 — Native Smart Chords

- **Status**: ACTIVE / IN PROGRESS
- **Branch**: `feat/mobile-m14` (Base SHA: `3ea53a822e3fe8da522f189f7cee74cb12451b8c`)
- **Scope**: Native mobile Smart Chords experience (M14A library & viewer + M14B chord parsing, rendering & transposition + M14C create/edit/delete CRUD), backend security & consistency hardening, repertoire integration, tablet & phone UX.
- **Reference**: AGENTS.md, MEMORY.md, docs/system-status.md, docs/mobile/architecture.md, web/src/utils/smart_chord.ts

---

## 1. Problem Statement & Architecture Goals

Smart Chords (Cifras Inteligentes) allow worship leaders and musicians to create, view, and transpose chord sheets with inline bracket chord markers (`[C]Amazing [G]grace`).
While LouvAIO has Smart Chords in backend and web (`SmartChordsWorkspace.tsx`), the native Flutter mobile client currently lacks Smart Chord capabilities.
Furthermore, the backend audit identifies areas for hardening:
1. **User Ownership vs Ministry Boundary**: Smart Chords are owned by the authenticated `user_id` globally across ministries. They are personal data.
2. **Song/Artist Relation Consistency**: When linking both a song and an artist from repertoire, they must belong to the same ministry, and the artist must match the song's existing artist if specified.
3. **Pagination & Query Bounds**: `GET /smart-chords` previously returned all items while reporting pagination metadata; it must return the actual paginated slice with safe limits (1..100) and page bounds (`page >= 1`).
4. **DTO Allowlisting & Immutability**: Create/update must strictly accept canonical fields (`title`, `original_key`, `content`, `song_id`, `artist_id`) and reject/strip client-supplied authority fields (`id`, `user_id`, `created_at`, `updated_at`).
5. **Removed-Membership Semantics**: A user removed from a ministry retains their personal Smart Chords, but cannot link songs or artists from that ministry, and foreign-ministry repertoire data is not leaked.
6. **Native Pure Dart Rendering & Transposition**: Port `web/src/utils/smart_chord.ts` to pure Dart with full test coverage for root notes, accidentals, flats/sharps, extensions, slash chords, and -11..+11 semitone transposition.

---

## 2. Architectural Decisions

1. **User Scope vs Ministry Scope**:
   - Smart Chords are personal to the authenticated user (`user_id`). The main Smart Chord library displays all user-owned chords regardless of active ministry.
   - When opened from a repertoire song context (`GET /smart-chords/song/:songId`), chords are filtered to that specific song.
   - When resolving linked song/artist metadata for display, it resolves against the current active ministry's repertoire; if the linked song belongs to another ministry, it gracefully displays without leaking foreign repertoire data.
   - Unlinked Smart Chords (`song_id: null`, `artist_id: null`) are first-class personal documents.
2. **Navigation**:
   - Primary destination: "Cifras Inteligentes" tile under Perfil Actions in `AppShell` (key: `profile_smart_chords_tile`).
   - Contextual destination: Deep-link action button in `SongDetailView` to view or create Smart Chords linked to that song.
3. **Transposition**:
   - Transposition is purely visual/display state (temporary adjustment by semitones in `-11..+11`). It never silently mutates persisted `original_key` or `content`.
4. **Auto-Create Repertoire Song**:
   - Explicitly deferred (`SMART_CHORD_AUTO_CREATE_SONG = DEFERRED`). Creation of songs requires ministry admin permissions and quota checks which belong to repertoire administration.
5. **Firestore Pagination Cursor Tech Debt**:
   - Explicitly deferred (`SMART_CHORD_FIRESTORE_CURSOR_PAGINATION = DEFERRED_TECH_DEBT`). The current backend endpoint correctly validates page/limit bounds and slices the returned array to fulfill the API contract. True Firestore query cursor pagination for personal Smart Chords is deferred to maintain architectural stability outside M14 scope.
6. **Tenant & Session Isolation**:
   - Switching ministry resets in-flight repertoire song/artist relation searches and closes/invalidates the relation picker.
   - User logout / switch (User A -> User B) completely resets all Smart Chord lists, detail states, form controllers, and cached drafts.

---

## 3. Work Packages

- [x] **WP1: Backend Smart Chord Hardening & Security Tests**
  - Tighten query schema (`smartChordsQuerySchema`) with `page >= 1` and clamped `limit <= 100`.
  - Slice `data` array in `SmartChordService.getSmartChords` to match pagination parameters.
  - Enforce song and artist ministry consistency and matching in `validateSongAndArtistAccess`.
  - Enforce explicit DTO allowlist in `updateSmartChord`.
  - Vitest backend suite: 24/24 PASS (commit `98d9ff4`).

- [x] **WP2: Mobile Domain & Parser/Transposition Engine**
  - `mobile/lib/features/smart_chords/domain/`:
    - `smart_chord.dart`: `SmartChord` entity, JSON serialization, copyWith, request payload.
    - `smart_chord_parser.dart`: Pure Dart parser porting `web/src/utils/smart_chord.ts`:
      - `parse`: Brackets to segments.
      - `transposeChord` & `transposeNote`: Semitone transposition with flat mapping and slash chord support.
      - `transposeKey`: Key transposition with minor suffixes.
      - `renderLine`: Formats aligned chord line + lyrics line with monospace positioning.
      - `rawToVisual` / `visualToRaw`: Bidirectional bracket conversion.
      - `getHarmonicFieldChords` & `getSuggestions`: Real-time chord helpers.
  - Unit tests: `test/features/smart_chords/domain/` (26/26 PASS).

- [x] **WP3: Mobile Data Repository & HTTP Transport**
  - `mobile/lib/features/smart_chords/data/`:
    - `smart_chord_repository.dart`: Abstract interface & `HttpSmartChordRepository` via Dio.
    - Full error mapping to `AppFailure`.
  - Unit tests: `test/features/smart_chords/data/` (8/8 PASS).

- [x] **WP4: Mobile Presentation State & Controllers**
  - `mobile/lib/features/smart_chords/presentation/controllers/`:
    - `smart_chord_list_controller.dart`: List, search, in-memory updates.
    - `song_smart_chords_controller.dart`: song-linked chords.
    - `smart_chord_detail_controller.dart`: Detail, transposition controls (-11..+11).
    - `smart_chord_form_controller.dart`: Create, edit, delete, double-submit protection.
    - `smart_chord_providers.dart`: Registered in `resetAuthenticatedFeatures` in `app/providers.dart`.
  - Unit tests: `test/features/smart_chords/presentation/controllers/` (14/14 PASS).

- [x] **WP5: Mobile UI & Repertoire Integration (M14A, M14B, M14C)**
  - `SmartChordsScreen`: Library list with search, loading, empty, error/retry, pull-to-refresh.
  - `SmartChordReaderScreen`: Reading sheet, transposition controls, phone/tablet typography, edit & delete flows.
  - `SmartChordFormScreen`: Editor with raw syntax + live preview toggle, key selector, quick harmonic field bar.
  - Repertoire deep-link: "Cifras Inteligentes" section in `SongDetailView`.
  - Profile entry tile in `AppShell` (key: `profile_smart_chords_tile`).
  - Unit tests: `test/features/smart_chords/presentation/views/` (7/7 PASS).

- [x] **WP6: Automated Verification & Gates (Initial)**
  - Backend build: `npm --prefix backend run build` (PASS).
  - Backend focused tests: `npm --prefix backend test -- src/features/smart_chords/` (24/24 PASS).
  - Web build: `npm --prefix web run build` (PASS).
  - Web tests: `npm --prefix web test` (400/400 PASS).
  - Flutter analyze: `flutter analyze` (0 issues found, clean).
  - Flutter focused tests: `flutter test test/features/smart_chords/` (55/55 PASS).
  - Flutter full test suite: `flutter test` (577/577 PASS).

---

## 4. Remediation M14-R2: Session Privacy, Mutation Fencing & Validation Hardening

- [x] **R2-1 & R2-10: Form Session Privacy**
  - Observed `AuthState` changes in `SmartChordFormScreen` via `ref.listen<AuthState>`.
  - On unauthenticated or user change (`next.user?.id != _boundUserId`), immediately dismisses route (`Navigator.pop()`) and clears `TextEditingController` draft contents to eliminate User-A data leakage into User B.
- [x] **R2-2 & R2-10: Reader Session Privacy**
  - Observed `AuthState` changes in `SmartChordReaderScreen`.
  - On logout or user change, immediately dismisses the reader route, preventing unauthorized inspection of User-A content.
- [x] **R2-3 & R2-11: Tenant-Linked Form Auto-Dismissal**
  - In `SmartChordFormScreen`, checked whether a ministry relation is present (`_songId != null || _artistId != null`).
  - If linked to active ministry and active ministry changes (Alpha -> Beta), immediately closes the form route to prevent cross-tenant submission of stale repertoire links.
  - For unlinked/global personal Smart Chords, the form remains open across ministry switches.
- [x] **R2-4: Global Reader Preservation**
  - Confirmed `SmartChordReaderScreen` does not close merely upon ministry change; personal chords remain readable regardless of active ministry.
- [x] **R2-5 through R2-8: Typed Mutation Fencing & UI Outcome Handling**
  - Implemented `MutationOutcome` (`success`, `failure`, `discarded`) and `MutationResult<T>`.
  - `SmartChordFormNotifier` captures generation token and bound user ID before starting create, update, or delete.
  - After await, verifies whether generation or session changed. If stale, silently returns `MutationResult.discarded()` without touching `errorMessage` or `isSuccess`.
  - In `SmartChordFormScreen` and `SmartChordReaderScreen`, `discarded` produces NO SnackBar, NO navigation pop, and NO state eviction in User B's context.
- [x] **R2-9: Asynchronous Session Reset Tests with Pending Completers**
  - Added 6 asynchronous tests in `smart_chord_controllers_test.dart` verifying create, update, and delete (both success and failure) when reset occurs while operation is in flight.
- [x] **R2-12 & R2-13: Validation Hardening of IDs and Route Params**
  - Added `singleDocumentIdSchema` (`/^[A-Za-z0-9_-]{1,100}$/`) in `smart_chord.types.ts`.
  - Enforced single-segment validation for `song_id`, `artist_id`, and route params `/:id` and `/song/:songId`.
  - In `SmartChordController.handleError`, mapped `ZodError` to HTTP 400 `AppError('Dados inválidos.')`.
- [x] **R2-14: Backend Validation Test Suite**
  - Added Section 13 in `smart_chord.feature.test.ts` with 7 tests covering valid IDs, path-like segments (`foo/bar`, `/foo`, `foo/`, `a\b`), whitespace, control characters, max length, and repo isolation. Total backend tests: 31/31 PASS.
- [x] **R2-15 & R2-16: Search Debounce & Server-Side Filtering**
  - Added 300ms `Timer` debounce in `SmartChordsScreen` for typing.
  - Immediate clearing via clear icon cancels debounce timer and triggers immediate search reset.
  - Maintained full server-side search (`GET /smart-chords?search=<query>`).
- [x] **R2-17 & R2-18: Documentation & Deferred Tech Debt**
  - Marked `SMART_CHORD_FIRESTORE_CURSOR_PAGINATION = DEFERRED_TECH_DEBT` in ExecPlan.
  - Corrected endpoint route reference to `GET /smart-chords/song/:songId`.

---

## 5. Final Verification & Quality Gates

- Backend build: `npm --prefix backend run build` (PASS).
- Backend tests: `npm --prefix backend test -- src/features/smart_chords/` (31/31 PASS).
- Web build: `npm --prefix web run build` (PASS).
- Web tests: `npm --prefix web test` (400/400 PASS).
- Flutter analyze: `flutter analyze` (0 issues found, clean).
- Flutter focused tests: `flutter test test/features/smart_chords/` (74/74 PASS).
- Flutter full test suite: `flutter test` (596/596 PASS).

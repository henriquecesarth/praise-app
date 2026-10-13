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
   - When opened from a repertoire song context (`/song/:songId`), chords are filtered to that specific song.
   - When resolving linked song/artist metadata for display, it resolves against the current active ministry's repertoire; if the linked song belongs to another ministry, it gracefully displays without leaking foreign repertoire data.
   - Unlinked Smart Chords (`song_id: null`, `artist_id: null`) are first-class personal documents.
2. **Navigation**:
   - Primary destination: "Cifras Inteligentes" tile under Perfil Actions in `AppShell` (key: `profile_smart_chords_tile`).
   - Contextual destination: Deep-link action button in `SongDetailView` to view or create Smart Chords linked to that song.
3. **Transposition**:
   - Transposition is purely visual/display state (temporary adjustment by semitones in `-11..+11`). It never silently mutates persisted `original_key` or `content`.
4. **Auto-Create Repertoire Song**:
   - Explicitly deferred (`SMART_CHORD_AUTO_CREATE_SONG = DEFERRED`). Creation of songs requires ministry admin permissions and quota checks which belong to repertoire administration.
5. **Tenant & Session Isolation**:
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

- [x] **WP6: Automated Verification & Gates**
  - Backend build: `npm --prefix backend run build` (PASS).
  - Backend focused tests: `npm --prefix backend test -- src/features/smart_chords/` (24/24 PASS).
  - Web build: `npm --prefix web run build` (PASS).
  - Web tests: `npm --prefix web test` (400/400 PASS).
  - Flutter analyze: `flutter analyze` (0 issues found, clean).
  - Flutter focused tests: `flutter test test/features/smart_chords/` (55/55 PASS).
  - Flutter full test suite: `flutter test` (577/577 PASS).

# ExecPlan: M19 — Smart Chords ↔ Repertoire Relinking

- **Lifecycle**: ACTIVE
- **Status**: IMPLEMENTED_READY_FOR_REVIEW
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
- **Next Gate**: `CODE_READY_FOR_M19_INDEPENDENT_REVIEW`


# ExecPlan: M19 — Smart Chords ↔ Repertoire Relinking

- **Lifecycle**: COMPLETED
- **Status**: COMPLETED
- **Milestone**: M19
- **Scope**: Smart Chords ↔ Repertoire Relinking
- **Base SHA**: `da92ef246a9a5257afc5a1ab4a14f43444239fd0`
- **Canonical Implementation HEAD**: `e858ff44fce6eef313e5159da386e4a0c7648755`
- **Branch**: `feat/mobile-m19`
- **Review R1**: `CHANGES_REQUIRED` (F-M19-01 through F-M19-07)
- **Review R2**: `PASS` (BLOCKER = 0, HIGH = 0, MEDIUM = 0, LOW = 0, TEST_GAP = 0)
- **Controlled Deployment**: `SUCCESS`
- **Physical Acceptance**: `PASS`
- **Final Verdict**: `M19 = CLOSED`
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
- `SmartChord = personal / user-owned / portable across ministries`
- `Canonical personal metadata: title, artist_name, original_key, content`
- `Repertoire Song = ministry-owned catalog entity`
- `Repertoire Artist = ministry-owned catalog entity`
- `SmartChord.artist_name = personal descriptive metadata (string | null)` (NOT a tenant foreign key; legacy `artist_id` must never lock user out if the old artist was deleted, belongs to another ministry, or belongs to a ministry the user left)
- `SmartChord.artist_id = legacy / deprecated compatibility field`
- `SmartChord.song_id = legacy / deprecated compatibility field`
- `Canonical repertoire relationship = smart_chord_song_links`
- `smart_chord_song_links Document ID Strategy = SHA256(JSON.stringify([userId, smartChordId, ministryId]))` (collision-safe deterministic JSON tuple)
- `SMART_CHORD_MULTI_MINISTRY_LINKING = YES`
- `REPERTOIRE_SONG_MULTI_USER_CHORDS = YES`
- `SMART_CHORD_LINK_CARDINALITY_PER_MINISTRY = ONE` (one SmartChord → at most one Song per ministry; same SmartChord may link to different Songs in different ministries; same Song may have private SmartChords from multiple users; same user may link multiple own SmartChords to same Song)
- `DOES_LINKING_MAKE_PERSONAL_CHORD_SHARED = NO` (linking a personal SmartChord to a ministry Repertoire Song does NOT grant read, edit, list, or open access to other members, leaders, or admins; each user's SmartChords remain private)
- `ARTIST_MATCH_REQUIRED_FOR_LINK = NO`
- `LEGACY_LINK_READ_MIGRATION_STRATEGY = DUAL_READ_ONLY` (GET is strictly side-effect free; canonical relation is primary authority; legacy fallback only)
- `OLD_WEB_LINK_WRITE_PRESERVES_OTHER_MINISTRIES = PASS`
- `UNLINK_LEGACY_RESURRECTION = IMPOSSIBLE`
- `SONG_DELETE_SMART_CHORD_LINK_CASCADE = PASS`
- `SMART_CHORD_DELETE_LINK_CASCADE = PASS`
- `ACCOUNT_DELETE_LINK_CASCADE = PASS`
- `MINISTRY_DELETE_LINK_CASCADE = PASS`
- `MEMBERSHIP_REMOVAL_LINK_POLICY = RETAIN_INERT`
- `IMPORT_HUB_ARCHITECTURE_READY = YES` (future importer can produce `SmartChordDraft { title, artist_name, original_key, content }` and reuse canonical link model)

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
2. **Targeted Tests**:
   - Smart Chords focused: 2 files, 59 passed (`smart_chord_repertoire_link.test.ts`, `smart_chord.feature.test.ts`).
   - Security / IDOR: 2 files, 23 passed (`RepertoireRepository.test.ts`, `idor-security.test.ts`).
   - Account deletion lifecycle: 2 files, 36 passed (`account-deletion.feature.test.ts`, `account-deletion-orchestrator.test.ts`).
3. **Capabilities Verified**:
   - `PUT /api/v1/ministries/:mid/smart-chords/:cid/repertoire-link` links personal chord to ministry song with anti-IDOR HTTP 404 on mismatched tenant.
   - `GET /api/v1/ministries/:mid/smart-chords/:cid/repertoire-link` dual-read returns canonical link or legacy fallback without database side-effects.
   - `DELETE /api/v1/ministries/:mid/smart-chords/:cid/repertoire-link` nullifies canonical link and clears legacy `song_id` to prevent resurrection.
   - `GET /api/v1/ministries/:mid/songs/:sid/my-smart-chords` returns only authenticated user's chords linked to that song.
   - Legacy Old Web bridge: `updateSmartChord` preserves links in other ministries when updating `song_id`.
   - Cascade deletions: song deletion, smart chord deletion, account deletion, ministry deletion safely purge link relations.
   - Deterministic SHA-256 JSON tuple document IDs with defensive 3-field validation.
   - Batch chunking with safety threshold `<= 450` operations per Firestore batch.

### Web Validation
1. **Compilation & Bundle**: `npm --prefix web run build` (`tsc && vite build` clean, exit code 0).
2. **Web Suite**: `npm --prefix web test`
   - Test files: 24 passed (24/24).
   - Total tests: 407 passed (407/407).
3. **Capabilities Verified**:
   - `api.test.ts`: `artistName` serialization and deserialization, `getSmartChordRepertoireLink`, `setSmartChordRepertoireLink`, `removeSmartChordRepertoireLink`, `getMySmartChordsForSong`.
   - `SmartChordsWorkspace.test.tsx`: editor with `artistName` field, chord selection with active ministry link synchronization, save lifecycle.
   - Context fencing (`linkRequestContextRef`): stale async responses across chord-switch and ministry-switch discarded safely.

### Mobile Validation
1. **Static Analysis**: `flutter analyze`
   - Output: `No issues found!` (0 errors, 0 warnings, 0 lints).
2. **Smart Chords Targeted Suite**: `flutter test test/features/smart_chords/`
   - Total tests: 98 passed (98/98).
3. **Full Mobile Suite**: `flutter test`
   - Total tests: 760 passed (760/760).
4. **Capabilities Verified**:
   - `smart_chord_test.dart`: domain entity parsing, `artist_name` trimming, payload serialization.
   - `smart_chord_repertoire_link_repository_test.dart`: HTTP endpoints, dual-read parsing, anti-IDOR error propagation.
   - `smart_chord_repertoire_link_controller_test.dart`: `SmartChordRepertoireLinkNotifier` load, setLink, unlink, race condition generation fencing, duplicate mutation guard.
   - `smart_chord_repertoire_link_session_reset_test.dart`: logout/account switch link state wipe and late response discarding.
   - `song_link_picker_modal_test.dart`: complete catalog pagination, infinite scroll, deduplication, search debounce, explicit tap linking.
   - `smart_chord_picker_modal_test.dart`: modal displaying personal chords, title match suggestion badge, explicit tap linking.
   - `smart_chord_reader_screen_test.dart`: active ministry link banner (linked with song detail navigation, unlinked with "Vincular" CTA), tenant switch stability.
   - `song_detail_view_test.dart`: "Minhas Cifras Inteligentes" section, live sync on link/create.

---

## 4. Git Commits & Review History

### Feature Implementation Commits
- **Commit 1 (Backend)**: `933b904` — `feat(backend): add smart chord repertoire link authority`
- **Commit 2 (Web)**: `784ea9d` — `feat(web): migrate smart chord repertoire linking`
- **Commit 3 (Mobile)**: `5d67962` — `feat(mobile): add smart chord repertoire relinking (M19)`

### Review R1 & Remediation Commits
- **Review R1**: `faf5c94` — `M19_R1 = CHANGES_REQUIRED` (Findings F-M19-01 through F-M19-07)
- **Remediation Backend**: `15f7761` — `fix(backend): deterministic sha256 link document ids, defensive validation and batch chunking (M19-R1)`
- **Remediation Web**: `8f54364` — `fix(web): fence stale async repertoire link responses on chord and ministry switches (M19-R1)`
- **Remediation Mobile**: `3c01d0f` — `fix(mobile): session reset isolation, duplicate mutation guard and catalog pagination (M19-R1)`
- **ExecPlan Reopen**: `e858ff4` — `docs(m19): reopen ExecPlan to active and record R1 remediation details`

### Canonical Implementation HEAD
```text
HEAD = e858ff44fce6eef313e5159da386e4a0c7648755
```

### Review R2 Status
```text
M19_R2 = PASS
BLOCKER = 0
HIGH = 0
MEDIUM = 0
LOW = 0
TEST_GAP = 0
```

---

## 5. Deployment Evidence & Production Physical Acceptance

### 5.1 Deployment Evidence

#### Backend Production Deployment
- **Platform**: Vercel
- **Deployment ID**: `dpl_A7PmKqRoi569AjEqmL8JMpNXpPvX`
- **Production URL**: `https://praise-app-gray.vercel.app/api/v1`
- **Health Check**: `PASS` (`GET /api/health` -> HTTP 200 OK)
- **Authentication Boundary**: `PASS` (`POST /api/v1/auth/login` verified)
- **M19 Authentication Boundary**: `PASS` (`PUT/GET/DELETE /api/v1/ministries/:mid/smart-chords/:cid/repertoire-link`)

#### Web Production Deployment
- **Platform**: Vercel
- **Deployment ID**: `dpl_3pyDtemDtKbmPrM2XvUV5mjyBwQZ`
- **Production URL**: `https://praise-app-m7tn.vercel.app`
- **Public Smoke**: `PASS` (HTTP 200, clean `#root` mount)
- **Auth Smoke**: `PASS` (login, routing, navigation)
- **Runtime Fatal Errors**: `0`

#### Infrastructure Requirements
- **Firestore Composite Indexes**: `NONE` (`COMPOSITE_INDEX_REQUIRED = NO`)
- **Firestore Rule Changes**: `NONE` (`FIRESTORE_RULE_CHANGE = NO`)
- **Offline Data Migration**: `NONE` (`OFFLINE_DATA_MIGRATION_REQUIRED = NO`)

### 5.2 Physical Acceptance Hardware & Build Details
- **Device**: Lenovo Tab P11 Plus (`TB-J616F`, Android 12 / API 31, ADB serial `HND29KG9`, landscape & portrait)
- **Production APK**:
  - `APP_ENV = production`
  - `API = https://praise-app-gray.vercel.app/api/v1`
  - `ADB_REVERSE = NONE`
- **Release Signer**:
  - SHA256: `4E:5B:70:85:7C:B9:9D:8F:52:2E:C6:B7:B7:3B:64:1C:62:54:F8:8A:AA:E5:0A:09:49:52:25:A8:83:45:A8:C1`

### 5.3 Physical Acceptance Results

| Test / Invariant | Status | Result Detail |
|---|---|---|
| `STANDALONE_SMART_CHORD` | `PASS` | Standalone chord created and usable without catalog entity. |
| `ARTIST_NAME_PERSISTENCE` | `PASS` | `artist_name` persisted and rendered as personal metadata. |
| `PERSONAL_EDIT_PORTABILITY` | `PASS` | Chord editable independently of ministry song or artist existence. |
| `AUTO_LINK_BY_TITLE` | `NO` | Chords are never silently or automatically linked by title match. |
| `LINK` | `PASS` | Modal picker links personal chord to ministry repertoire song. |
| `LINK_PERSISTENCE` | `PASS` | Link persists across app reloads and API queries. |
| `SMART_CHORD_TO_SONG_NAV` | `PASS` | Reader banner navigates directly to linked `SongDetailView`. |
| `SONG_TO_SMART_CHORD_NAV` | `PASS` | Song detail section navigates directly to user's linked chord reader. |
| `PERSONAL_CHORD_PICKER` | `PASS` | Song detail opens picker of user's chords for linking. |
| `PRIVATE_CHORD_FILTER` | `PASS` | Only user's own private chords appear in picker; other users' chords hidden. |
| `RELINK` | `PASS` | Relinking to a different song atomic replaces relation for active ministry. |
| `MULTI_MINISTRY_CONTEXT_ISOLATION` | `PASS` | Switching ministries updates link state strictly to new ministry's song. |
| `MULTI_MINISTRY_RELATION_INDEPENDENCE`| `PASS` | Link in Ministry Alpha does not affect link in Ministry Beta. |
| `UNLINK` | `PASS` | Unlink removes relation cleanly; chord remains intact. |
| `UNLINK_LEGACY_RESURRECTION` | `IMPOSSIBLE`| Unlink clears legacy `song_id` preventing resurrection on reload. |
| `MULTIPLE_OWN_CHORDS_PER_SONG` | `PASS` | User can link multiple personal chords to the same repertoire song. |
| `DOES_LINKING_MAKE_PERSONAL_CHORD_SHARED` | `NO` | Linking never exposes chord content to other members, leaders, or admins. |
| `LOGOUT_LINK_STATE_RESET` | `PASS` | Logout wipes link notifier state immediately. |
| `CROSS_ACCOUNT_VISIBLE_STATE` | `NONE` | New account session never sees previous account's link state. |
| `PORTRAIT_UI` | `PASS` | Clean adaptive rendering in portrait orientation. |
| `LANDSCAPE_UI` | `PASS` | Clean adaptive rendering in landscape orientation. |
| `TOUCH_TARGETS` | `PASS` | All interactive targets meet minimum 44px threshold. |
| `LOGCAT_FATAL_COUNT` | `0` | Zero fatal exceptions or runtime crashes in adb logcat. |

---

## 6. Final Architecture & Invariant Specifications

### 6.1 Backend Final Invariants
```text
SMART_CHORD_LINK_DOCUMENT_ID_STRATEGY = SHA256_CANONICAL_JSON_TUPLE
LINK_DOCUMENT_ID_COLLISION_SAFE = PASS
DEFENSIVE_TUPLE_VALIDATION = PASS
LINK_CASCADE_BATCH_SIZE = 450
LINK_CASCADE_BATCH_SAFETY = PASS
COMPOSITE_INDEX_REQUIRED = NO
FIRESTORE_INDEX_CHANGE = NO
FIRESTORE_RULE_CHANGE = NO
OFFLINE_DATA_MIGRATION_REQUIRED = NO
```

### 6.2 Mobile Final Invariants
```text
MOBILE_TENANT_STALE_RESPONSE_FENCING = PASS
MOBILE_ACCOUNT_STALE_RESPONSE_FENCING = PASS
SMART_CHORD_LINK_CROSS_ACCOUNT_LEAK = NONE
POST_SUCCESS_CONVERGENCE = PASS
LINK_DUPLICATE_SUBMIT_GUARD = PASS
SONG_PICKER_COMPLETE_DATASET = PASS
AUTO_LINK_BY_TITLE = NO
```

### 6.3 Web Final Invariants
```text
WEB_CANONICAL_LINK_MODEL = PASS
WEB_MULTI_MINISTRY_STATE = PASS
WEB_PERSONAL_EDIT_PRESERVES_LINKS = PASS
WEB_LINK_REQUEST_STALE_FENCING = PASS
```

### 6.4 Privacy & Tenant Invariant
```text
DOES_LINKING_MAKE_PERSONAL_CHORD_SHARED = NO
```
Linking a personal SmartChord to a ministry Repertoire Song does NOT grant `read`, `edit`, `list`, or `open` access to other members, leaders, or admins. Each user's SmartChords remain strictly private.

### 6.5 Import Hub Readiness
```text
IMPORT_HUB_ARCHITECTURE_READY = YES
```
M19 does NOT implement Import Hub. However, the architecture is ready: a future importer can produce:
```typescript
interface SmartChordDraft {
  title: string;
  artist_name?: string | null;
  original_key: string;
  content: string;
}
```
and then seamlessly leverage the canonical `smart_chord_song_links` relinking architecture.

### 6.6 Deferred Work
```text
CREATE_SONG_FROM_SMART_CHORD = DEFERRED
PDF_IMPORT = DEFERRED
PLAIN_TEXT_IMPORT = DEFERRED
CIFRA_CLUB_IMPORT = DEFERRED
VOCAL_WARMUP_MODULE = FUTURE_DISCOVERY
SHARED_SMART_CHORDS = DEFERRED
OFFLINE_SYNC = DEFERRED
```

---

## 7. Review R1 Remediation & Review R2 Closure

### Remediation of R1 Findings
- **F-M19-01 (HIGH) — Deterministic relation ID collision**: FIXED. Replaced underscore string concatenation with SHA-256 digest of canonical JSON array tuple `JSON.stringify([userId, smartChordId, ministryId])`.
- **F-M19-02 (HIGH) — Mobile logout/account state isolation**: FIXED. `resetAuthenticatedFeatures` in `providers.dart` resets generation and clears state of `smartChordRepertoireLinkNotifierProvider`.
- **F-M19-03 (MEDIUM) — Firestore >500 cascade batch safety**: FIXED. Implemented `deleteQueryInBatches` with chunk size of 450 operations, safely below the Firestore limit of 500.
- **F-M19-04 (MEDIUM) — Song picker incomplete pagination**: FIXED. Implemented full pagination, scroll listener, and load-more mechanism in `SongLinkPickerModal`.
- **F-M19-05 (MEDIUM) — Web stale async relation response**: FIXED. Added `linkRequestContextRef` in `SmartChordsWorkspace.tsx` to fence async link requests against chord and ministry switching.
- **F-M19-06 (LOW) — Duplicate mobile mutation guard**: FIXED. Added `if (state.isSaving) return false;` to `setLink` and `unlink` in `SmartChordRepertoireLinkNotifier`.
- **F-M19-07 (TEST_GAP) — Collision/adversarial coverage**: FIXED. Added adversarial tuple collision and defensive field validation tests in backend suite.

### Final Review R2 Verdict
```text
BLOCKER = 0
HIGH = 0
MEDIUM = 0
LOW = 0
TEST_GAP = 0
M19_R2 = PASS
```

---

## 8. Next Product Direction

Milestone M19 completion unblocks future discovery around:
```text
Smart Chords Import Hub
```
Candidate future inputs already identified:
- Cifra Club shared URL
- Android Share Intent
- Text-based PDF chord sheets
- Plain-text chord sheets

Note: PDF scans / OCR remain a later concern. Implementation of Import Hub will be initiated in a subsequent milestone.

---

## 9. Final Milestone Closure Gate

```text
M19_STATUS = COMPLETED
M19_LIFECYCLE = CLOSED
M19_OVERALL = PASS
CANONICAL_IMPLEMENTATION_HEAD = e858ff44fce6eef313e5159da386e4a0c7648755
```

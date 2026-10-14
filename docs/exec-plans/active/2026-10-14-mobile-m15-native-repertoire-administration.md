# ExecPlan: M15 — Native Repertoire Administration

- **Status**: ACTIVE / REMEDIATION (M15-R2 Complete, Ready for Final Review)
- **Branch**: `feat/mobile-m15` (Base SHA: `58c4240e5f0b249cbe3268d4f0e209a7019857a1`)
- **Scope**: Native mobile Repertoire Administration (Song authoring: create, edit, delete; Artist selection and quick-create; Classification selection; Repertoire FAB & SongDetail admin controls; multi-tenant and session fencing; quota & restricted state handling; tablet and phone UX).
- **Reference**: AGENTS.md, MEMORY.md, docs/system-status.md, docs/mobile/architecture.md, backend/src/features/repertoire/, web/src/components/CreateSongModal.tsx

---

## 1. Problem Statement & Architecture Goals

LouvAIO Mobile currently provides member-facing, read-only Repertoire browsing (M6). Ministry administrators and worship leaders have no native mechanism to create new songs, edit existing song metadata (key, BPM, duration, lyrics, external links), delete deprecated songs, or associate artists and classifications.
Furthermore:
1. **Repertoire Is Core**: Repertoire is one of the three foundational modules alongside Schedules and Members. While Schedules (M11) and Members (M12A) have full native administrative CRUD, Repertoire remains read-only.
2. **Smart Chord Linkage**: M14 implemented Native Smart Chords, but deferred `SMART_CHORD_AUTO_CREATE_SONG` because song creation was absent natively. M15 provides the necessary repertoire authoring foundation.
3. **Backend Multi-Tenant Hardening**: Backend audit reveals that while `createSong` and `updateSong` validate `artist_id` and `classification_id` against the ministry, foreign IDs currently fail soft by setting object snapshot to null while preserving foreign IDs in the document. M15 hardens this to fail closed (HTTP 404), preventing cross-tenant foreign reference leakage.
4. **Authoritative State Convergence**: Post-mutation responses must immediately update local and cached state, invalidate lists, and reconcile with the authoritative server response without optimistic drift.

---

## 2. Architectural Decisions & Product Boundaries

1. **Included in M15**:
   - Create song (title, artist, classification, musical key, BPM, duration, lyrics, YouTube URL, Audio URL, Chord Sheet URL, external links).
   - Edit song with authoritative pre-population.
   - Delete song with explicit destructive confirmation dialog and list/search eviction.
   - Existing artist picker with search/selection.
   - Quick-create new artist inline within song form (independent mutation semantics).
   - Existing classification selector (chips/picker).
   - Repertoire FAB (`Nova música`) visible strictly to ministry admins.
   - SongDetail administrative actions (Editar, Excluir) visible strictly to ministry admins.
   - Quota enforcement handling (HTTP 403 / PLAN_SONG_QUOTA_REACHED / SUBSCRIPTION_RESTRICTED).
   - Unsaved changes guard (PopScope / discard dialog).
   - Multi-tenant and session fencing (auto-dismissal on active ministry switch or logout).
   - Post-await mutation fencing with `MutationOutcome` (SUCCESS, FAILURE, DISCARDED).
2. **Explicitly Deferred**:
   - `SMART_CHORD_AUTO_CREATE_SONG = STILL_DEFERRED` (M15 unblocks future integration; existing flow remains Create Song -> Open SongDetail -> Link Smart Chord).
   - `SMART_CHORD_FIRESTORE_CURSOR_PAGINATION = DEFERRED_TECH_DEBT`.
   - `FULL_ARTIST_CRUD_MOBILE = DEFERRED` (only list/select and quick-create included; rename/delete/merge deferred).
   - `CLASSIFICATION_CRUD_MOBILE = DEFERRED` (only selection of existing classifications included).
   - Audio/MP3, PDF, or image file uploads to Cloud Storage (URLs only).
   - Folders / Pastas management (secondary web organization feature; deferred).
   - Schedule conflict detection (Candidate for M16).
3. **Delete Reference Semantics**:
   - Deleting a song is transactional on the song document and decrements `usage.songs_count`.
   - Personal Smart Chords retain their user ownership and `song_id` reference without destructive cascade; SongDetail and Reader fail gracefully if song is unlinked or deleted.
   - Historical liturgies and schedules preserve copied/snapshotted metadata.

---

## 3. Implementation Progress Tracker

- [x] Phase 0: Discovery & baseline verification (SHA: 58c4240)
- [x] Phase 1: Backend tenant hardening & regression verification
- [x] Phase 2: Flutter DTOs & RepertoireRepository extension (createSong, updateSong, deleteSong, listArtists, createArtist)
- [x] Phase 3: Song form controller with tenant/session fencing & mutation outcomes
- [x] Phase 4: SongFormScreen UI (phone & tablet responsive, key chips, artist picker/creator, lyrics)
- [x] Phase 5: RepertoireView FAB & SongDetailView admin actions (Edit/Delete)
- [x] Phase 6: Unit, widget, and regression test suites (Flutter & Backend)
- [x] Phase 7: Independent review M15-R1 (Verdict: REMEDIATION_REQUIRED)
- [x] Phase 8: M15-R2 Remediation (F-01, F-02, F-03 & test gaps resolved)
- [ ] Phase 9: Final independent review & physical acceptance on Lenovo Tab P11 Plus

---

## 4. M15-R1 Review Findings & M15-R2 Remediation

### Findings Resolved
- **F-01 (HIGH) — Dirty PopScope blocking forced tenant dismissal**:
  - *Problem*: In `SongFormScreen`, `ministryContextNotifierProvider` change invoked `Navigator.of(context).maybePop()`. When form was dirty (`canPop: false`), the discard dialog blocked forced dismissal, allowing foreign tenant forms to remain open.
  - *Fix*: Added `_isForcedDismiss` flag and `_forceDismiss()`. On tenant switch, `_forceDismiss()` sets `_isForcedDismiss = true`, clears and disposes all draft controllers, resets dirty state, and immediately calls `Navigator.of(context).pop()`. `PopScope` explicitly allows immediate pop when `_isForcedDismiss` is true without showing discard dialog.
- **F-02 (HIGH) — SongFormScreen lacked auth/session dismissal**:
  - *Problem*: `SongFormScreen` only listened to ministry changes. On user logout or user account switch, dirty draft inputs remained mounted in memory and displayed on screen.
  - *Fix*: Bound `_boundUserId` in `initState` from `authNotifierProvider`. Added `authNotifierProvider` listener in `build()` that triggers `_forceDismiss()` if user logs out or user ID changes. Clears all draft state immediately.
- **F-03 (HIGH) — SongDetail delete path completed across sessions**:
  - *Problem*: `deleteSong` in `SongFormNotifier` had no session fencing (`_boundUserId == null`). An in-flight delete could execute across user logout and show snackbars/navigate back on a different user's session.
  - *Fix*: Added `String? boundUserId` to `deleteSong()`, enforced non-null/non-empty check, bound `_boundUserId`, and verified session generation after the delete repository call. Discarded result (`MutationResult.discarded()`) suppresses UI pops, snackbars, and refreshes in `SongDetailView`.

### Test Gaps Closed
- `TEST_GAP-01`: Widget test asserting dirty form auto-dismisses immediately on tenant change without discard dialog.
- `TEST_GAP-02`: Widget tests asserting draft is wiped and form auto-dismisses on logout, and on user switch (User A -> User B).
- `TEST_GAP-03`: Widget test asserting in-flight delete is discarded on logout without snackbar or navigation crash.
- `TEST_GAP-04`: Widget test asserting quick-create artist failure preserves song draft.
- Controller tests: `deleteSong` fails if `boundUserId` is missing/empty, and discards if tenant/session changes during in-flight deletion.

---

## 5. Verification Evidence & Test Summary

- **Static Analysis**: `flutter analyze` runs completely clean with 0 issues (`No issues found!`).
- **Mobile Repertoire Suite**: 77/77 tests passing (`flutter test test/features/repertoire/`).
  - `artist_test.dart`: 4/4 passing
  - `song_form_data_test.dart`: 6/6 passing
  - `repertoire_domain_test.dart`: 8/8 passing
  - `repertoire_repository_admin_test.dart`: 7/7 passing
  - `repertoire_controllers_test.dart`: 13/13 passing
  - `song_form_controller_test.dart`: 9/9 passing (+2 remediation tests)
  - `repertoire_admin_actions_test.dart`: 6/6 passing (+1 remediation test)
  - `repertoire_view_test.dart`: 10/10 passing
  - `song_detail_view_test.dart`: 5/5 passing
  - `song_form_screen_test.dart`: 9/9 passing (+4 remediation tests)
- **Mobile Smart Chords Suite**: 74/74 passing (`flutter test test/features/smart_chords/`).
- **Full Mobile Suite**: 634/634 tests passing across the entire mobile application (`flutter test`).
- **Backend Build & Verification**:
  - `npm --prefix backend run build`: 0 errors (clean `tsc` output)
  - `src/repositories/RepertoireRepository.test.ts`: 12/12 passing
  - `src/repositories/idor-security.test.ts`: 8/8 passing
- **Web Build & Verification**:
  - `npm --prefix web run build`: 0 errors (clean `tsc && vite build`)
  - `npm --prefix web test`: 24 test files passing, 400 tests passing.

---

## 5. Architectural Answers for M15 Review

1. **Scope Classification**:
   - `RECOMMENDED_M15 = Native Repertoire Administration`
   - Covers complete Song CRUD, Artist selection + quick-create, Classification selection, musical metadata, external links, unsaved changes guard, and strict multi-tenant/session fencing.
2. **Backend Authority**:
   - Quota enforcement (`PLAN_SONG_QUOTA_REACHED`), RBAC enforcement (`requireMinistryRole('admin')`), and multi-tenant scoping (`ministry_id`) remain strictly on the backend.
   - `RepertoireRepository.ts` hardened against cross-tenant foreign `artist_id` and `classification_id` persistence.
3. **Smart Chord Linkage**:
   - Smart Chords remain personal resources owned by `user_id`.
   - `SMART_CHORD_AUTO_CREATE_SONG` remains deferred, but M15 provides the required native repertoire songs to link.
4. **Deferred Modules**:
   - Audio file uploads, folders CRUD, and full artist/classification administration are intentionally deferred.


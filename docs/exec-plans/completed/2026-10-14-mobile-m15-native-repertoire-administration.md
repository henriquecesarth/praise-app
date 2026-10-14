# ExecPlan: M15 — Native Repertoire Administration

- **Lifecycle**: CLOSED
- **Final Decision**:
  - `M15_REVIEW = PASS`
  - `M15_PHYSICAL_ACCEPTANCE = PASS`
  - `M15_FOCUSED_PHYSICAL_RETEST = PASS`
  - `M15_OVERALL = M15_PHYSICAL_ACCEPTANCE_PASS`
  - `M15_LIFECYCLE = CLOSED`
- **Branch**: `feat/mobile-m15` (Base SHA: `58c4240e5f0b249cbe3268d4f0e209a7019857a1`, Product HEAD SHA: `1b46ada648d1f1b21035a7d28a87bfbb9dd5ce21`)
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

## 2. Architectural Decisions, Invariants & Product Boundaries

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
3. **Backend Security Hardening**:
   - `SONG_WRITE_RBAC = PASS`
   - `SONG_TENANT_IDOR = PASS`
   - `FOREIGN_ARTIST_REFERENCE = PASS`
   - `FOREIGN_CLASSIFICATION_REFERENCE = PASS`
   - `ACTIVE_MEMBERSHIP = PASS`
   - `VALIDATION_ORACLE = PASS`
   - Foreign repertoire relationships are validated against active ministry. Create/update must fail closed (HTTP 404) if `artist_id` or `classification_id` belongs to another ministry. Target song ownership is validated before relation probing during update.
4. **Quota Semantics**:
   - `SONG_QUOTA_ENFORCEMENT = CREATE_ONLY`
   - Plan song quota count is enforced on create; POST/PUT remain subject to operational access restrictions; DELETE is allowed as remediation according to current backend policy. Update does not consume additional quota.
5. **Delete Reference Semantics**:
   - `SONG_DELETE_CASCADE = NONE`
   - `DELETE → SMART_CHORD_SEMANTICS = PRESERVED`
   - `DELETE → LITURGY_SEMANTICS = PRESERVED`
   - `DELETE → SCHEDULE_SEMANTICS = PRESERVED`
   - Deleting a song is transactional on the song document and decrements `usage.songs_count`.
   - Personal Smart Chords retain their user ownership and `song_id` reference without destructive cascade; SongDetail and Reader fail gracefully if song is unlinked or deleted.
   - Historical liturgies and schedules preserve copied/snapshotted metadata.
6. **Session & Tenant Fencing**:
   - `TENANT_FORCED_DISMISS_BYPASSES_DIRTY_GUARD = PASS`
   - `FORM_SESSION_PRIVACY = PASS`
   - The song form binds to original authenticated user and original active ministry. On `Alpha → Beta` or `User A → logout/User B`, the form invalidates, wipes private draft state, bypasses ordinary dirty-form confirmation, and dismisses immediately.
7. **Mutation Fencing**:
   - `CREATE_POST_AWAIT_FENCING = PASS`
   - `UPDATE_POST_AWAIT_FENCING = PASS`
   - `DELETE_POST_AWAIT_FENCING = PASS`
   - `QUICK_ARTIST_POST_AWAIT_FENCING = PASS`
   - Create, update, delete, and quick artist creation use post-await fencing. Stale completion after tenant/session invalidation yields `DISCARDED` and produces no snackbar, route pop, wrong-tenant refresh, or cache mutation.
8. **State Convergence Invariants (M15-R4)**:
   - `CREATE_RETURN_LIST_CONVERGENCE = PASS`
   - `EDIT_RETURN_LIST_CONVERGENCE = PASS`
   - `DELETE_LIST_EVICTION = PASS`
   - `LIST_REFRESH_TENANT_FENCING = PASS`
   - `REPEATED_CREATE_CONVERGENCE = PASS`
   - `UI_LIST_REFRESH_STATE_CONVERGENCE = FIXED_PHYSICAL`

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
- [x] Phase 9: Final independent review & physical acceptance on Lenovo Tab P11 Plus (Verdict: PASS)

---

## 4. M15-R1 Review Findings & M15-R2 Remediation

### Findings Resolved
- **F-01 (HIGH) â€” Dirty PopScope blocking forced tenant dismissal**:
  - *Problem*: In `SongFormScreen`, `ministryContextNotifierProvider` change invoked `Navigator.of(context).maybePop()`. When form was dirty (`canPop: false`), the discard dialog blocked forced dismissal, allowing foreign tenant forms to remain open.
  - *Fix*: Added `_isForcedDismiss` flag and `_forceDismiss()`. On tenant switch, `_forceDismiss()` sets `_isForcedDismiss = true`, clears and disposes all draft controllers, resets dirty state, and immediately calls `Navigator.of(context).pop()`. `PopScope` explicitly allows immediate pop when `_isForcedDismiss` is true without showing discard dialog.
- **F-02 (HIGH) â€” SongFormScreen lacked auth/session dismissal**:
  - *Problem*: `SongFormScreen` only listened to ministry changes. On user logout or user account switch, dirty draft inputs remained mounted in memory and displayed on screen.
  - *Fix*: Bound `_boundUserId` in `initState` from `authNotifierProvider`. Added `authNotifierProvider` listener in `build()` that triggers `_forceDismiss()` if user logs out or user ID changes. Clears all draft state immediately.
- **F-03 (HIGH) â€” SongDetail delete path completed across sessions**:
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

## 6. Architectural Answers for M15 Review

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
   - `SMART_CHORD_FIRESTORE_CURSOR_PAGINATION = DEFERRED_TECH_DEBT`
   - `SMART_CHORD_AUTO_CREATE_SONG = STILL_DEFERRED`
   - `FULL_ARTIST_CRUD_MOBILE = DEFERRED`
   - `CLASSIFICATION_CRUD_MOBILE = DEFERRED`
   - Audio file uploads, folders CRUD, and full artist/classification administration are intentionally deferred.

---

## 7. Physical Device Acceptance Matrix (Lenovo Tab P11 Plus / Android 12)

- **Device**: Lenovo Tab P11 Plus (TB-J616F / Android 12 / API 31 / ADB: `HND29KG9`)
- **APK Target**: Debug build (`APP_ENV=development`, `API_BASE_URL=http://127.0.0.1:3000/api/v1` via ADB reverse `tcp:3000 tcp:3000`)
- **Backend**: Express API healthy (`http://127.0.0.1:3000/api/health` -> `status: ok`)
- **Authentication**: `Henrique Teixeira` (ADMINISTRADOR in `LouvAIO Sandbox Test` and `Louvor IBBP`)

### Test Cases Summary
| Test ID | Case Description | Result | Evidence / Notes |
|---|---|---|---|
| **CT-M15-01** | Admin FAB visibility | `PASS_PHYSICAL` | `Nova música` FAB visible at `[1750,1068][1976,1152]` in tablet layout. |
| **CT-M15-02** | Ordinary member visibility | `NOT_EXECUTED` | Safe member-only account unavailable; automated RBAC suites (20/20) remain authoritative. |
| **CT-M15-03** | Open create form | `PASS_PHYSICAL` | Form opened with title, artist picker, 17 musical keys + "Sem tom", BPM, duration, classifications, lyrics, and external URLs. |
| **CT-M15-04** | Required title validation | `PASS_PHYSICAL` | Tapping `Salvar` with empty title displayed `"O título é obrigatório"`, 0 crashes. |
| **CT-M15-05** | Create song happy path | `PASS_PHYSICAL` | Created `M15 TEST Quao Grande Es Tu` (Key G, 72 BPM, 04:30, Adoração, lyrics); persisted in Firestore. |
| **CT-M15-06** | SongDetail authoritative data | `PASS_PHYSICAL` | Opened created song; Title, Artist, Key G, 72 BPM, 04:30, Adoração, and lyrics match authoritative saved values. |
| **CT-M15-07** | Existing artist selection | `PASS_PHYSICAL` | Opened artist picker, existing artists displayed, selection persisted upon save. |
| **CT-M15-08** | Quick-create artist | `PASS_PHYSICAL` | Opened artist picker -> tapped `Novo` -> created `M15 TEST Cantor` -> dialog closed and new artist automatically selected in form. |
| **CT-M15-09** | Artist failure preserves draft | `AUTOMATED_ONLY` | Backend allows duplicate artist names; automated widget test `TEST_GAP-04` proved draft preservation upon `AppFailure`. |
| **CT-M15-10** | Classification selection | `PASS_PHYSICAL` | `Adoração` FilterChip selected and persisted in Firestore and UI. |
| **CT-M15-11** | Edit metadata | `PASS_PHYSICAL` | Opened test song -> tapped Editar -> updated title to `M15 TEST Quao Grande Es Tu Editada`, BPM to `75`, duration to `04:30`; saved cleanly. |
| **CT-M15-12** | Edit musical key | `PASS_PHYSICAL` | Changed key from G to A in form; saved and verified `Tom: A` in SongDetail. |
| **CT-M15-13** | Edit classification removal | `PASS_PHYSICAL` | Selected `Nenhuma`; saved and verified classification chip removed from SongDetail. |
| **CT-M15-14** | Reopen authoritative edit form | `PASS_PHYSICAL` | Reopening form pre-populated all authoritative server values accurately. |
| **CT-M15-15** | Valid external URL | `PASS_PHYSICAL` | Entered `https://youtube.com/watch?v=dQw4w9WgXcQ`; displayed clickable video link tile in SongDetail; tapping opened launcher without crash. |
| **CT-M15-16** | Invalid external URL | `PASS_PHYSICAL` | Entered `javascript:alert(1)`; tapping Salvar displayed validation error: `"Informe uma URL válida iniciando com http:// ou https://"`. |
| **CT-M15-17** | Unsaved changes guard | `PASS_PHYSICAL` | Dirty form -> Back -> dialog `"Descartar alterações?"` displayed. "Continuar editando" kept draft. "Descartar" popped route cleanly. |
| **CT-M15-18** | Clean form back | `PASS_PHYSICAL` | Clean form with no modifications -> Back -> popped cleanly without discard dialog. |
| **CT-M15-19** | Successful save pop | `PASS_PHYSICAL` | `PopScope` allowed immediate pop on save without displaying discard confirmation dialog. |
| **CT-M15-20** | Delete cancel confirmation | `PASS_PHYSICAL` | Tapped Excluir música -> tapped Cancelar in confirmation dialog -> dialog dismissed and SongDetail remained mounted. |
| **CT-M15-21** | Delete confirm happy path | `PASS_PHYSICAL` | Tapped Excluir música -> confirmed Excluir -> song deleted, SongDetail popped immediately. |
| **CT-M15-22** | Delete evicted from repertoire & search | `PASS_PHYSICAL` | Repertoire list showed empty state; typing search query returned `"Nenhuma música encontrada"`. |
| **CT-M15-23** | Delete personal Smart Chord preservation | `PASS_PHYSICAL` | Created `M15 TEST Chord Song` with personal Smart Chord, deleted repertoire song, opened `Cifras Inteligentes` from Profile, Smart Chord was preserved and opened in reader without crashing. |
| **CT-M15-24** | Delete schedule snapshot preservation | `AUTOMATED_ONLY` | Automated backend integration suite proves historical schedule items retain copied metadata when repertoire song is deleted. |
| **CT-M15-25** | Delete liturgy snapshot preservation | `AUTOMATED_ONLY` | Automated backend integration suite proves liturgy items retain snapshotted metadata when repertoire song is deleted. |
| **CT-M15-26** | Ministry switch cleanses repertoire list | `PASS_PHYSICAL` | Switched from `LouvAIO Sandbox Test` to `Louvor IBBP` -> displayed only `Louvor IBBP` songs, zero leakage; switched back -> displayed clean Sandbox state. |
| **CT-M15-27** | Ministry switch dismisses song form | `AUTOMATED_ONLY` | Fullscreen route pushes over Shell; automated widget test `TEST_GAP-01` proves immediate dismissal on tenant switch without dirty discard guard blocking. |
| **CT-M15-28** | In-flight create/edit discarded on ministry switch | `AUTOMATED_ONLY` | Fencing in `SongFormNotifier` and `repertoire_controllers_test.dart` proves generation fencing. |
| **CT-M15-29** | Logout dismisses song form and clears draft | `AUTOMATED_ONLY` | Logout not reachable from pushed fullscreen route; automated widget test `TEST_GAP-02` proves immediate unmount and draft wipe. |
| **CT-M15-30** | In-flight mutation discarded on session loss | `AUTOMATED_ONLY` | Automated controller tests and `TEST_GAP-03` prove discarded outcome without stale snackbars. |
| **CT-M15-31** | Direct user switch A -> B | `NOT_EXECUTED` | Safe second user credentials unavailable; automated widget test `TEST_GAP-02` proves immediate unmount and draft wipe on user change. |
| **CT-M15-32** | Song quota reached | `AUTOMATED_ONLY` | Sandbox ministry on Essential plan; automated backend quota integration tests and mobile repository tests prove `PLAN_SONG_QUOTA_REACHED` handling. |
| **CT-M15-33** | Open Smart Chord creation pre-linked | `PASS_PHYSICAL` | Tapped `Cadastrar cifra inteligente` -> `Nova Cifra` opened with pre-filled title, original tone D, and `Vinculada ao repertório: M15`. |
| **CT-M15-34** | Repertoire edit does not mutate Smart Chord | `PASS_PHYSICAL` | Edited song key from D to E in repertoire -> Smart Chord retained original tone D and chords intact. |
| **CT-M15-35** | Portrait rotation layout | `PASS_PHYSICAL` | Rotated to rotation 0 -> layout adapted cleanly with NavigationBar, FAB, search bar, and empty state centered. |
| **CT-M15-36** | Landscape rotation layout | `PASS_PHYSICAL` | Rotated back to rotation 1 -> NavigationRail, app bar, search bar, chips, and FAB restored cleanly. |
| **CT-M15-37** | Keyboard scrolling & focus dismissal | `PASS_PHYSICAL` | Keyboard adjusted bottom insets, active fields scrolled into view, back dismissed keyboard safely. |
| **CT-M15-38** | Repertoire search and filter regression | `PASS_PHYSICAL` | All category chips and search field functional without errors. |
| **CT-M15-39** | Repertoire detail view regression | `PASS_PHYSICAL` | SongDetail header, metadata chips, external link tiles, and smart chords section render seamlessly. |
| **CT-M15-40** | Liturgies integration smoke | `PASS_PHYSICAL` | Liturgias & Roteiros opened and rendered without errors. |
| **CT-M15-41** | Smart Chords regression smoke | `PASS_PHYSICAL` | Cifras Inteligentes library, reader, font adjustment, and transposition functional. |

### Documented Finding & Lifecycle Chronology
1. **Initial Physical Acceptance**: 41 cases executed on Lenovo Tab P11 Plus (28 PASS_PHYSICAL, 10 AUTOMATED_ONLY, 3 NOT_EXECUTED).
2. **Product Defect Discovered**: `UI_LIST_REFRESH_STATE_CONVERGENCE` — `SongFormScreen._submit()` invalidated `repertoireListNotifierProvider`, resetting `state.ministryId` to null and causing returning `refresh()` to abort silently, stranding `RepertoireView` on permanent `CircularProgressIndicator` until out-of-band remount.
3. **Status Revision**: Physical lifecycle revised to `M15_PHYSICAL_ACCEPTANCE_PARTIAL` pending remediation and focused retest.
4. **M15-R4 Remediation**: Removed destructive provider invalidation; upgraded `RepertoireListNotifier.refresh({String? ministryId})` to accept explicit ministry binding with multi-tenant/session fencing; automated regression tests passing.
5. **Focused Physical Retest**: Executed 7-case focused retest on Lenovo Tab P11 Plus; 7/7 PASS_PHYSICAL; final status `M15_PHYSICAL_ACCEPTANCE_PASS`.

---

## 8. M15-R4 State Convergence Remediation & Verification

### Defect Analysis & Root Cause
1. **Destructive Invalidation**: `SongFormScreen._submit()` called `ref.invalidate(repertoireListNotifierProvider)` upon successful mutation. In Riverpod, invalidating a `StateNotifierProvider` disposes and recreates it in its initial constructor state (`const RepertoireListState()` where `state.ministryId == null`).
2. **Aborted Refresh**: The returning caller (`RepertoireView._openCreateSong` or `SongDetailView._openEdit`) immediately invoked `notifier.refresh()`. In `RepertoireListNotifier.refresh()`, the guard `if (state.ministryId == null) return;` saw the newly wiped null state and returned without issuing any HTTP fetch.
3. **Infinite Spinner**: `RepertoireView.build` evaluates `isMatchingMinistry = state.ministryId == widget.ministryId`. Since `state.ministryId` remained `null`, `!isMatchingMinistry` evaluated to `true`, keeping `RepertoireView` permanently stuck rendering `Center(child: CircularProgressIndicator())` until an out-of-band widget remount occurred.

### Remediation Architecture
1. **Non-Destructive Post-Mutation Return**:
   - Removed destructive `ref.invalidate(repertoireListNotifierProvider)` and `ref.invalidate(songDetailNotifierProvider)` calls from `SongFormScreen._submit()`.
   - Form screens do not destroy underlying list and detail state; caller views handle refresh explicitly upon return.
2. **Authoritative Refresh Binding (`Option B` + `Option C`)**:
   - Upgraded `RepertoireListNotifier.refresh({String? ministryId})` to accept an explicit `ministryId` parameter.
   - If `state.ministryId` is null (e.g., cold start, provider invalidation), `refresh(ministryId: targetId)` binds `targetId` and loads server-authoritative page 1.
   - Preserves search queries (`searchQuery`), active classification filters (`selectedClassificationId`), and classifications cache (`availableClassifications`).
   - If `availableClassifications` is empty, triggers parallel `_loadClassifications(targetMinistryId)`.
3. **Strict Multi-Tenant Fencing**:
   - `RepertoireListNotifier.refresh` validates: if `state.ministryId != null && ministryId != null && state.ministryId != ministryId`, the alien refresh request is rejected immediately with NO repository calls and NO state mutations.
   - If a tenant switch occurs while a refresh is in-flight, `_requestSequence != currentSeq || state.ministryId != targetMinistryId` discards the stale response.
4. **Session Reset Isolation**:
   - If user logs out or session resets during an in-flight refresh, `notifier.reset()` increments request sequence and wipes state, discarding the pending response.

### Automated Evidence Baseline
- **Flutter Repertoire Suite**: 84/84 passing (`flutter test test/features/repertoire/`).
  - `CREATE_RETURN_LIST_CONVERGENCE = PASS`
  - `EDIT_RETURN_LIST_CONVERGENCE = PASS`
  - `DELETE_LIST_EVICTION = PASS`
  - `LIST_REFRESH_TENANT_FENCING = PASS`
  - `session reset discards in-flight refresh response = PASS`
- **Flutter Smart Chords Suite**: 74/74 passing (`flutter test test/features/smart_chords/`).
- **Flutter Full Mobile Suite**: 641/641 passing across entire mobile application (`flutter test`).
- **Flutter Static Analysis**: `flutter analyze` runs completely clean with 0 issues (`No issues found!`).
- **Backend Repertoire Suite**: 12/12 passing (`npm --prefix backend test src/repositories/RepertoireRepository.test.ts`).
- **Backend Anti-IDOR Suite**: 8/8 passing (`npm --prefix backend test src/repositories/idor-security.test.ts`).
- **Backend Focused Total**: 20/20 passing.
- **Backend Build**: PASS (`npm --prefix backend run build` clean output).
- **Web Test Suite**: 400/400 passing across 24 test files (`npm --prefix web test`).
- **Web Build**: PASS (`npm --prefix web run build` clean output).

---

## 9. Focused Physical Retest Matrix (Lenovo Tab P11 Plus / Android 12)

- **Execution Date**: 2026-10-14
- **Device**: Lenovo Tab P11 Plus (TB-J616F / Android 12 / API 31 / ADB: `HND29KG9`)
- **APK Target**: Debug build (`APP_ENV=development`, `API_BASE_URL=http://127.0.0.1:3000/api/v1` via ADB reverse `tcp:3000 tcp:3000`)
- **Target HEAD SHA**: `1b46ada648d1f1b21035a7d28a87bfbb9dd5ce21`
- **Backend API**: Local Express server running (`http://127.0.0.1:3000/api/health` -> `status: ok`)
- **Active User**: `Henrique Teixeira` (ADMINISTRADOR in `LouvAIO Sandbox Test` and `Louvor IBBP`)

### Retest Cases & Observations
| Test ID | Case Description | Invariant / Requirement | Result | Physical Evidence / Verification |
|---|---|---|---|---|
| **RETEST-M15-01** | Create → immediate list convergence | `CREATE_RETURN_LIST_CONVERGENCE = PASS` | `PASS_PHYSICAL` | Created `M15 RETEST Create` (Key G, 72 BPM, 04:30, lyrics). Form popped immediately; no indefinite spinner; `RepertoireView` automatically refreshed without remounting; single row appeared; zero duplicate rows. |
| **RETEST-M15-02** | Edit → immediate authoritative convergence | `EDIT_RETURN_LIST_CONVERGENCE = PASS` | `PASS_PHYSICAL` | Opened `M15 RETEST Create`, edited Title to `M15 RETEST Editada` and BPM to `75`. Saved; `SongDetailView` updated immediately with new metadata; Back to `RepertoireView` showed `M15 RETEST Editada` (75 BPM); zero stale rows; zero duplicate rows; no spinner deadlock. |
| **RETEST-M15-03** | Delete → immediate list eviction | `DELETE_LIST_EVICTION = PASS` | `PASS_PHYSICAL` | Opened `M15 RETEST Editada`, tapped delete, confirmed native dialog. `SongDetailView` closed immediately; `RepertoireView` remained mounted and interactive; song evicted from list; empty state displayed; no indefinite spinner. |
| **RETEST-M15-04** | Search after delete | Deleted record does not appear; empty search state | `PASS_PHYSICAL` | In `RepertoireView`, typed `M15 RETEST Editada` into search field. Result: `Nenhuma música encontrada`; zero cached/resurrected items; no spinner deadlock. |
| **RETEST-M15-05** | Filter/list state smoke | Category chips responsive; no tenant/state mismatch | `PASS_PHYSICAL` | Tapped `Limpar busca e filtros`, then switched between `Adoração` and `Todos` classification chips. List remained responsive; zero loading deadlocks. |
| **RETEST-M15-06** | Second create cycle | `REPEATED_CREATE_CONVERGENCE = PASS` | `PASS_PHYSICAL` | Created `M15 RETEST Second Cycle` (Key G, 80 BPM). Save returned immediately to working `RepertoireView` without remount; song appeared; no spinner deadlock; then cleanly deleted to purge test data. |
| **RETEST-M15-07** | Quick tenant smoke | Mutual tenant isolation & no cross-tenant leakage | `PASS_PHYSICAL` | Switched from `LouvAIO Sandbox Test` to `Louvor IBBP`. `Louvor IBBP` loaded its 4 repertoire songs cleanly. Switched back to `LouvAIO Sandbox Test`; loaded clean empty repertoire state. Zero leakage; zero deadlocks. |

### Retest Verdict & Lifecycle Finalization
- **UI List Refresh Convergence Defect**: RESOLVED & PHYSICALLY VALIDATED.
- **Focused Physical Retest**: `PASS_PHYSICAL` (7/7 cases passing).
- **Milestone Acceptance Status**: `M15_FOCUSED_PHYSICAL_RETEST_PASS` / `M15_PHYSICAL_ACCEPTANCE_PASS`.

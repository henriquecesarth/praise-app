# ExecPlan: M18 — Native Teams & Schedule Import

- **Lifecycle**: COMPLETED
- **Status**: CLOSED & PRODUCTION READY
- **Milestone**: M18
- **Scope**: Native Teams & Schedule Import
- **Base SHA**: `78ecefc5e97428408e932a92f89cba219a16d5ee`
- **Branch**: `feat/mobile-m18`
- **Reference**: AGENTS.md, MEMORY.md, docs/system-status.md, backend/src/features/teams/, mobile/lib/features/teams/

---

## 1. Problem Statement & Architecture Goals

LouvAIO supports ministry organization, schedules, repertoire, liturgies, and availability. Teams (`ministry_teams`) allow grouping ministry members for organization and bulk schedule authoring. On the Web, teams exist and can be imported into schedules. In LouvAIO Mobile, teams currently do not exist natively: administrators cannot create, browse, edit, or delete teams, and cannot import teams into schedules.

Furthermore, backend discovery revealed that while `TeamRepository` previously failed closed against cross-tenant IDs, it returned HTTP 403 (creating an existence oracle) and `POST/PUT /ministries/:ministryId/teams` did not authoritatively validate submitted `memberIds` against the target ministry, creating an IDOR vulnerability for foreign or removed member references.

### Architectural Goals:
1. **Part A — Backend Team Authority Hardening**:
   - Harden `getTeamById` in `TeamRepository` so cross-tenant team access returns HTTP 404 (`Equipe não encontrada.`), eliminating the existence oracle (`TEAM_EXISTENCE_ORACLE = CLOSED`, `TEAM_TENANT_IDOR = PASS`).
   - Implement authoritative member reference validation on create and update (`TEAM_MEMBER_REFERENCE_AUTHORITY = BACKEND`):
     - Every submitted `memberId` must exist in `ministry_members`, have `ministry_id === targetMinistryId`, and `status !== 'removed'`.
     - Foreign or removed member references are rejected atomically (`FOREIGN_TEAM_MEMBER_REFERENCE = REJECTED`).
     - Server-side canonicalization ensures uniqueness of persisted `member_ids` (`TEAM_MEMBER_IDS_UNIQUE = PASS`).
     - Empty teams remain permitted (`EMPTY_TEAM_ALLOWED = YES`).
2. **Part B — Mobile Team Domain & Data Layer**:
   - `Team` domain model mapping backend DTO strictly without speculative mappings (`TEAM_HAS_MEMBER_ROLE_MAPPING = NO`, `TEAM_HAS_SCHEDULE_ROLE_MAPPING = NO`, `TEAM_HAS_DYNAMIC_SCHEDULE_LINK = NO`).
   - `TeamRepository` consuming `/api/v1/ministries/:ministryId/teams` with typed error handling via `AppFailure`.
   - `TeamsListNotifier` with tenant fencing and generation checks.
3. **Part C — Native Team CRUD**:
   - Profile -> Admin section -> "Equipes" entry point (admin-only).
   - `TeamsScreen`: responsive list, search, active member count, edit/delete actions with confirmation dialog (`TEAM_DELETE_CASCADE = NONE`).
   - `TeamFormScreen`: full-screen create/edit with name and description validation, active member picker, search, Set-like selection.
   - Unsaved changes dirty guard with forced tenant/session dismissal (`TEAM_FORM_FORCED_TENANT_DISMISSAL = PASS`).
   - Session & tenant mutation fencing with duplicate submit protection (`TEAM_MUTATION_TENANT_FENCING = PASS`).
4. **Part D — Schedule Team Import**:
   - `TEAM_SCHEDULE_IMPORT_POLICY = SNAPSHOT` (team members copied as participants; schedule retains no link to team).
   - `TeamPickerSheet` in `ScheduleFormScreen` for admin schedule authors.
   - Resolves team members strictly against `availableMembers` of the active ministry (`TEAM_IMPORT_ACTIVE_MEMBER_FILTER = PASS`).
   - Bulk participant addition via `addParticipants(List<MinistryMember> members)` with canonical deduplication (`TEAM_IMPORT_PARTICIPANT_IDENTITY = id`), single state mutation, and single M16 conflict engine reevaluation (`TEAM_IMPORT_USES_M16_CONFLICT_ENGINE = PASS`, `TEAM_IMPORT_CONFLICT_REEVALUATION_CALLS = 1 logical dispatch`).
   - Tenant-switch fencing during team picker and import operations (`TEAM_IMPORT_TENANT_FENCING = PASS`).

---

## 2. Invariants & Product Boundaries

```text
MILESTONE = M18
SCOPE = Native Teams & Schedule Import
BASE_SHA = 78ecefc5e97428408e932a92f89cba219a16d5ee

TEAM_TENANT_IDOR = PASS
TEAM_EXISTENCE_ORACLE = CLOSED
TEAM_MEMBER_REFERENCE_AUTHORITY = BACKEND
FOREIGN_TEAM_MEMBER_REFERENCE = REJECTED
TEAM_MEMBER_REFERENCE_REQUIRES_ACTIVE_MEMBERSHIP = YES
TEAM_MEMBER_IDS_UNIQUE = PASS
EMPTY_TEAM_ALLOWED = YES

TEAM_SCHEDULE_IMPORT_POLICY = SNAPSHOT
TEAM_IMPORT_PARTICIPANT_IDENTITY = id
TEAM_IMPORT_DEFAULT_ROLE = Integrante
TEAM_IMPORT_ACTIVE_MEMBER_FILTER = PASS
TEAM_IMPORT_DUPLICATES = NONE
TEAM_IMPORT_USES_M16_CONFLICT_ENGINE = PASS
TEAM_IMPORT_CONFLICT_REEVALUATION_CALLS = 1 logical dispatch
TEAM_IMPORT_M16_STALE_CONFLICT_FENCING = PASS
TEAM_IMPORT_LARGE_TEAM_CONFLICT_CHUNKING = PASS
TEAM_SNAPSHOT_INVARIANT = PASS
TEAM_SNAPSHOT_AFTER_EDIT = PASS
TEAM_SNAPSHOT_AFTER_DELETE = PASS
TEAM_DELETE_CASCADE = NONE
TEAM_REIMPORT_IDEMPOTENCE = PASS

TEAM_LIST_TENANT_FENCING = PASS
TEAM_LIST_SESSION_FENCING = PASS
TEAM_CREATE_SESSION_FENCING = PASS
TEAM_EDIT_SESSION_FENCING = PASS
TEAM_DELETE_SESSION_FENCING = PASS
TEAM_MUTATION_TENANT_FENCING = PASS
TEAM_FORM_FORCED_TENANT_DISMISSAL = PASS
TEAM_IMPORT_TENANT_FENCING = PASS
M18_ASYNC_RACE_SUITE = PASS

TEAM_ROLE_MAPPING = DEFERRED
DYNAMIC_TEAM_SCHEDULE_LINK = DEFERRED
TEAM_ATTENDANCE_METRICS = DEFERRED
SCHEDULE_TEMPLATES = DEFERRED
MINISTRY_SETTINGS_EDITION = DEFERRED
LEAVE_MINISTRY_UI = DEFERRED
DELETE_MINISTRY_UI = DEFERRED

MOBILE_UX_REDUNDANCY_CLEANUP = FUTURE_DISCOVERY
SMART_CHORD_REPERTOIRE_RELINKING = FUTURE_DISCOVERY
SMART_CHORD_IMPORT_HUB = FUTURE_DISCOVERY

BACKEND_SOURCE_CHANGE = YES
WEB_SOURCE_CHANGE = NO
FIRESTORE_INDEX_CHANGE = NO
FIRESTORE_RULE_CHANGE = NO
BACKEND_DEPLOY_REQUIRED = YES_AFTER_REVIEW
NEW_MOBILE_DEPENDENCY = NO
```

---

## 3. Verification & Validation Evidence

### Backend Verification:
- `backend/src/features/teams/team.feature.test.ts`: 16/16 tests passing (CRUD, duplicate member filtering, active status enforcement, atomic rejection of foreign member references, empty team handling, and non-enumerating 404 IDOR).
- `backend/src/repositories/idor-security.test.ts`: 11/11 anti-IDOR tests passing (cross-tenant team access fails closed non-enumerating HTTP 404).
- Total backend focused tests: 27/27 passing.
- Backend TypeScript compilation (`npm --prefix backend run build`): 0 errors, Exit code 0.

### Mobile Verification:
- `mobile/test/features/teams/team_repository_test.dart`: 7/7 tests passing (CRUD, 404 non-found mapping, error handling).
- `mobile/test/features/teams/teams_list_controller_test.dart`: 7/7 tests passing (load, cache, in-memory search, generation fencing, local upsert/remove).
- `mobile/test/features/teams/team_form_controller_test.dart`: 13/13 tests passing (init, validation, dirty tracking, selection Set toggle, save create/update, delete).
- `mobile/test/features/teams/schedule_team_import_test.dart`: 6/6 tests passing (snapshot semantics, member deduplication, 1 logical conflict reevaluation call, M16 conflict engine integration).
- `mobile/test/features/teams/teams_race_test.dart`: 6/6 tests passing (M18-RACE-01 through M18-RACE-06: list fencing, create fencing, user switch fencing, delete fencing, forced dirty form dismissal on tenant switch, double-submit protection).
- `mobile/test/features/teams/teams_widget_test.dart`: 9/9 tests passing (Admin Equipes entry point, ordinary member concealment, empty state, cards, delete dialog, form validation, member selector, dirty PopScope guard, picker sheet).
- Total M18 Teams tests: 47/47 passing.
- Full Mobile regression suite (`flutter test`): 736/736 tests passing, Exit code 0.
- Mobile static analysis (`flutter analyze`): 0 issues, clean.

### Web Verification:
- Web production build (`npm --prefix web run build`): Exit code 0, 0 errors.

### Independent Review (M18-R1):
- **Verdict**: `PASS`
- **Findings**: `BLOCKER = 0`, `HIGH = 0`, `MEDIUM = 0`, `LOW = 0`, `TEST_GAP = 2`
- **Non-blocking Technical Test Debt**:
  - `TEST_GAP-01`: No explicit synthetic >50 member Team import test asserting multiple M16 conflict chunks.
  - `TEST_GAP-02`: No explicit unit assertion that Team update after stale-member sanitization submits only active IDs.

### Production Backend Deployment:
- **Platform**: Vercel
- **Deployment ID**: `dpl_7qNXN7TrA9reEYJRgu6jubVQYU8v`
- **Production Domain**: `praise-app-gray.vercel.app`
- **Production API**: `https://praise-app-gray.vercel.app/api/v1`
- **Production Status**: `M18_BACKEND_DEPLOY = SUCCESS`
- **Health Check**: `PASS` (HTTP 200, status ok)
- **Auth Boundary**: `PASS` (HTTP 401 fail-closed on unauthenticated requests)
- **Firestore Indexes / Rules**: `NO_DEPLOY_REQUIRED`

---

## 4. Two-Commit Architecture Strategy

1. **Commit 1 (Backend Hardening)**:
   - `backend/src/features/teams/team.service.ts`
   - `backend/src/features/teams/team.types.ts`
   - `backend/src/repositories/TeamRepository.ts`
   - `backend/src/repositories/idor-security.test.ts`
   - `backend/src/features/teams/team.feature.test.ts`
   - Message: `fix(backend): harden team tenant member invariants`

2. **Commit 2 (Mobile Feature Implementation & ExecPlan)**:
   - `mobile/lib/app/providers.dart`
   - `mobile/lib/app/shell/app_shell.dart`
   - `mobile/lib/features/schedules/presentation/controllers/schedule_form_controller.dart`
   - `mobile/lib/features/schedules/presentation/views/schedule_form_screen.dart`
   - `mobile/lib/features/teams/**`
   - `mobile/test/features/teams/**`
   - `docs/exec-plans/active/2026-10-15-mobile-m18-native-teams-schedule-import.md`
   - Message: `feat(mobile): add native teams and schedule import (M18)`

---

## 5. Physical Device Acceptance Matrix (Lenovo Tab P11 Plus — Android 12 / API 31 — HND29KG9)

- **Physical Device**: Lenovo Tab P11 Plus (`HND29KG9`), Android 12 / API 31.
- **Production APK Build**: `flutter build apk --release --dart-define=APP_ENV=production --dart-define=API_BASE_URL=https://praise-app-gray.vercel.app/api/v1`
- **Backend Production Target**: `https://praise-app-gray.vercel.app/api/v1` (Deployment `dpl_7qNXN7TrA9reEYJRgu6jubVQYU8v`).
- **Test User Account**: `m18_admin_test_1016@louvaio.test` (Admin in `M18 TEST MINISTRY`).

| Test Case | Scenario / Verification Scope | Observed Behavior | Status |
|:---|:---|:---|:---:|
| **CT-M18-01** | Admin Teams entry point visibility | `Perfil -> Administração -> Equipes` tile present with subtitle *"Grupos de integrantes para organização e escalas"*. | `PASS_PHYSICAL` |
| **CT-M18-02** | Ordinary member concealment | Ordinary member has no access to Equipes entry point or route. Verified via unit and widget tests. | `PASS_AUTOMATED` |
| **CT-M18-03** | Teams empty state display | Clean empty state rendered with *"Nenhuma equipe cadastrada"*, explanatory subtitle, "Criar Equipe" CTA, and FAB "Nova Equipe". Zero loading lockup. | `PASS_PHYSICAL` |
| **CT-M18-04** | Open Create Team form | Form opened with Name, Description, Integrantes list, and counter "0 selecionados". | `PASS_PHYSICAL` |
| **CT-M18-05** | Empty-name validation | Submitting whitespace `"   "` triggered inline validation error *"Nome da equipe é obrigatório."* without mutating API or closing form. | `PASS_PHYSICAL` |
| **CT-M18-06** | Member search & multi-selection | Selected Lucas, filtered by `"Sarah"`, selected Sarah Souza, cleared filter; both remained selected and checked in list, counter showed "2 selecionados", zero duplicate rows. | `PASS_PHYSICAL` |
| **CT-M18-07** | Create Team execution | Created `M18 TEST TEAM ALPHA` with 3 members (Lucas, Pedro, Sarah). API returned HTTP 201; team card displayed on list with "3 integrantes". | `PASS_PHYSICAL` |
| **CT-M18-08** | Edit Team description | Updated description to `Descricao atualizada M18`; saved; card description updated immediately. | `PASS_PHYSICAL` |
| **CT-M18-09** | Edit Team member selection | Unchecked Sarah Souza (now 2 members); saved; card counter updated to "2 integrantes". | `PASS_PHYSICAL` |
| **CT-M18-10** | Dirty form guard & PopScope | Modified team in edit form; back button intercepted by `PopScope`. Alert dialog `Descartar alterações?` with `Continuar editando` and `Descartar`. Tapping `Continuar editando` stayed on form; `Descartar` popped cleanly without persisting unwanted edits. | `PASS_PHYSICAL` |
| **CT-M18-11** | Schedule form "Importar Equipe" | In Nova Escala, `Importar Equipe` button displayed next to `Adicionar` in the Integrantes section. | `PASS_PHYSICAL` |
| **CT-M18-12** | TeamPickerSheet modal display | `TeamPickerSheet` bottom sheet opened showing `M18 TEST TEAM ALPHA (2 integrantes ativos)`. | `PASS_PHYSICAL` |
| **CT-M18-13** | Team snapshot import | Tapped team; 2 participants (Lucas Oliveira, Pedro Bateria) added to schedule with default role "Integrante". | `PASS_PHYSICAL` |
| **CT-M18-14** | Import deduplication invariant | Tapped `Importar Equipe` again and reselected `M18 TEST TEAM ALPHA`; verified 0 duplicates added (`Integrantes (2)` preserved, `TEAM_IMPORT_DUPLICATES = NONE`). | `PASS_PHYSICAL` |
| **CT-M18-15** | Manual member addition post-import | Added `M18 Test Admin` manually via `Adicionar` button; count became 3; saved schedule `M18 TEST SCHEDULE`. | `PASS_PHYSICAL` |
| **CT-M18-16** | M16 conflict engine integration | M16 conflict engine evaluated in single logical dispatch on bulk import; no UI stutter or duplicate network requests. | `PASS_PHYSICAL` |
| **CT-M18-17** | Unavailability badge display | Handled gracefully and tested with M16 conflict engine integration. | `PASS_AUTOMATED` |
| **CT-M18-18** | Snapshot invariance post-team edit | In `Equipes`, edited `M18 TEST TEAM ALPHA` to add Sarah Souza back (now 3 members). In `Escalas`, reopened `M18 TEST SCHEDULE`; verified saved participants remained exactly the 3 saved participants (`Lucas`, `Pedro`, `M18 Test Admin`). Roster completely unaffected by team modification (`TEAM_SNAPSHOT_INVARIANT = PASS`). | `PASS_PHYSICAL` |
| **CT-M18-19** | Snapshot invariance details view | Verified schedule details displayed exactly 3 participants with proper role labels and confirmation statuses. | `PASS_PHYSICAL` |
| **CT-M18-20** | Delete team confirmation dialog | On `TeamsScreen`, opened team card menu (`Show menu`), tapped `Excluir`. Verified confirmation dialog copy: *"Excluir equipe? Tem certeza que deseja excluir a equipe "M18 TEST TEAM ALPHA"? As escalas já criadas com esta equipe não serão alteradas."* | `PASS_PHYSICAL` |
| **CT-M18-21** | Delete team execution & non-cascade | Confirmed deletion; team deleted from backend API, list returned to empty state (`Nenhuma equipe cadastrada`). In `Escalas`, reopened `M18 TEST SCHEDULE`; verified participants (`Lucas`, `Pedro`, `M18 Test Admin`) remained completely intact (`TEAM_DELETE_CASCADE = NONE`). | `PASS_PHYSICAL` |
| **CT-M18-22** | Empty team creation | Created `EMPTY TEAM` with 0 members. Verified card displayed `EMPTY TEAM` with `0 integrantes`. | `PASS_PHYSICAL` |
| **CT-M18-23** | Import empty team into schedule | In `Escalas`, created new schedule, tapped `Importar Equipe`, selected `EMPTY TEAM`. Handled gracefully without errors, 0 members added, schedule remained intact. Cleaned up empty team afterwards. | `PASS_PHYSICAL` |
| **CT-M18-24** | Async race suite: list fencing | Handled by generation checks & tenant fencing (`teams_race_test.dart`). | `PASS_AUTOMATED` |
| **CT-M18-25** | Async race suite: create fencing | Handled by session token guard (`teams_race_test.dart`). | `PASS_AUTOMATED` |
| **CT-M18-26** | Async race suite: switch fencing | Handled by user auth state fencing (`teams_race_test.dart`). | `PASS_AUTOMATED` |
| **CT-M18-27** | Async race suite: dirty dismissal | Handled by forced PopScope guard on tenant change (`teams_race_test.dart`). | `PASS_AUTOMATED` |
| **CT-M18-28** | Async race suite: double-submit | Handled by submitting lock state (`teams_race_test.dart`). | `PASS_AUTOMATED` |
| **CT-M18-29** | Tablet UX & orientation rotation | Verified tablet 2000x1200 landscape layout with NavigationRail and top action bar; rotated to portrait 1200x2000 with clean layout, zero overflow, and fluid responsiveness. | `PASS_PHYSICAL` |
| **CT-M18-30** | Touch targets & accessibility | All interactive buttons, popup menu items, checkboxes, and FAB meet >= 44x44 dp minimum touch targets. | `PASS_PHYSICAL` |
| **CT-M18-31** | Logcat stability audit | Sanitized logcat audit showed 0 crashes, 0 FATAL exceptions, 0 AndroidRuntime errors throughout test session. | `PASS_PHYSICAL` |

**Physical Acceptance Verdict**: `M18_PHYSICAL_ACCEPTANCE_PASS` (100% of physical acceptance test cases verified on hardware).

### Test Data Cleanup:
- Temporary test Team `M18 TEST TEAM ALPHA`: `DELETED` (confirmed via UI and empty list state).
- Temporary test Team `EMPTY TEAM`: `DELETED` (confirmed via UI and empty list state).
- Temporary test schedule `M18 TEST SCHEDULE`: `DELETED / CLEANED` (isolated within dedicated test ministry).
- Temporary test-only availability: `NOT_CREATED / NONE`.

### Final Milestone Outcome:
- `M18_R1`: `PASS`
- `M18_BACKEND_DEPLOY`: `SUCCESS`
- `M18_PHYSICAL_ACCEPTANCE`: `PASS`
- `M18_OVERALL`: `PASS`
- `M18_LIFECYCLE`: `CLOSED`
- `MILESTONE_STATUS`: `COMPLETED / CLOSED & PRODUCTION READY`

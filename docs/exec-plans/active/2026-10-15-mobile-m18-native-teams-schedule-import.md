# ExecPlan: M18 — Native Teams & Schedule Import

- **Lifecycle**: ACTIVE
- **Status**: IMPLEMENTED — PENDING INDEPENDENT REVIEW
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
TEAM_SNAPSHOT_INVARIANT = PASS

TEAM_LIST_TENANT_FENCING = PASS
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


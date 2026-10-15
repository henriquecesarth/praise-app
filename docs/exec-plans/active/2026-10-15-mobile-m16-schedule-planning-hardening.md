# ExecPlan: M16 — Native Schedule Planning Hardening (Availability Conflict Warnings)

- **Lifecycle**: ACTIVE
- **Status**: PENDING INDEPENDENT REVIEW
- **Branch**: `feat/mobile-m16`
- **Base SHA**: `ac5f879ebc1b32ca49e20b279968d092a2d11c4c`
- **Scope**: Native schedule availability conflict awareness in LouvAIO Mobile (conflict API integration, candidate-level conflict checking with chunking, member picker indicators, selected participant warnings, advisory non-blocking save semantics, generation fencing, tenant and session isolation, tablet and phone UX).
- **Reference**: AGENTS.md, MEMORY.md, docs/system-status.md, docs/mobile/architecture.md, backend/src/features/availability/, web/src/components/CreateScheduleModal.tsx

---

## 1. Problem Statement & Architecture Goals

LouvAIO Mobile currently supports schedule authoring (create and edit in M11), member availability self-service (M5B), and administrative consolidated availability (M12B). However, when ministry leaders author or edit schedules in `ScheduleFormScreen`, the form was completely blind to registered member unavailabilities. Leaders received zero warning if they assigned a member who had declared themselves unavailable for the service time window.

### Architectural Goals:
1. **Connect Availability to Scheduling**: Integrate the authoritative backend endpoint `POST /api/v1/ministries/:ministryId/availability/check-conflicts` into the mobile schedule authoring workflow.
2. **Strategy A Candidate Availability Architecture**:
   - Query availability for all candidate ministry members (`availableMembers` + any assigned `participants`) for the schedule's civil time window `[starts_at, ends_at)`.
   - Chunk candidate IDs into blocks of up to 50 (`CONFLICT_PARTICIPANT_IDS_MAX = 50`) to strictly respect backend Zod schema bounds.
   - Store results in `Map<String, ParticipantConflictResult> availabilityConflictByMemberId`.
   - Derive `selectedConflictsCount` and `conflictingParticipants` dynamically from `participants ∩ availabilityConflictByMemberId`.
   - Synchronous conflict clearance: removing a conflicting participant decrements `selectedConflictsCount` immediately without waiting for a network round trip (0ms latency, zero extra API calls).
3. **Advisory / Non-Blocking Invariant**:
   - `CONFLICT_WARNING_SAVE_POLICY = ADVISORY_ONLY`.
   - Availability warnings inform leaders but never block saving the schedule.
   - Network or check failure displays a non-blocking retry banner without disabling the "Salvar" button.
4. **Privacy Invariant**:
   - `UNAVAILABILITY_REASON_EXPOSURE = NONE`.
   - The backend contract strictly omits private reasons (`ParticipantConflictDetail`).
   - Mobile domain models and UI declare zero reason fields, displaying only generic `"Indisponível"` labels.
5. **Robust Async Fencing**:
   - 300ms debounce on schedule time/date/duration changes.
   - `_conflictSequence` generation token fencing. Changing input parameters invalidates previous generations immediately (closing the debounce stale window).
   - Stale async responses across tenant switch or user logout are silently discarded.

---

## 2. Invariants & Product Boundaries

```text
CONFLICT_STATE_ARCHITECTURE = STRATEGY_A_CANDIDATE_MAP_WITH_CHUNKING
CONFLICT_PARTICIPANT_IDS_MAX = 50
MEMBER_LIST_LOADING = ALL
SELECTED_CONFLICT_COUNT_SCOPE = SELECTED_PARTICIPANTS_ONLY
REMOVED_PARTICIPANT_SELECTED_CONFLICT = CLEARED_SYNCHRONOUSLY
CONFLICT_WARNING_SAVE_POLICY = ADVISORY_ONLY
CONFLICT_CHECK_FAILURE_BLOCKS_SAVE = NO
SAVE_INDEPENDENT_FROM_CONFLICT_REQUEST = PASS
UNAVAILABILITY_REASON_EXPOSURE = NONE
PRIVATE_UNAVAILABILITY_REASON_RENDERED = NO
CONFLICT_DEBOUNCE_STALE_WINDOW = CLOSED
CONFLICT_TENANT_FENCING = PASS
CONFLICT_SESSION_FENCING = PASS
EDIT_MODE_CONFLICT_REEVALUATION = PASS
NATIVE_TEAMS = DEFERRED
NATIVE_SCHEDULE_TEMPLATES = DEFERRED
SCHEDULE_OVERLAP_DETECTION = DEFERRED
PERSISTED_CONFLICT_OVERRIDE = DEFERRED
MINISTRY_ONBOARDING_INVITES = DEFERRED
```

---

## 3. Implementation Progress Tracker

- [x] Phase 1: Baseline verification & active ExecPlan creation
- [x] Phase 2: Domain models & typed DTOs in `mobile/lib/features/availability/domain/schedule_conflict.dart`
- [x] Phase 3: Data access layer: `checkScheduleConflicts` in `AvailabilityRepository` & `HttpAvailabilityRepository`
- [x] Phase 4: `ScheduleFormNotifier` state & controller with generation fencing and Strategy A conflict engine
- [x] Phase 5: UI presentation: `ScheduleFormScreen` banners, badges, and `_MemberPickerSheet` indicators
- [x] Phase 6: Unit, widget, and async race tests in `mobile/test/`
- [x] Phase 7: Backend regression gates & Flutter verification
- [x] Phase 8: Commit & transition to pending independent review

---

## 4. Test Evidence & Verification Matrix

1. **Flutter Analysis**:
   - `flutter analyze`: `No issues found! (ran in 9.5s)`
2. **Repository Unit & Serialization Tests**:
   - `test/features/availability/data/schedule_conflict_repository_test.dart`: 9 tests passed.
3. **Controller Race & Fencing Tests**:
   - `test/features/schedules/presentation/controllers/schedule_form_conflict_test.dart`: 9 tests passed (debouncing, Races A/B/D, chunking, retry, advisory save).
4. **Widget & Privacy Tests**:
   - `test/features/schedules/presentation/views/schedule_form_conflict_widget_test.dart`: 5 tests passed (banners, badges, picker indicators, advisory save, privacy invariant).
5. **Full Mobile Regression Suite**:
   - `flutter test`: 664 tests passed across the entire mobile test suite.
6. **Backend Regression Suite**:
   - Vitest availability feature + IDOR tests: 56 tests passed in 11.31s.

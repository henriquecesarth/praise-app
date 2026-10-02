# ExecPlan: M12A — Mobile Member Management

- **Status**: COMPLETED
- **Branch**: `feat/mobile-m12` (authoritative baseline `feat/account-deletion-compliance`)
- **Scope**: Authorized ministry administrators/leaders manage members from Flutter mobile app; ordinary members remain read-only.
- **Reference**: Prompt M12A, AGENTS.md, MEMORY.md, docs/system-status.md

## Work Packages

- [x] **WP1: Backend Endpoints & Hardening**
  - Implement `GET /api/v1/ministries/:ministryId/members/:memberId` with `requireMinistryRole('member')`.
  - Anti-IDOR protection: return 404 fail-closed if member not in `ministryId`.
  - Privacy policy: if requester is not admin (and not subject), redact sensitive fields (`email`, `birth_date`).
  - Update `addMemberManuallySchema` in `ministry.types.ts` to support optional `roleIds: z.array(z.string()).optional()`.
  - Wire `roleIds` into `MinistryRepository.addMemberManually`.
  - Add backend unit and integration tests covering GET member by ID, anti-IDOR, privacy field redaction, and roleIds on create.
- [x] **WP2: Mobile Data Layer & Domain Models**
  - Extend `MembersRepository` / `HttpMembersRepository` with:
    - `getMemberById(ministryId, memberId)`
    - `addMember({ ministryId, name, email, role, birthDate, roleIds })`
    - `updateMember({ ministryId, memberId, name, email, birthDate, role, roleIds })`
    - `removeMember({ ministryId, memberId })`
  - Ensure `MinistryMember` domain model has `copyWith` and robust JSON parsing.
- [x] **WP3: Mobile Feature State & Controllers**
  - Create `MemberDetailNotifier` / `MemberDetailState` with tenant binding, loading, not-found (404), unauthorized (403), error, and remove actions.
  - Create `MemberFormNotifier` / `MemberFormState` handling create and edit modes, validation errors, duplicate-submit prevention, and authoritative refresh.
  - Register providers and ensure `resetAuthenticatedFeatures` clears all member management state.
- [x] **WP4: Mobile UI & Presentation**
  - `MemberDetailScreen`:
    - Responsive layout for phone and tablet.
    - Statuses: loading, not found (404), unauthorized (403), error with retry, success.
    - Privacy enforcement: ordinary members see only approved directory info; admins see authorized email, phone, account type.
    - Musical roles chips.
    - Admin action buttons: "Editar" and "Remover".
    - Destructive confirmation dialog before removal.
    - Tenant-switch listener to pop if active ministry changes.
  - `MemberFormDialog` (Add & Edit Member):
    - Clean form with Name, Email, Security Role (Membro/Admin), Birth Date picker, and Musical Roles multi-select.
    - Form validation, double-submit protection, error feedback.
  - `MembersDirectoryScreen`:
    - Add FAB for "Adicionar integrante" visible only to admins (`isViewerAdmin`).
    - Integrate "Gerenciar" navigation from `MemberDetailSheet` for admin viewers while preserving existing M11 bottom sheet behavior for ordinary members.
- [x] **WP5: Automated Tests & Validation**
  - Mobile tests covering:
    - Member detail loading, 404, 403, and success.
    - Admin controls visible for admin; absent for ordinary member.
    - Privacy: no private-field leakage to ordinary member.
    - Add member success and validation failure.
    - Edit member success.
    - Role management and musical roles assignment.
    - Remove member confirmation and success/failure handling.
    - Ministry switch race safety (discard stale responses, pop screens).
    - User switch reset.
    - Double submission prevention.
  - Backend tests covering:
    - GET member by ID happy path.
    - Anti-IDOR (404 for cross-tenant).
    - RBAC (non-member 403).
    - Privacy redaction for ordinary member viewer.
    - Adding member with `roleIds`.
- [x] **WP6: Final Verification & Manual Checklist**
  - Ran `flutter analyze` (0 issues).
  - Ran full `flutter test` (414 tests passing).
  - Ran backend build and tests (tsc code 0, 16 member-management & repository tests passing).
  - Ran web build and full test suite (400 tests passing).
  - Prepared physical-device test plan for Lenovo P11 Plus (unexecuted checklist).

---

## M12A-R2 Remediation (Security, Privacy, Soft-Removal & Tenant Fencing)

- **R2-1 & R2-2 (Strict Allowlist DTOs & Directory Privacy)**:
  - Eliminated broad object spreading (`{ ...member }`).
  - Peer view allowlist returns strictly `{ id, name, role, role_ids }`. Contact info (`email`, `phone`, `birth_date`), `user_id`, `is_manual`, `ministry_id`, and timestamps are omitted.
  - Self view determined strictly through linked authenticated user (`member.user_id && member.user_id === requestingUserId`) without `doc.id` fallback.
  - Admin view allowlist returns authorized management fields.
  - Applied viewer-aware DTO shaping to both `getMinistryMemberById` and `getMinistryMembers`.
- **R2-3 (Canonical roleIds Validation)**:
  - Added `validateRoleIds(ministryId, roleIds)` in `MinistryRepository`.
  - Normalizes and deduplicates IDs, queries `ministry_roles`, rejects unknown or cross-ministry role IDs with 400.
- **R2-4 (RBAC Privilege Escalation Prevention)**:
  - Prevents ordinary admins from promoting another member to admin (403), demoting an admin (403), or creating a member with admin role (403).
  - Assignment of `owner` role forbidden (403).
  - Protecting ministry owner from demotion or removal (400) and protecting last admin (400).
- **R2-5 (Transactional Soft-Removal & Quota Reversal)**:
  - `SubscriptionRepository.removeMemberTransactional` performs soft removal: `status: 'removed'`, `removed_at: now`, `updated_at: now` instead of document deletion.
  - Decrements `members_count` in `ministry_usage`.
  - Excludes soft-removed members from directory listing, usage calculations, member detail (404), and repeat removals (404).
  - Preserves Firebase Auth user and cross-ministry memberships intact.
- **R2-6 & R2-7 (Mobile Tenant Fencing & Mutation Guards)**:
  - `MemberDetailNotifier` and `MemberFormNotifier` carry tenant scope and token generation sequences.
  - Discards late Alpha responses on Beta switch (`seq != _requestSequence || state.ministryId != ministryId`).
  - Validates active tenant immediately before opening edit dialog or confirming removal.
  - Form dialog validates active tenant in `_submit()` and listens for tenant change to close immediately.
- **R2-8 (Session Reset)**:
  - `resetAuthenticatedFeatures` triggers `invalidateTenant()` and `reset()` on both `memberDetailNotifierProvider` and `memberFormNotifierProvider` and invalidates providers.
- **R2-9 (HTTP Error Classification)**:
  - Primary classification uses `e.statusCode == 404` for not found / anti-IDOR, and `e.statusCode == 403 || e.statusCode == 401` for restricted/unauthorized.
- **R2-10 (Automated Coverage & Verification)**:
  - 15 backend tests in `member-management.test.ts`.
  - 37 mobile tests in `test/features/members/`.
  - Full Flutter test suite: 414 tests passing. Full Web test suite: 400 tests passing. All builds clean.

## M12A-R4 Remediation (Active Membership Security Hardening)

- **R4-1 & R4-2 (Authorization Bypass Prevention & Tenant Membership Lookup)**:
  - `requireMinistryRole` middleware strictly filters out records where `memberData.status === 'removed'`. A removed member presenting an otherwise valid auth token immediately receives HTTP 403 `MINISTRY_ACCESS_DENIED`.
  - `getUserMinistries` excludes ministries where `membership.status === 'removed'`.
- **R4-3 & R4-5 (Availability Consumer Hardening)**:
  - `AvailabilityService.resolveCanonicalMembership`: throws 403 `MINISTRY_ACCESS_DENIED` if `memberData.status === 'removed'`.
  - `AvailabilityService.resolveMinistryMemberIds`: filters out `status === 'removed'`.
  - `AvailabilityService.listConsolidatedAvailability` & `resolveEligibleManualMembership`: throws 404 `MEMBER_NOT_FOUND` if target member has `status === 'removed'`.
- **R4-4 & R4-6 (Schedule Assignment & Participant Confirmation Hardening)**:
  - `ScheduleRepository.validateParticipantsActive`: throws 400 `REMOVED_MEMBER_ASSIGNMENT_DENIED` on new schedule creation or adding new participants to existing schedules if any participant is soft-removed.
  - Historical schedules with removed participants remain intact and viewable without breaking.
  - `ScheduleRepository.updateParticipantConfirmation`: throws 403 when a removed member attempts to accept/decline participation on an active schedule.
- **R4-7 (Notification Recipient Filtering)**:
  - `NotificationService.resolveParticipantUserIds` and `resolveMinistryMemberUserIds` explicitly ignore records where `status === 'removed'`. Historical notifications remain intact.
- **R4-8, R4-9 & R4-10 (Join/Leave, Manual Member Re-add & Linked Reactivation Policy - Finalized in R6)**:
  - Policy for manual members (R6-5): Each active manual membership is an independent membership resource identified strictly by its membership document ID. PII (name, email, phone, birth date) is not canonical identity. Two distinct manual memberships may legitimately share an email. A removed manual record remains historical. Adding a manual member always creates a new record transactionally. No ambiguous fuzzy matching, and `DUPLICATE_ACTIVE_MANUAL_MEMBER` is removed.
  - Policy for linked users (R4-10 & R6-4): `user_id` is their canonical identity. Reactivation transactionally reuses the existing membership document, clears `removed_at`, sets `status: 'active'`, and increments usage quota exactly once.
  - Linked reactivation role preservation (R6-4): "Linked reactivation preserves still-valid role assignments and drops obsolete role assignments." Historical `role_ids` are revalidated against canonical `ministry_roles` within the transaction; active valid roles are retained, while deleted or cross-ministry roles are dropped without failing the rejoin.
- **R4-11, R6-1 & R6-2 (Transactional Last-Active-Admin Invariant with OCC & Account Deletion Compliance)**:
  - In `SubscriptionRepository.removeMemberTransactional` and `MinistryRepository.updateMemberDetails`: atomic OCC locks verify that only active admins (`status !== 'removed'`) count towards the admin threshold. Two concurrent removal or demotion requests cannot both pass and leave zero admins.
  - Account deletion (`AccountDeletionRepository.findSoleAdminMinistries`): soft-removed former admins are excluded from candidate evaluation and active admin counts, ensuring accounts are not erroneously blocked by historical memberships.
- **R4-12 (Organization Authority Hardening)**:
  - `OrganizationRepository.isMinistryAdmin` strictly verifies `mData.role === 'admin' && mData.status !== 'removed'`.
- **R4-13 & R6-3 (Atomic roleIds Validation & Assignment)**:
  - In `SubscriptionRepository.addMemberTransactional` and `MinistryRepository.updateMemberDetails`, `role_ids` are atomically validated against `ministry_roles` within the Firestore transaction (`transaction.get`), guaranteeing consistency against concurrent role mutations.
- **R4-14 & R4-15 (Mobile Central Invalidation on Ministry Switch)**:
  - `AppShell` (`mobile/lib/app/shell/app_shell.dart`) centrally triggers `invalidateTenant()` on `memberDetailNotifierProvider`, `memberFormNotifierProvider`, and `scheduleFormNotifierProvider`, followed by `ref.invalidate(...)`, preventing stale data or leaked state across ministry changes.
- **R4-16, R6-9, R6-10 & R6-11 (Verification & Integration Coverage)**:
  - Dedicated real integration test suite `backend/src/features/ministries/active-membership-security.test.ts` (20 tests against local Firestore emulator):
    1. Mandatory R4-16 real integration test: active -> soft-removed -> same token -> 403 `MINISTRY_ACCESS_DENIED`.
    2. Read operations 403 after soft removal.
    3. `getUserMinistries` excludes soft-removed ministry.
    4. Availability endpoint rejects soft-removed member with 403.
    5. Schedule confirmation rejected with 403 for soft-removed member.
    6. Scheduling removed member rejected with 400 `REMOVED_MEMBER_ASSIGNMENT_DENIED`.
    7. Notifications exclude soft-removed member.
    8. Organization admin check excludes soft-removed admin.
    9. Manual member re-add creates separate record transactionally without double active duplicates.
    10. Multiple active manual members can legitimately share the same email (R6-5).
    11. Linked user re-add reactivates existing document, clears removed_at and increments usage quota once.
    12. Last active admin cannot be removed (400).
    13. Concurrent removal of last active admins safely rejected via OCC lock.
    14. Last active admin cannot be demoted to member.
    15. Atomic validation of roleIds within transaction.
    16. Ministry owner cannot be removed by anyone.
    17. Linked rejoin preserves still-valid role assignments and drops obsolete role assignments (R6-4).
    18. RoleIds update TOCTOU rejects invalid role IDs inside transaction (R6-3).
    19. Concurrent admin demotions safely prevented via OCC lock (R6-2).
    20. Account deletion findSoleAdminMinistries excludes removed admins and counts active admins correctly (R6-1).
  - Backend M12A-relevant suites: 256/256 passed across 14 test files.
  - Backend build: `npm --prefix backend run build` (tsc) passed with exit code 0.
  - Mobile tests: 414/414 passed (`flutter test`).
  - Mobile analyze: 0 issues (`flutter analyze`).
  - Web tests: 400/400 passed (`npm --prefix web test`).
  - Web build: `npm --prefix web run build` passed with exit code 0.

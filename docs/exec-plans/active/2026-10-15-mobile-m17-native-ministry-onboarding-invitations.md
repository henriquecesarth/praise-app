# ExecPlan: M17 — Native Ministry Onboarding & Invitations

- **Lifecycle**: ACTIVE
- **Status**: IMPLEMENTED — PENDING INDEPENDENT REVIEW
- **Branch**: `feat/mobile-m17`
- **Base SHA**: `1e9e127edfb7c5cc92f459a39f50a4a51ffaa085`
- **Scope**: Native Ministry Onboarding & Invitations in LouvAIO Mobile (Create Ministry, Join Ministry by Invite Code, Admin Invite Code Generation, Zero-Ministry First-Use UX, Existing User Entry Points in Switcher, Authoritative Context Convergence via `refreshAndSelect`, Robust Multi-Session & Tenant Fencing, Duplicate Submit Protection).
- **Reference**: AGENTS.md, MEMORY.md, docs/system-status.md, docs/mobile/architecture.md, backend/src/features/ministries/

---

## 1. Problem Statement & Architecture Goals

LouvAIO Mobile currently supports comprehensive musician and administrative workflows (schedules, repertoire, availability, liturgies, smart chords, members directory). However, a brand-new user who installs the standalone APK and registers is stranded on `MinistryEmptyScreen` with zero options to create or join a ministry. Furthermore, existing administrators cannot generate or share invitation codes from the mobile app.

### Architectural Goals:
1. **Zero-Ministry Self-Service Onboarding**:
   - Transform `MinistryEmptyScreen` to present clear, accessible CTAs: "Criar ministério" and "Entrar com código de convite".
   - Allow a new user to register, create or join a ministry, and enter `AppShell` with full functionality without ever opening the web app.
2. **Create Ministry (`POST /api/v1/ministries`)**:
   - Provide `CreateMinistrySheet` with validation (`name` 1..100 chars, trimmed).
   - Duplicate submit protection: synchronous loading guard and disabled submit.
   - Post-creation authoritative context convergence via `refreshAndSelect(newMinistryId)`.
   - Distinct partial failure handling: if creation succeeds server-side but subsequent context refresh encounters temporary failure, provide safe context refresh retry without repeating `POST /ministries`.
3. **Join Ministry by Code (`POST /api/v1/ministries/join`)**:
   - Provide `JoinMinistrySheet` with normalized code entry (`trim`, `toUpperCase`).
   - Graceful PT-BR error mapping for invalid, expired, max uses reached, or quota exceeded (`PLAN_MEMBER_QUOTA_REACHED`).
   - Idempotent active-member handling.
   - Authoritative context convergence via `refreshAndSelect(joinedMinistryId)`.
4. **Existing-User Entry Points**:
   - Add "Criar novo ministério" and "Entrar com código" actions in `MinistrySwitcherSheet`.
5. **Admin Invite Generation (`POST /api/v1/ministries/:ministryId/invites`)**:
   - Provide admin-only action "Convidar integrante" in `MembersDirectoryScreen`.
   - Generate standard 7-day invite code (`PR-XXXXXX`).
   - Display code in `InviteCodeSheet` with copy-to-clipboard (`Clipboard.setData`).
   - Strict tenant fencing: discard invite display if active tenant switches during in-flight generation.
   - Strict server RBAC authority: gracefully handle HTTP 403 on admin demotion.
6. **Session & Tenant Fencing**:
   - Enforce generation and user session fencing across all async operations.
   - Discard mutation results across logout or User A -> User B switches (`MutationOutcome.discarded`).

---

## 2. Invariants & Product Boundaries

```text
CREATE_MINISTRY = INCLUDED
JOIN_BY_CODE = INCLUDED
INVITE_GENERATION = INCLUDED
ZERO_MINISTRY_ONBOARDING = INCLUDED
EXISTING_USER_ENTRY_POINTS = INCLUDED
CONTEXT_CONVERGENCE = AUTHORITATIVE_REFRESH_AND_SELECT
CREATE_DUPLICATE_SUBMIT_PROTECTION = PASS
JOIN_DUPLICATE_SUBMIT_PROTECTION = PASS
INVITE_DUPLICATE_SUBMIT_PROTECTION = PASS
CREATE_POST_SUCCESS_REFRESH_RETRY_DOES_NOT_REPEAT_CREATE = PASS
JOIN_POST_SUCCESS_REFRESH_RETRY = PASS
CREATE_POST_AWAIT_SESSION_FENCING = PASS
JOIN_POST_AWAIT_SESSION_FENCING = PASS
INVITE_POST_AWAIT_TENANT_FENCING = PASS
DIRECT_USER_SWITCH_FENCING = PASS
REFRESH_AND_SELECT_SESSION_FENCING = PASS
REFRESH_AND_SELECT_TARGET_MISSING = FAIL_SAFE
INVITE_SERVER_RBAC_AUTHORITY = PRESERVED
INVITE_CODE_LOGGING = NONE
INVITE_DEEP_LINKS = DEFERRED
INVITE_REVOCATION = DEFERRED
CUSTOM_INVITE_EXPIRATION = DEFERRED
MINISTRY_SETTINGS_EDITION = DEFERRED
LEAVE_MINISTRY_UI = DEFERRED
DELETE_MINISTRY_UI = DEFERRED
NATIVE_TEAMS = DEFERRED
SCHEDULE_TEMPLATES = DEFERRED
BACKEND_SOURCE_CHANGE = NO
WEB_SOURCE_CHANGE = NO
FIRESTORE_INDEX_CHANGE = NO
FIRESTORE_RULE_CHANGE = NO
BACKEND_DEPLOY_REQUIRED = NO
NEW_MOBILE_DEPENDENCY = NO
```

---

## 3. Implementation Progress Tracker

- [x] Phase 1: Baseline verification & active ExecPlan creation
- [x] Phase 2: Domain models & typed DTOs (`MinistryInvite`, `JoinMinistryResult`, `OnboardingMutationResult<T>`)
- [x] Phase 3: Data access layer: `createMinistry`, `joinMinistryByCode`, `createInviteCode` in `MinistryRepository` & `HttpMinistryRepository`
- [x] Phase 4: `MinistryContextNotifier` extension: `refreshAndSelect(targetMinistryId)` with session fencing & safe error handling
- [x] Phase 5: Mutation controllers:
  - `CreateMinistryNotifier` with duplicate submit guard & partial refresh error isolation
  - `JoinMinistryNotifier` with duplicate submit guard & partial refresh error isolation
  - `InviteCodeNotifier` with tenant fencing & admin RBAC handling
- [x] Phase 6: UI Presentation:
  - `CreateMinistrySheet`
  - `JoinMinistrySheet`
  - `InviteCodeSheet`
  - Updated `MinistryEmptyScreen` with primary CTAs
  - Updated `MinistrySwitcherSheet` with create/join actions
  - Updated `MembersDirectoryScreen` with admin invite action
- [x] Phase 7: Automated unit, controller, widget, and async race tests (`mobile/test/`)
- [x] Phase 8: Static analysis (`flutter analyze`), full test suite (`flutter test`), and backend verification
- [ ] Phase 9: Commit & transition to pending independent review

---

## 4. Test Evidence & Verification Matrix

### Static Analysis
- Command: `flutter analyze`
- Result: **0 issues found!** (ran in 13.9s)

### Targeted M17 Test Suites
1. Data Layer (`ministry_repository_onboarding_test.dart`):
   - `createMinistry` POST /ministries with name returns created Ministry on 201 Created (PASS)
   - `createMinistry` unwraps nested `{ data: {...} }` response if returned (PASS)
   - `createMinistry` maps 400 Bad Request with PT-BR message (PASS)
   - `joinMinistryByCode` POST /ministries/join with uppercase code returns JoinMinistryResult on 200 OK (PASS)
   - `joinMinistryByCode` maps 404 to invalid/expired code message (PASS)
   - `createInviteCode` POST /ministries/:id/invites returns MinistryInvite on 201 Created (PASS)
   - `createInviteCode` maps 403 Forbidden to permission error (PASS)
   - Total: **7/7 passed**

2. Presentation Controllers (`onboarding_controllers_test.dart`):
   - `CreateMinistryNotifier` name validation: blank, whitespace, >100 chars (PASS)
   - `CreateMinistryNotifier` duplicate submit guard: concurrent calls make at most 1 call (PASS)
   - `CreateMinistryNotifier` happy path: creates, converges context, transitions to ready (PASS)
   - `CreateMinistryNotifier` `CREATE_POST_SUCCESS_REFRESH_RETRY_DOES_NOT_REPEAT_CREATE`: partial failure retries convergence without re-POST (PASS)
   - `CreateMinistryNotifier` session fencing: in-flight create discarded on session reset (User A -> User B) (PASS)
   - `JoinMinistryNotifier` normalizes input: trims and uppercase (PASS)
   - `JoinMinistryNotifier` duplicate submit guard: concurrent calls make at most 1 call (PASS)
   - `JoinMinistryNotifier` `JOIN_POST_SUCCESS_REFRESH_RETRY`: partial failure retries convergence without re-POSTing join (PASS)
   - `JoinMinistryNotifier` session fencing: in-flight join discarded on reset (PASS)
   - `InviteCodeNotifier` generateInvite calls repository and updates state with 7-day expiration (PASS)
   - `InviteCodeNotifier` tenant switch fencing: reset wipes active invite and increments sequence (PASS)
   - `InviteCodeNotifier` tenant switch during generation: response for Alpha discarded after switch to Beta (PASS)
   - `InviteCodeNotifier` maps 403 to administrator permission error (PASS)
   - Total: **13/13 passed**

3. Presentation & Widgets (`onboarding_widgets_test.dart`):
   - `MinistryEmptyScreen` renders primary CTAs and opens sheets (PASS)
   - `CreateMinistrySheet` renders form, validates, and submits successfully (PASS)
   - `JoinMinistrySheet` validates input and handles submission (PASS)
   - `MinistrySwitcherSheet` renders action tiles and opens sheets (PASS)
   - `InviteCodeSheet` displays generated code and copies to clipboard (PASS)
   - Total: **5/5 passed**

### Mobile Full Regression Test Suite
- Command: `flutter test`
- Baseline: 664 tests
- M17 Suite: +25 tests
- Final Result: **689/689 passed, 0 failures!** (ran in 3m 28s)

### Backend Build Gate
- Command: `npm --prefix backend run build`
- Result: **Clean build (`tsc` exited with code 0)**

---

## 5. Mobile Standalone Capability Verification

With M17 implemented:
```text
MOBILE_STANDALONE_ONBOARDING = COMPLETE
NEW_ADMIN_STANDALONE_FLOW = COMPLETE (Register/Login -> MinistryEmptyScreen -> "Criar ministério" -> Modal -> POST /ministries -> refreshAndSelect -> AppShell with Admin Role)
NEW_MEMBER_STANDALONE_FLOW = COMPLETE (Register/Login -> MinistryEmptyScreen -> "Entrar com código" -> Modal -> POST /ministries/join -> refreshAndSelect -> AppShell with Member Role)
EXISTING_ADMIN_INVITE_GENERATION = COMPLETE (MembersDirectoryScreen -> "Convidar integrante" -> Modal -> POST /ministries/:id/invites -> PR-XXXXXX -> Copy to Clipboard)
EXISTING_USER_CREATE_JOIN = COMPLETE (MinistrySwitcherSheet -> "Criar novo ministério" / "Entrar com código")
```
No visit to Web/PWA required for basic ministry lifecycle.

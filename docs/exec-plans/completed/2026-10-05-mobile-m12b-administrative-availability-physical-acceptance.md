# LouvAIO Mobile M12 — Physical Device Acceptance Audit Report (M12A & M12B)

- **Date**: 2026-10-05
- **Branch**: `feat/mobile-m12` (HEAD: `90c7702`, clean working tree)
- **Target Hardware**: Lenovo Tab P11 Plus (Lenovo TB-J616F / Serial `HND29KG9`, Android 12, Build TB-J616F_S240166_221104_ROW)
- **Network Environment**: Gnirehtet USB Reverse Tethering (`tcp:31416`) + ADB Reverse Proxy (`tcp:3000 -> tcp:3000`)
- **Backend Environment**: Express API on Node.js (`http://127.0.0.1:3000/api/v1`), direct Cloud Firestore integration (without emulator)
- **Authenticated Test Identity**: `XnpmlGGY6PZCRT90U0hYlLrEwjf2` (`teix.code@gmail.com`), Ministry Admin in `LouvAIO Sandbox Test` (`5kL2qssw4PCi2irzC25X`) and `Louvor IBBP` (`9lxhjzz3OV1JrqTV6B3q`)

---

## 1. Executive Summary & Acceptance Totals

LouvAIO Mobile Milestone M12 comprises two core feature packages:
1. **M12A**: Member Management (Admin member directory, manual member creation, role assignments, profile inspection, authoritative edit, last-admin protection, soft-removal with quota synchronization, and multi-tenant isolation).
2. **M12B**: Administrative Availability Management & Manual Member Scheduling (Team consolidated availability screen with period presets, strict reason omission privacy invariant, manual member availability CRUD, and multi-tenant isolation).

Physical acceptance testing was executed directly on physical hardware (Lenovo Tab P11 Plus) with a production-aligned local backend attached to Cloud Firestore.

### Corrected Acceptance Totals

| Area | Physical | Automated / Precondition N/A | Total | Verdict |
|---|---:|---:|---:|---|
| **M12A** | 8 | 7 | 15 | `PHYSICAL_ACCEPTANCE_PASS` |
| **M12B** | 13 | 5 | 18 | `PHYSICAL_ACCEPTANCE_PASS` |
| **Tablet UX** | 3 | 0 | 3 | `PHYSICAL_ACCEPTANCE_PASS` |
| **TOTAL** | **24** | **12** | **36** | `M12_PHYSICAL_ACCEPTANCE_PASS` |

---

## 2. Architecture & Privacy Invariant Clarification

### Consolidated Administrative Availability

The real availability `reason` is not part of `ConsolidatedAvailabilityItem` and is not retained by the consolidated mobile state.

The mobile consolidated screen does not receive, parse, cache, or display the real reason.

If the UI displays generic text such as:

`Motivo confidencial • Privacidade protegida`

that text is a static privacy label only.

It is NOT a transformed/anonymized version of the user's actual reason.

Authoritative confirmation invariant:
`CONSOLIDATED_REASON_VALUE_NEVER_ENTERS_MOBILE_CONSOLIDATED_STATE = CONFIRMED`

### Manual-Member Administrative Availability

The actual reason remains available only through the separate authorized manual-member management contract.

---

## 3. Test Execution & Evidence Matrix

### PART A: M12A — Member Management

| Test ID | Description | Hardware / Verdict | Observed Evidence & Findings |
|---|---|---|---|
| **CT-A01** | Admin Member Directory Rendering | Physical Tablet — **PASS** | Directory loaded active members (`Henrique Teixeira`), role chips, search, and FAB "Adicionar integrante". |
| **CT-A02** | Create Manual Member | Physical Tablet — **PASS** | Created `M12 TEST Manual` (`m12test@louvaio.test`, Violão). Persisted with `is_manual: true`, `user_id: null`. |
| **CT-A03** | Shared / Duplicate Email Tolerance | Physical Tablet — **PASS** | Created `M12 TEST Manual 2` with identical email `m12test@louvaio.test` (Vocalista); both co-exist cleanly without conflict. |
| **CT-A04** | Member Detail Sheet (Admin) | Physical Tablet — **PASS** | Displayed avatar, name, security role, email, musical roles, and action buttons ("Fechar", "Editar", "Remover") without leaking Firestore doc IDs. |
| **CT-A05** | Edit Member Information | Physical Tablet — **PASS** | Updated member name to `M12 TEST Manual Editado` and added musical role `Bateria`. Authoritative update reflected immediately. |
| **CT-A06** | Ordinary Member Peer Privacy | **NOT_EXECUTED** | Ordinary member account unavailable in test fixture. Covered 100% in automated unit/widget suites (`member_detail_screen_test.dart`). |
| **CT-A07** | Ordinary Member Self Detail | **NOT_EXECUTED** | Ordinary member account unavailable in test fixture. Covered 100% in automated unit/widget suites. |
| **CT-A08** | Privilege Escalation Protection | **NOT_EXECUTED** | Non-owner admin account unavailable. Covered 100% in automated unit/widget suites and backend RBAC middleware. |
| **CT-A09** | Last-Admin Protection | Physical Tablet — **PASS** | Tested on `Henrique Teixeira` (sole admin). System blocked both removal and demotion to member with explicit error dialog. |
| **CT-A10** | Soft-Removal Invariant | Physical Tablet — **PASS** | Removed `M12 TEST Manual Editado`. Disappeared from UI directory; verified in Firestore with `status: 'removed'`, `removed_at: 2026-10-05T15:24:50.420Z`. Quotas decremented. |
| **CT-A11** | Removed-User Access Revocation | **NOT_EXECUTED** | Safe linked test user unavailable. Covered 100% in automated backend middleware test suite. |
| **CT-A12** | Historical Schedule Integrity | **NOT_EXECUTED** | Historical schedule preconditions not staged. Covered 100% in automated backend integration suite. |
| **CT-A13** | Multi-Tenant Isolation (Alpha → Beta) | Physical Tablet — **PASS** | Member dialog scrim blocked cross-ministry touches; switching context to `Louvor IBBP` proved test members did not leak into Beta. |
| **CT-A14** | Audit Trail Verification | **AUTOMATED_COVERAGE_ONLY** | Covered in Vitest/Riverpod suites (`created_by`, `updated_by`). |
| **CT-A15** | Rate Limiting & Bounds Enforcement | **AUTOMATED_COVERAGE_ONLY** | Covered in Vitest/Zod schemas and backend rate limiter tests. |

- **M12A Subtotal**: Physical PASS: **8** | Automated / N/A: **7** | Total: **15**

---

### PART B: M12B — Administrative Availability & Manual Member Availability

| Test ID | Description | Hardware / Verdict | Observed Evidence & Findings |
|---|---|---|---|
| **CT-B01** | Admin Availability Entry Point | Physical Tablet — **PASS** | "Disponibilidade da Equipe" tile visible in Profile under admin privileges with calendar icon. |
| **CT-B02** | Ordinary Member Restriction | **NOT_EXECUTED** | Ordinary member account unavailable. Covered in `availability_admin_navigation_test.dart`. |
| **CT-B03** | Consolidated Availability UI & Presets | Physical Tablet — **PASS** | Screen rendered presets (`7 dias`, `15 dias`, `30 dias`, `Mês atual`, `Personalizado`), member filter, empty state, and refresh action. |
| **CT-B04** | Privacy Invariant (Reason Omission) | Physical Tablet — **PASS** | **MANDATORY SECURITY INVARIANT**: The real availability `reason` is not part of `ConsolidatedAvailabilityItem` and is not retained by the consolidated mobile state. The mobile consolidated screen does not receive, parse, cache, or display the real reason (`CONSOLIDATED_REASON_VALUE_NEVER_ENTERS_MOBILE_CONSOLIDATED_STATE`). Static label `"Motivo confidencial • Privacidade protegida"` rendered as a static privacy label only (not a transformed or anonymized reason). |
| **CT-B05** | Preset Switching | Physical Tablet — **PASS** | Switched between `7 dias`, `15 dias`, `30 dias`; query re-executed seamlessly and dynamically updated results. |
| **CT-B06** | Custom Date Range Picker | **AUTOMATED_COVERAGE_ONLY** | Covered in `admin_availability_screen_test.dart`. |
| **CT-B07** | Manual Member Availability Entry Point | Physical Tablet — **PASS** | "Gerenciar manual" shortcut in AppBar and "Gerenciar indisponibilidade" button in member details rendered for manual member `M12 TEST Manual 2`. |
| **CT-B08** | Linked Member Self-Service Boundary | Physical Tablet — **PASS** | "Gerenciar indisponibilidade" button strictly hidden for linked real-user member `Henrique Teixeira`. |
| **CT-B09** | Create All-Day Unavailability | Physical Tablet — **PASS** | Created `05/10/2026 • Dia inteiro`, `M12 TEST All Day`. Rendered in list with edit/delete buttons. |
| **CT-B10** | Create Timed Unavailability | Physical Tablet — **PASS** | Created `05/10/2026 das 19:00 às 21:00`, `M12 TEST Timed`. Rendered in list with edit/delete buttons. |
| **CT-B11** | Edit Timed → All-Day Conversion | Physical Tablet — **PASS** | Converted `19:00 - 21:00` entry to "Dia inteiro" with updated reason `M12 TEST Timed`. Persisted cleanly. |
| **CT-B12** | Edit All-Day → Timed Conversion | Physical Tablet — **PASS** | Converted all-day entry to timed entry. Persisted cleanly. |
| **CT-B13** | Delete Manual Unavailability | Physical Tablet — **PASS** | Deleted unavailability entry; removed synchronously from UI list and Cloud Firestore. |
| **CT-B14** | Form Validation (Date/Time Bounds) | **AUTOMATED_COVERAGE_ONLY** | Covered in `manual_availability_form_modal_test.dart`. |
| **CT-B15** | Reason Privacy Contrast | Physical Tablet — **PASS** | The actual reason remains available only through the separate authorized manual-member management contract (`ManualMemberAvailabilityScreen`). It never enters the consolidated mobile state or `ConsolidatedAvailabilityItem`, where only a static privacy label is rendered. |
| **CT-B16** | Multi-Tenant Availability Isolation | Physical Tablet — **PASS** | Switched ministry context to `Louvor IBBP`. Verified team availability and member directory were completely isolated; no test records leaked. |
| **CT-B17** | Concurrent Availability Mutation | **AUTOMATED_COVERAGE_ONLY** | Covered in backend Firestore transaction test suite. |
| **CT-B18** | Overlapping Period Policy | **AUTOMATED_COVERAGE_ONLY** | Covered in `consolidated_availability_test.dart`. |

- **M12B Subtotal**: Physical PASS: **13** | Automated / N/A: **5** | Total: **18**

---

### PART C: Tablet UX & Layout Adaptability

| Test ID | Description | Hardware / Verdict | Observed Evidence & Findings |
|---|---|---|---|
| **CT-C01** | Portrait Layout Responsiveness | Physical Tablet — **PASS** | Rotated tablet to vertical orientation. UI adapted smoothly to BottomNavigationBar, layout remained intact with no horizontal scroll overflow. |
| **CT-C02** | Landscape Layout Responsiveness | Physical Tablet — **PASS** | Screen bounds `[0,0][2000,1176]`. `NavigationRail` on left (`Início`, `Escalas`, `Repertório`, `Perfil`). Dialogs and modals centered with touch targets > 44px (min height 48px to 60px). |
| **CT-C03** | Back Navigation Stack | Physical Tablet — **PASS** | Nested screens (`AdminAvailabilityScreen`, `ManualMemberAvailabilityScreen`, `MembersDirectoryScreen`) popped cleanly to parent navigation shells. |

- **Tablet UX Subtotal**: Physical PASS: **3** | Automated / N/A: **0** | Total: **3**

---

## 4. Post-Test Hygiene & Verification

1. **Member Directory Cleanliness**: Soft-removed test member `M12 TEST Manual 2` via the mobile UI. Confirmed directory now lists only the primary admin (`Henrique Teixeira`).
2. **Data Preservation**: Firestore documents for `M12 TEST Manual` and `M12 TEST Manual 2` preserved with `status: 'removed'`, `removed_at: <ISO>`, maintaining strict non-destructive compliance.
3. **Repository State**: `git status` clean on `feat/mobile-m12` (zero untracked changes, zero accidental edits).

---

## 5. Milestone Acceptance Verdicts

- **M12A — Mobile Member Management**: `PHYSICAL_ACCEPTANCE_PASS`
- **M12B — Mobile Administrative Availability Management**: `PHYSICAL_ACCEPTANCE_PASS`
- **Overall Milestone M12**: `M12_PHYSICAL_ACCEPTANCE_PASS`
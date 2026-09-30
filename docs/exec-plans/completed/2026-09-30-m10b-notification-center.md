# ExecPlan: M10B — Mobile V1.1 Notification Center & Business Triggers

Status: COMPLETED
Owner: feature-engineer
Baseline: 43c690f

## 1. Objectives
- Implement persistent user notifications (`user_notifications` Firestore collection).
- Deterministic deduplication via `dedupe_key`.
- Lock-screen safe copy only (privacy-safe, zero comment text / participant lists).
- Best-effort FCM push delivery (core business mutations never fail or rollback).
- Business triggers: `schedule_assigned`, `schedule_updated` (material fields only), `schedule_comment`, `announcement`.
- Authenticated user notification REST endpoints under `/api/v1/auth/notifications`.
- Mobile Notification Center with bell icon, unread badge, list, pull-to-refresh, mark read, and tenant-safe deep linking.
- Account deletion (PC1) integration to purge notifications and devices.
- Physical verification on Lenovo TB-J616F (Android 12).

## 2. Architecture & Invariants
- Route context / auth context is the sole authority for tenant isolation and ownership.
- Notifications query filtered by `user_id == req.user.id`.
- Anti-IDOR: any notification mutation checking ownership fails closed with 404.
- No push or deployment. Single local commit at completion.

## 3. Physical Acceptance & Verification
- Lenovo TB-J616F / Android 12:
  - App launched cleanly, authenticated with test account.
  - Device registered FCM token with backend.
  - Notification Bell rendered in AppBar with real-time unread badge.
  - Notification Center displayed empty state and notifications list.
  - Dispatch triggered via `NotificationService`:
    - Push delivered to device in foreground.
    - Badge updated in real-time to 1.
    - Notification Center rendered `Nova escala atribuída` item.
    - Tap on item marked notification as read in Firestore and navigated to `ScheduleDetailView`.
    - Returning back showed unread badge cleared (0).
  - All test suites green:
    - Mobile: 318 / 318 passed.
    - Backend: notifications feature tests 14 / 14 passed; build successful.
    - Web: 400 / 400 passed (24 test files); build successful.

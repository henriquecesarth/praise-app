# ExecPlan: M13 — Native Liturgies

- **Status**: COMPLETED
- **Branch**: `feat/mobile-m13` (Base SHA: `03a0c10a30b42c672b1aa258c7344eeb9c0a6b7d`)
- **Scope**: Native mobile liturgy experience (M13A member view + M13B admin CRUD), repertoire integration, backend liturgy security audit, write atomicity, and cross-tenant song-reference validation.
- **Reference**: Prompt M13, AGENTS.md, MEMORY.md, docs/system-status.md

---

## 1. Problem Statement & Architecture Goals

Liturgies (orders of service / "ordem de culto") represent planned worship service itineraries containing structured items (songs, readings, prayers, and custom items).
While web has a liturgy view (`LiturgiesView.tsx`), the native Flutter mobile client has no liturgy capabilities. Furthermore, backend liturgy operations currently lack:
1. Cross-tenant song-reference validation (an admin in Ministry A could reference a song ID from Ministry B, or an invalid ID).
2. Write atomicity (creation, updates, and deletes perform non-atomic sequential writes that can leave orphan items or inconsistent records on failure).
3. SongId format flexibility (Zod schema enforced `uuid()`, whereas Firestore generates 20-character base62 IDs).
4. Native mobile member experience (M13A: read-only liturgy list and item inspection with repertoire song navigation).
5. Native mobile admin CRUD (M13B: create, edit, reorder items, select songs from repertoire, delete with confirmation).

---

## 2. Work Packages

- [x] **WP1: Backend Liturgy Security, Atomicity & Song Validation**
  - Schema adjustments in `liturgy.types.ts`:
    - Relax `songId: z.string().uuid()` to support Firestore document IDs (`z.string().min(1).max(100)`).
    - Support both `songId` and `song_id`.
    - Bounds and trimming for `title`, `notes`, `description`.
  - Atomicity in `LiturgyRepository`:
    - `createLiturgy`: Batch write for liturgy document + all `liturgy_items`.
    - `updateLiturgy`: Batch write for liturgy update + old items deletion + new items insertion.
    - `deleteLiturgy`: Batch write for deleting liturgy document + all `liturgy_items`.
  - Cross-Tenant Song-Reference Validation:
    - Validate that every referenced song belongs to `groupId` / `ministryId` (`songDoc.data()?.ministry_id === groupId`).
    - Reject cross-tenant or missing song references fail-closed.
    - Ensure `getLiturgiesByGroup` also checks `ministry_id === groupId` when enriching song data.
  - Comprehensive backend Vitest integration tests in `liturgy.feature.test.ts` (19 passing tests).

- [x] **WP2: Mobile Liturgy Domain & Data Layer**
  - Domain models in `mobile/lib/features/liturgies/domain/`:
    - `liturgy.dart`: `Liturgy`, `LiturgyItem`, item types (`song`, `reading`, `prayer`, `custom`).
    - JSON serialization and deserialization, copyWith, equality.
  - Data repository in `mobile/lib/features/liturgies/data/`:
    - `liturgy_repository.dart`: `LiturgyRepository` abstract class & `HttpLiturgyRepository` implementation via Dio.
    - Full error mapping to `AppFailure`.

- [x] **WP3: Mobile Feature State & Controllers**
  - Controllers in `mobile/lib/features/liturgies/presentation/controllers/`:
    - `liturgy_list_controller.dart`: `LiturgyListState`, `LiturgyListNotifier` with tenant switch / stale response fencing.
    - `liturgy_detail_controller.dart`: `LiturgyDetailState`, `LiturgyDetailNotifier`.
    - `liturgy_form_controller.dart`: `LiturgyFormState`, `LiturgyFormNotifier` for create/update/delete with double-submit protection.
    - `liturgy_providers.dart`: Riverpod providers.
  - Wire into `resetAuthenticatedFeatures` in `mobile/lib/app/providers.dart`.

- [x] **WP4: M13A Member Liturgy Experience (Mobile UI)**
  - `LiturgiesScreen`:
    - Full responsive support (Phone BottomNav / Tablet NavigationRail).
    - States: loading shimmer/spinner, empty state with clear guidance, error state with "Tentar novamente", success state.
    - Cards with civil date formatting, item counts, song counts.
    - Pull-to-refresh.
    - Tenant-switch listener (reload/pop if ministry changes).
  - `LiturgyDetailScreen`:
    - Detailed header (title, date, description).
    - Ordered itinerary items with visual indicators per type (Music for song, Book for reading, etc.).
    - Song items tap-through opens `SongDetailView` (repertoire integration).
    - Admin-only Edit & Delete buttons.

- [x] **WP5: M13B Admin CRUD & Repertoire Integration**
  - `LiturgyFormScreen`:
    - Create and Edit modes.
    - Title, Date, Description fields.
    - Reorderable list of items.
    - Song picker integrated with `RepertoireRepository`.
    - Manual item types (reading, prayer, custom) with notes/instructions.
    - Double-submit prevention.
  - Deletion confirmation dialog with destructive styling and double-submit guard.
  - Navigation links:
    - Profile tile ("Liturgias") in `app_shell.dart`.
    - Dashboard button in `dashboard_view.dart`.

- [x] **WP6: Automated Tests, Quality & Physical Pre-acceptance Checklist**
  - Vitest backend tests covering RBAC, anti-IDOR, write atomicity, and cross-tenant validation (42/42 PASS).
  - Flutter unit and widget tests covering list, detail, form, song navigation, admin/member permissions, tenant switch (26/26 PASS).
  - Flutter analyze PASS, Flutter full suite (509/509 PASS).
  - Web unit tests (400/400 PASS) and build PASS.
  - Clean diff check.

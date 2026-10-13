const fs = require('fs');
const content = `#ExecPlan: M13 — Native Liturgies

- **Status**: COMPLETED & CLOSED
- **Branch**: `feat/mobile-m13` (Base SHA: `03a0c10a30b42c672b1aa258c7344eeb9c0a6b7d`)
- **Code Review Status**: PASS
- **Physical Acceptance**: M13_PHYSICAL_ACCEPTANCE_PASS
- **Overall Verdict**: M13_PHYSICAL_ACCEPTANCE_PASS
- **Lifecycle**: CLOSED
- **Scope**: Native mobile liturgy experience (M13A member view + M13B admin CRUD), repertoire integration, backend liturgy security audit, write atomicity, and cross-tenant song-reference validation.
- **Reference**: Prompt M13, AGENTS.md, MEMORY.md, docs/system-status.md

---

## 1. Problem Statement & Architecture Goals

Liturgies (orders of service / "ordem de culto") represent planned worship service itineraries containing structured items (songs, readings, prayers, and custom items).
While web has a liturgy view (`LiturgiesView.tsx`), the native Flutter mobile client previously lacked liturgy capabilities. Furthermore, backend liturgy operations required hardening:
1. Cross-tenant song-reference validation (an admin in Ministry A cannot reference a song ID from Ministry B, or an invalid ID).
2. Write atomicity (creation, updates, and deletes perform Firestore batch writes ensuring zero orphan items or inconsistent records on failure).
3. SongId format validation (strict Firestore document ID format, rejecting path-like strings).
4. Native mobile member experience (M13A: read-only liturgy list and item inspection with repertoire song navigation).
5. Native mobile admin CRUD (M13B: create, edit, deterministic item reordering with downward compensation, song selection from repertoire, deletion with confirmation).

---

## 2. Work Packages & Execution Summary

- [x] **WP1: Backend Liturgy Security, Atomicity & Song Validation**
  - Schema adjustments in `liturgy.types.ts`:
    - Support Firestore document IDs (`ze.string().min(1).max(100)`), rejecting path traversal and slashes.
    - Support canonical `songId` and legacy `song_id`.
    - Strict Gregorian-calendar date validation (`YYYY-MM-DD`).
    - Non-song items enforce `song_id = null`.
    - Bounds and trimming for `title`, `notes`, `description`.
  - Atomicity in `LiturgyRepository`:
    - `createLiturgy`: Batch write for liturgy document + all `liturgy_items`.
    - `updateLiturgy`: Batch write for liturgy update + old items deletion + new items insertion.
    - `deleteLiturgy`: Batch write for deleting liturgy document + all `liturgy_items`.
  - Cross-Tenant Song-Reference Validation:
    - Validate that every referenced song strictly belongs to `groupId` / `ministryId` (`songDoc.data()?.ministry_id === groupId`).
    - Reject cross-tenant or missing song references fail-closed.
    - `getLiturgiesByGroup` and `getLiturgyById` enforce strict tenant check before song data enrichment, preventing data leaks.
  - Active Membership & Anti-IDOR:
    - Cross-tenant reads, updates, and deletes fail closed with HTTP 404.
    - Removed members rejected via `requireActiveMinistryMembership`.

- [x] **WP2: Mobile Liturgy Domain & Data Layer**
  - Domain models in `mobile/lib/features/liturgies/domain/`:
    - `liturgy.dart`: `liturgy`, `LiturgyItem`, item types (`song`, `reading`, `prayer`, `custom`).
    - JSON serialization and deserialization, copyWith, equality.
  - Data repository in `mobile/lib/features/liturgies/data/`:
    - `liturgy_repository.dart`: `LiturgyRepository` abstract class & `HttpLiturgyRepository` implementation via Dio.
    - Full error mapping to `AppFailure`.

- [x] **WP3: Mobile Feature State & Controllers**
  - Controllers in `mobile/lib/features/liturgies/presentation/controllers/`:
    - `liturgy_list_controller.dart`: `LiturgyListState`, `LiturgyListNotifier` with tenant switch / stale response fencing.
    - `liturgy_detail_controller.dart`: `liturgyDetailState`, `LiturgyDetailNotifier`.
    - `liturgy_form_controller.dart`: `LiturgyFormState`, `liturgyFormNotifier` for create/update/delete with generation fencing and double-submit protection.
    - `liturgy_providers.dart`: Riverpod providers.
  - Wires into `resetAuthenticatedFeatures` in `mobile/lib/app/providers.dart` on logout.

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
    - Song items tap-through opens existing native `SongDetailScreen` (repertoire integration).
    - Admin-only Edit & Delete buttons.

- [x] **UP5: M13B Admin CRUD & Repertoire Integration**
  - `LiturgyFormScreen`:
    - Create and Edit modes.
    - Title, Date (native date picker), Description fields.
    - Reorderable list of items with downward adjustment (`newIndex -= 1`).
    - Song picker integrated with `RepertoireRepository`.
    - Manual item types (reading, prayer, custom) with notes/instructions.
    - Automatic clearing of song references when switching from song to non-song item type.
    - Double-submit prevention.
  - Deletion confirmation dialog with destructive styling and double-submit guard.
  - Navigation links:
    - Profile tile ("Liturgias & Roteiros") in `app_shell.dart`.
    - Dashboard button in `dashboard_view.dart`.

- [x] **WP6: Automated Verification Gates**
  - Backend focused tests: 51/51 PASS.
  - Backend build: PASS (`'npm --prefix backend run build`).
  - Backend full suite: `BACKEND_FULL_SUITE_NOT_COMPLETED — FIRESTORE_EMULATOR_DEPENDENCY` (pre-existing emulator dependency in Zernio suites unrelated to M13).
  - Mobile M13 focused Flutter tests: 39/39 PASS.
  - Mobile full Flutter tests: 522/522 PASS.
  - Flutter analyze: PASS (0 issues found).
  - Web unit tests: 400/400 PASS.
  - Web build: PASS (`'npm --prefix web run build`).
  - Git diff clean.

---

## 3. Physical Acceptance on Lenovo Tab P11 Plus (Android 12 / TB-J616F / HND29KG9)

- **Device**: Lenovo Tab P11 Plus / TB-J616F (Android 12, API 31, ADB `HND29KG9`)
- **Backend**: Local Express API active (`http://127.0.0.1:3000/api/health` -> ok) with ADB reverse port forwarding `tcp:3000 tcp:3000`.
- **Verdict**: `M13_PHYSICAL_ACCEPTANCE_PASS`

### Canonical Mandatory Matrix

| Mandatory Check | Final Classification | Evidence / Notes |
| :--- | :--- | :--- |
| `FIRST_TO_LAST_REORDER` | **PASS_PHYSICAL** | Arraste de pos 1 para final em `LiturgyFormScreen`. Reordenação correta, sem RangeError, posições recalculadas 0..N-1. |
| `SONG_TO_NON_SONG_CLEARING` | **PASS_PHYSICAL** | Alternância no segmented button de Música para Leitura/Outro limpa o seletor e anula `songId` e `song` imediatamente. |
| `DETAIL_TENANT_AUTO_DISMISS` | **AUTOMATED_ONLY** | Sem alternador concorrente de ministério em tela cheia na UI física; coberto por testes automatizados em `liturgy_detail_screen_test.dart`. |
| `FORM_TENANT_AUTO_DISMISS` | **AUTOMATED_ONLY** | Sem alternador concorrente em formulário na UI física; coberto por testes automatizados em `liturgy_form_screen_test.dart`. |
| `SONG_PICKER_TENANT_AUTO_DISMISS` | **AUTOMATED_ONLY** | Modal bottom sheet bloqueia shell na UI física; coberto por testes automatizados de widget. |
| `MEMBER_READ_ONLY` | **NOT_EXECUTED — SAFE TEST ACCOUNT UNAVAILABLE** | Usuário de teste disponível possui role admin em todos os ministérios. Coberto por testes automatizados em `liturgies_screen_test.dart` e `liturgy_detail_screen_test.dart`. |
| `LINKED_SONG_NAVIGATION` | **PASS_PHYSICAL** | Toque no item de múlsica vinculada (`Ao Teu rosto vir`) em `LiturgyDetailScreen` obriu o `SongDetailScreen` nativo existente do repertório; ministério ativo preservado (`Louvor IBBP`); botão Voltar retornou com perfeição à liturgia. |
| `PORTRAIT` | **PASS_PHYSICAL** | Rotação para retrato (`1200x2000`) testada físicamente. Zero overflow horizontal ou exceções `RenderFlex`. |
| `LANDSCAPE` | **PASS_PHYSICAL** | Rotação para paisagem (`2000x1200`) testada físicamente. Zero overflow, layout responsivo. |
| `LONG_CONTENT_UX` | **PASS_PHYSICAL** | Título longo de liturgia, título longo de item e observações longas testados físicamente. Texto quebra adequadamente, rolagem vertical funcional, botões acessíveis e zero overflow no Logcat. |

### Canonical Test ID Mapping & Execution Status

- `CT-M13-01` (Navegação & Entrada): `PASS_PHYSICAL`
- `CT-M13-02` (Empty State): `PASS_PHYSICAL`
- `CT-M13-03` (Detalhes da Liturgia): `PASS_PHYSICAL`
- `CT-M13-04` (Itens Não-Musicais): `PASS_PHYSICAL`
- `CT-M13-05` (Itens Musicais): `PASS_PHYSICAL`
- `CT-M13-06` (Member Read-Only): `NOT_EXECUTED — SAFE TEST ACCOUNT UNAVAILABLE` (coberto por testes automatizados)
- `CT-M13-07` (Criação de Liturgia): `PASS_PHYSICAL`
- `CT-M13-08` (Itens Mistos): `PASS_PHYSICAL`
- `CT-M13-09` (Modal Seletor de Múlsicas): `PASS_PHYSICAL`
- `CT-M13-10` (Reorder 1st -> Last): `PASS_PHYSICAL`
- `CT-M13-11` (Reorder Last -> 1st): `PASS_PHYSICAL`
- `CT-M13-12` (Reorder Middle Downward): `PASS_PHYSICAL`
- `CT-M13-13` (Edição de Metadados): `PASS_PHYSICAL`
- `CT-M13-14` (Edição/Remoção de Itens): `PASS_PHYSICAL`
- `CT-M13-15` (Limpeza Song -> Non-Song): `PASS_PHYSICAL`
- `CT-M13-16` (Exclusão Canônica): `PASS_PHYSICAL`
- `CT-M13-17` (Isolamento Cross-Tenant): `PASS_PHYSICAL`
- `CT-M13-18..21` (Tenant Auto-Dismissal): `AUTOMATED_ONLY`
- `CT-M13-22` (In-flight Mutation Race Fencing): `AUTOMATED_COVERAGE_ONLY — MANUAL RACE NOT REPRODUCIBLE`
- `CT-M13-23` (User A -> User B Session Reset): `NOT_EXECUTED — SAFE SECOND ACCOUNT UNAvAILABLE` (coberto por testes de provider)
- `CT-M13-24` (Removed-Member Access): `NOT_EXECUTED — SAFE TEST USER UNAVAILABLE` (coberto por testes backend de active membership)
- `CT-M13-25` (Cross-Tenant Song Observation): `PASS_PHYSICAL` (observação no picker de músicas restrita ao ministério ativo); ataques com campos corrompidos cobertos por `AUTOMATED_SECURITY_COVERAGE`.
- `CT-M13-26` (Seleção de Data Nativa): `PASS_PHYSICAL`
- `CT-M13-27` (Persistência da Data): `PASS_PHYSICAL`
- `CT-M13-28` (Tablet Orientation Landscape / Portrait): `PASS_PHYSICAL`
- `CT-M13-29` (Touch Target Accessibility): `PASS_PHYSICAL`
- `CT-M13-30` (Long Content UXLi: `PASS_PHYSICAL`
- `CT-M13-31` (Back Navigation Stack): `PASS_PHYSICAL`

---

## 4. Canonical Security Invariants & Validation Rules

1. **Tenant Ownership**:
   - `ministry_id` é autoritativo quando presente.
   - O legado `group_id` é aceito apenas quando `ministry_id`  estiver ausente.
   - Caso ambos existam e divirjam, a resolução de acesso e referência falha fechada.
2. **Anti-IDOR**:
   - Leituras, edições e exclusões cross-tenant falham fechadas com HTTP 404.
3. **Song Reference Tenant Isolation**:
   - Referências de `songId` pertencentes a outros ministérios sÃo estritamente rejeitadas no backend.
   - Identificadores contraditórios não enriquecem dados de músicas de outro ministério.
4. **Active Membership**:
   - Integrantes removidos (`status: 'removed'`) não conseguem acessar liturgias por sess�Y\�]][�X�Y\�[�Y�\�
�RS�T��W�P��T���S�QQ
K��K�
����Pʊ���HY[X��Έ��Y[�HZ]\�K��HYZ[��ܚXp�����Yp�����H^�\���˂�H�X��[�0�HH��۝Z\�H]]ܚ]]]�HH]]ܚ^�p����˂���
��]�ZX�YYH�[��X�[ۘ[
����HܚXp�����]X[^�p�����H^�\����][^�[H�]�ܚ]\���\�\�ܙH\�H�\�[�\�[�YܚYYH]0�ZX�H[��H��X�p��[�H]\��XHH������]\�][��\����XY�˂�ˈ
���Yܘ\�H�[Yp����ʊ���H�ۙ�Y�X�Z]H\[�\��ܛX]��[���X��HQH��[Y[���\�\�ܙK�Z�Z][���\�X�\�\�H�\��H�H�]�\��[��H]X�\��][Y[�H���ܛX]�ܙY�ܚX[��VVVKSSKQ��H�ۋ\�ۙ�][\��\HOH	��ۙ��O��ۙ��YH�[���˝ܚ]Q�[T�[��	�����^X�\[�����\]Y̌��LLLK[[ؚ[K[LL�[�]]�K[]\��Y\˛Y	��۝[�
N�
# M20 — Smart Chords Import Hub (Phase 1 / Phase 2 continuation)

## Phase 2.3 — Android acceptance corrections (2026-10-27)

- Starting local/remote head `b92a27ca31791a925282607f35be5c168a2d3813`; PR #21 remains Draft/open. Existing unrelated documentation changes preserved. Local commit only; controlled push requires separate authorization.
- Share: retry pending payload after Navigator/auth/ministry readiness; independent notification initialization; request-ID deduplication; CharSequence EXTRA_TEXT and bounded HTML fallback; narrow text/plain, text/html, text/uri-list, PDF and image filters. Integrated app-router regression reaches import review from pre-login/pre-Navigator cold text. Google Keep/Redmi actual sender formats still require device retest.
- Ministry: validated backend memberships restore the last choice by authenticated UID; single ministry auto-selects; inaccessible selections fall back safely. Logout/account switch clears the bound preference, and generation guards reject stale bootstrap/reset/selection completions. Legacy unowned global preference is not trusted as another account's selection; a one-time selection may be needed after upgrade.
- URL/image assistants now prepare manual drafts locally in Flutter without HTTP, scraping, OCR or writes. URL host/protocol/credentials/port/slug validation and PNG/JPEG/WebP signature/5 MiB bounds retained. Normalization, personal saving and optional repertoire linkage retain existing remote authorization/confirmation. HTTP errors (including non-JSON HTML) preserve status instead of becoming generic connection errors.
- Preview diagnosis: previous APK CI build log confirms flavor production, APP_ENV=staging and WIP URL `https://praise-app-git-wip-repertoire-1978b6-henriquecesarths-projects.vercel.app/api/v1`. On this date health returned 200 JSON; unauthenticated POST to URL/image paths returned 401 JSON without redirect. These auth-gated probes do not establish endpoint presence or authenticated compatibility; the precise original device network failure is **Unknown / Not yet verified**. No URL/protection/backend project configuration changed.
- Normalizer: chords snap only to word boundaries; collisions/out-of-range positions retain a separate transposable chord row with CHORD_ALIGNMENT_UNCERTAIN. U+200B is not assumed to mark a musical syllable; lyrics and chord order are preserved. Exact five supplied cases plus invisible-character variants, slash/parenthesized chords, Tom: Bb, sections, mixed normalized/raw blocks and second-pass idempotency covered. Saved inline text remains compatible.
- Validation: backend 112 focused tests PASS, then final normalizer/PDF delta 92 tests PASS (mixed-block and spaced-inline lyric regressions); backend TypeScript build PASS. Web import/API regressions 82 PASS. Flutter 96 integration/session/parser tests and 33 assistant/repository/HTTP/controller tests PASS; final ministry delta 17 PASS. Full flutter analyze PASS, no issues. Separate read-only reviewer `/root/p23_review`: no actionable P1/P2; delta review found and corrected a P2 reclassifying spaced inline lyric words as chords; exact regression added and revalidated. Native workers `/root/share_fix`, `/root/ministry_fix` used configured Luna/low roles; reused `/root/ocr_investigation` effective model is **Unknown / Not yet verified**.
- Final Android assemblePreviewDebug PASS (offline, process-only JDK17, 2m20s). APK `mobile/build/app/outputs/apk/preview/debug/app-preview-debug.apk`, 187098618 bytes; SHA256 `500c14d50eed13941b921222c7d5b20a6c5ba2898f63cb3c3405d26d13a801b6`. Flavor preview (com.louvaio.app.preview), APP_ENV=staging, same explicit WIP API URL. aapt verified all five SEND MIME filters in the packaged manifest. Local APK is not committed; build is not physical acceptance, and remote WIP does not yet contain this local normalizer correction.
- Pending: separately authorize controlled push/preview of these fixes, then repeat Keep/Redmi cold/warm text, digital PDF, cancel, invalid/oversize/duplicate payloads, slow auth/ministry, logout/account switching, URL/image manual review, exact chord examples and explicit personal save on Android. Physical acceptance and E2E pending; automatic OCR deferred. No merge, deployment or live database writes.

## Phase 2.2 — Remote CI and Android acceptance preparation

- PR #21 remains Draft/open; remote feature head and workflow-dispatch run both use `b92a27ca31791a925282607f35be5c168a2d3813`. WIP base remains `9f4f0bbe77679253f04e0c8ebfbad3066555c916`.
- `mobile-ci.yml` run [40489249701](https://github.com/henriquecesarth/praise-app/actions/runs/40489249701) completed successfully for `feat/m20-phase-2a-android-share` at the above SHA: analyze, 1038 full-suite Flutter tests, Android build and artifact upload PASS. Artifact louvaio-mobile-debug-apk (ID 12728311345, ZIP 82977214 bytes). This is the pre-correction APK; build success is not physical acceptance.
- Workflow build inputs: flavor `production`, `APP_ENV=staging`, API base URL is the WIP Vercel deployment URL defined in the workflow (may be stale/protected). No credentials included.
- Physical device checklist is ready: closed/open app text share; digital PDF; cancel import; invalid/oversize file; duplicate share; logout/account switch during import; preview and explicitly confirm save. Physical acceptance remains pending.

## Phase 2.1 — Codex V3 and controlled publication

- Preserved validated M20 checkpoint: `a494692402ecd17b85436aaf40c0e31b1d7e2ba6`. No product changes, repeated product tests/reviews, E2E or physical acceptance in this step.
- Codex Efficiency V3 is consolidated in a separate configuration/documentation-only commit: scoped memory reads, compact instructions, six native roles and previously CLI-validated Sol/medium, Luna/low and Sol/high routing. Existing safety, RBAC, tenancy, persistence and Git invariants remain in AGENTS.md and referenced roles.
- Normal branch push and Draft PR to `wip/repertoire-versions-smartchords-20261022` explicitly authorized for this step; remote WIP confirmed at `9f4f0bbe77679253f04e0c8ebfbad3066555c916` during preflight. Keep PR as draft; no merge, manual deployment or live database writes. PR/check/automatic-preview observations belong to the PR and delivery report; they do not constitute Android acceptance.

## Phase 2 continuation — 2026-10-26 (Codex native multiagent)

- Preserved starting branch `feat/m20-phase-2a-android-share`, HEAD `c80b30694ef18ff9434758937b8d0ff32be16ed2`, descending from WIP integration `9f4f0bbe77679253f04e0c8ebfbad3066555c916`. Initial tree: 24 modified files and four untracked URL/image extractor files. Existing Share Intent commit and local implementation remain the starting point; authorship of local changes is Unknown / Not yet verified.
- Native read-only investigations completed concurrently: `/root/android_investigation`, `/root/url_clipboard_investigation`, `/root/ocr_investigation` (spawn model requested: `gpt-6-luna`; resolved model not exposed by tool response). No external orchestration framework/worktree added.
- Frozen contract: authenticated draft-only `/import/url` and `/import/image`, additive `source_type`, `requires_manual_paste`, `source_url`. No extraction writes to Firestore. Save and optional M19 linking remain explicit actions.
- Decision: Cifra Club URL metadata assistant uses strict supported hosts and local URL parsing, with guided paste through the existing text normalizer. Remove arbitrary server-side fetching from the local draft to eliminate SSRF and unbounded remote reads. No scraping introduced.
- Decision: image import remains a bounded PNG/JPEG/WebP manual transcription assistant (5 MiB); OCR is deferred. Embedded PNG metadata is not optical recognition. PDF bounds remain 3 MiB / 10 pages; text 100,000 characters. UI must state these limits accurately.
- Exclusive writers: URL investigation worker owns backend Smart Chords; Android investigation worker owns mobile; root owns Web/config/docs. Workers run concurrently after contract freeze; final separate-context Sol reviewer is read-only.
- [x] Preserve and inspect existing implementation; complete three native investigations.
- [x] Configure six existing native roles (Sol coordinator/reviewers, Luna bounded engineers). Runtime tool metadata reloaded the six roles with the configured model and reasoning values; existing root session model is not exposed by that metadata.
- [x] Complete backend safety/contracts and route regression tests: 7 files / 160 tests PASS (15s per-test/hook timeout), covering feature privacy, M19 links, PDF, normalizer, URL, image and HTTP routes; backend build PASS.
- [x] Complete Flutter shared URL/manual normalization/session fencing and targeted tests: final focused suite 59 tests PASS, exit 0 (~28s, 30s per-test timeout), including unauthenticated → authenticating → authenticated, stale A → B completion, fresh post-logout share with residual ministry, clipboard editing and pending-save continuity. `flutter analyze` PASS, exit 0, "No issues found!" (14.7s), after correcting ten info-level items in affected files and rerunning the focused suite.
- [x] Complete Web guided paste/session fencing and targeted validation: final 82 tests PASS (modal 41, HTTP client 41; 10s per-test/hook timeout, 6.21s overall); Web build PASS after review fixes (Vite 7.76s plus TypeScript/PWA), with bundle-size/mixed-import warnings.
- [x] Independent review, remediate relevant findings, revalidate and record outcomes. Final reviewer verdict PASS, zero open P1/P2; all relevant targeted tests/builds/static analysis and final diff check PASS. No E2E or physical homologation performed.
- Physical Android cold/warm share acceptance and OCR: Unknown / Not yet verified. This overall plan remains active until outstanding acceptance is resolved.
- Validation environment: sandbox blocked esbuild subprocesses with `EPERM`; Web and backend tests/builds were rerun with the tool's explicit escalation mechanism. Flutter SDK/cache also required escalation; initial widget compilation errors and test harness failures were corrected before the final passing suite. No dependency updates, external site requests, production writes, new commits, push, PR, merge or deployment.
- Separate-context review completed: `/root/m20_independent_review`, native `feature-reviewer` role with `gpt-6.1-sol` / `high` exposed in the role metadata. Final verdict PASS, no open P1/P2 after targeted rechecks and all final execution evidence. Reviewer made zero edits. Resolved inference model itself is not separately exposed.
- Review remediation completed: Web save-generation invalidation and keyboard image selection; mobile pending share preservation across authenticating and post-logout login, manual-normalization enforcement, reviewed metadata retention, clipboard edit races, pending-save continuity and session fencing around asynchronous share decoding. Android UI-thread file I/O escalated to `/root/android_io_remediation` (explicit Sol/high spawn), with exclusive ownership of `mobile/android/**` transferred from the Dart worker. All relevant findings corrected, revalidated and accepted in independent delta review.
- Android remediation contract: native `onShareStarted { requestId }` precedes warm-share I/O; the result carries the same request ID. Kotlin uses one bounded I/O worker, queue of eight, a 15-second deadline and cancellation/cleanup outside the UI thread. Cold/warm results retain arrival order. Independent delta inspection accepted the I/O correction; real slow-provider/pipe acceptance remains Unknown / Not yet verified.
- Native validation PASS: `:app:compilePreviewDebugKotlin --offline --no-daemon` included Flutter compilation (2m20s / 87 tasks), followed by final Kotlin compile with Flutter task excluded (1m32s / 86 tasks), both exit 0. Process-only JDK17 override used because the preconfigured JAVA_HOME path was invalid. No build/environment configuration was persisted. Providers that ignore cancellation may occupy the one I/O worker until they return; UI and queue remain bounded, but this behavior needs physical acceptance.

### Files and ownership for this continuation

- Configuration/documentation: `.codex/config.toml`, six existing `.codex/agents/*.toml`, `AGENTS.md`, panel/context/workflow and this existing plan. Canonical roles and Obsidian structure preserved.
- Backend: Smart Chords controller/routes/import types; existing local URL/image extractors and their tests completed; added `backend/src/features/smart_chords/smart_chord_import.routes.test.ts` for HTTP authentication, limits and draft-only behavior. No repository/Firestore schema change.
- Web: `web/src/api.ts`, `types.ts`, `api.test.ts`, `components/SmartChordImportModal.tsx` and its test. Session/normalization/save regression coverage extended.
- Mobile: existing Smart Chords repository, payload/draft models, import screen/controller, Share Intent service/router and co-located tests; app providers/router session reset; existing preview/fake repository compatibility changes retained. Android Manifest and two existing Kotlin files complete the native flow. No new orchestration framework or dependency introduced.

### Handoff and remaining acceptance

- All five native agent threads completed: the three Luna-requested investigations (Android and URL threads reused as Dart/backend workers), Sol-requested Android I/O escalation, and separate configured Sol reviewer. Actual spawn IDs are recorded above. Parallel phases: three read-only investigations; then two independent implementation workers with root integrating Web; then Dart and Kotlin workers with read-only review. The runtime enforced four total active slots, so no external supervisor/worktree was needed.
- Main session: Codex; resolved root model, per-agent resolved inference identity, tokens and monetary usage are **Unknown / Not yet verified**. Root preference for subsequent sessions is `gpt-6.1-sol`; do not infer that editing configuration changed this running session. Observable bottlenecks were sandbox subprocess/SDK permissions, JDK path and review-driven session regressions.
- Session closure: local M20-only checkpoint authorized on `feat/m20-phase-2a-android-share`, based on preserved HEAD `c80b30694ef18ff9434758937b8d0ff32be16ed2`. Include validated M20 code/tests, this plan and the M20 context update; leave agent/configuration optimization and unrelated/no-content-diff documents outside the commit, preserving them locally. Validated product diff is unchanged; no tests or reviews repeated for checkpoint creation. No push, PR, merge, deployment, production writes or new dependencies.
- Final Git integrity: `git diff --check` exit 0; WIP base ancestry exit 0; no deleted files or staged changes. Ten unrelated documents under architecture/decisions/operations plus system-status appear modified in `git status` but have empty `git diff` and `--numstat`; they were left untouched. Cause is Unknown / Not yet verified; do not revert or include them as substantive M20 changes.
- Local implementation/validation for this continuation is complete. Overall M20 plan stays active for physical cold/warm Android acceptance, native slow-provider/deadline/cancellation checks and any separately scoped OCR work. E2E, physical device behavior and production integration remain **Unknown / Not yet verified**.

## Status
R4_M9_REVISED = PASS — canonical normalization and actual inline rendering validated locally and in Flutter CI. R4-M7 protections preserved. Ready for M20 physical acceptance; no APK generated or Production deployment performed.

## Objective
Implement Phase 1 of M20: Smart Chords Import Hub across backend, Web, and Flutter mobile, enabling musicians to import digital text-based PDF chord sheets and plain-text (chords-over-lyrics or bracketed) chord sheets into their personal Smart Chords library with interactive preview, manual correction, and optional M19 Repertoire linking.

## Mandatory Invariants
- Personal SmartChord ownership (user_id = req.user.id); strictly private and portable across ministries.
- No automatic repertoire creation (AUTO_LINK_BY_TITLE = NO, IMPORTED_SMART_CHORD_SHARED = NO).
- Preview before persistence (parsing/extraction writes nothing to the database).
- Transposition safety: non-chord annotations (e.g., Baixo, Corte, Dedilhado, Fim) must never be transposed as chords.
- Vercel serverless bounds: MAX_PDF_FILE_SIZE = 3 MiB, MAX_PDF_PAGES = 10, no persistent server storage of uploaded PDFs.

## Scope
### In Scope (Phase 1) — DELIVERED & REMEDIATED
1. Shared format & golden synthetic PDF/text fixtures.
2. Plain-text chords-over-lyrics normalizer and chord grammar parser (Web, Mobile, Backend).
3. Transposition safety fix for annotations in Web and Mobile (`isMusicalChord` whitelist verification).
4. Authenticated backend endpoints `POST /api/v1/smart-chords/import/pdf` (Multer + safe coordinate-aware `unpdf`) and `POST /api/v1/smart-chords/import/text` (Zod schema).
5. Web Import Hub UX (`SmartChordImportModal.tsx`, `SmartChordsWorkspace.tsx`, preview, edit, save, optional M19 link, generation token race safety).
6. Mobile Flutter Import Hub UX (`SmartChordImportScreen.dart`, `SmartChordImportController.dart`, providers, preview, edit, save, session fencing, post-save M19 linking dialog).
7. Partial success safety: if save succeeds and optional repertoire link fails, SmartChord remains saved.
8. Comprehensive test suites (Backend, Web, Flutter) and PDF layout diversity testing.

### Phase 2 / Future (updated 2026-10-26)
- Android Share Intent (`ACTION_SEND` for text, PDF and supported images): existing commit/local implementation continued; validation recorded in the continuation above.
- Cifra Club shared URL metadata assistant / guided clipboard assistant: local integration in progress, no remote scraping.
- Scanned PDF OCR / automatic photo recognition: deferred. Manual image transcription assistant is separate and does not perform OCR.

## Implementation Stages
- [x] Stage 1: Shared format specification, import draft types, and synthetic golden fixtures.
- [x] Stage 2: Plain-text normalizer, musical chord grammar, and transposition safety fix (Web, Mobile, Backend).
- [x] Stage 3: Backend PDF coordinate extraction service and POST /api/v1/smart-chords/import/pdf endpoint.
- [x] Stage 4: Web import UX (SmartChordsWorkspace integration, preview, editing, save, optional link).
- [x] Stage 5: Mobile Flutter import UX (screens, providers, preview, editing, save, session fencing).
- [x] Stage 6: Post-save optional M19 relationship and partial success safety across Web and Mobile.
- [x] Stage 7: Full regression testing across Backend, Web, and Mobile.
- [x] Stage 8: M20-P1-R1 Findings Remediation:
  - F-M20-01 (BLOCKER): Removed vulnerable `pdfjs-dist@3.11.174` (CVE-2024-4367, CVE-2026-16633) and replaced with secure, dependency-free `unpdf: ^1.9.1`. Zero high/critical vulnerabilities.
  - F-M20-02 (MEDIUM): Added generation token fencing (`generationRef.current`) to `SmartChordImportModal.tsx`, explicit Cancel extraction button, and 4 automated race tests for Scenarios A, B, C, D in `SmartChordImportModal.test.tsx`.
  - F-M20-03 (TEST_GAP): Replaced hardcoded vertical split with dynamic vertical gutter detection (`detectColumnBuckets`) supporting symmetric, asymmetric, and 3+ column layouts. Expanded `smart_chord_pdf_extractor.test.ts` to 11 layout diversity tests.
- [x] Stage 9: M20-P1 Real PDF Fidelity Remediation (`Certeza.pdf`):
  - REALPDF_01_METADATA: Safer evidence-based title/artist splitting recognizing spaced dashes (` – `, ` — `, ` - `) and treating parenthesized instructions (e.g., `(todos)`) as musical arrangement content rather than artist names.
  - REALPDF_02_INLINE_ANNOTATIONS: Non-chord tokens and annotations (`(marca/corte)`, `(cresce marcando)`, `(cresc/corte)`) on chord lines are preserved during projection onto lyrics.
  - REALPDF_03_REPEAT_STRUCTURE: Repeat progression lines containing `||:`, `:||`, `%`, or multiple `|` separated from following vocalises (`Uh uh uh...`), preserving repeat delimiters, barlines, and simile markers intact. Emits `REPEAT_STRUCTURE_AMBIGUOUS` warning.
  - REALPDF_04_CHORD_ALIGNMENT: Replaced blind Euclidean nearest character slicing with word-boundary snapping (`words[wIdx].startIdx`) when chord is within the first 45% of word width, preventing mid-word slices (`s[A7M/9]ei`, `tudo p[D9]odes`). Emits `CHORD_ALIGNMENT_UNCERTAIN` warning when chord lands on later syllables.
  - Added synthetic regression tests 12-17 in `smart_chord_pdf_extractor.test.ts`.
- [x] Stage 10: M20-P1-R3 Targeted Findings Remediation (`M20-R3-01` through `M20-R3-06`):
  - M20-R3-01: Metadata False Positives — replaced greedy regex with strict spaced dash delimiters (` – `, ` — `, ` - `) and explicit prefixes (`Artista:`, `Artist:`, `Banda:`, `Por:`, `By:`, `Intérprete:`, `Compositor:`). Emits `METADATA_AMBIGUOUS` on ambiguous headers (multiple dashes or version subtitles). Plain words `por` and `by` in titles (e.g. `Salvo por Amor`, `Stand by Me`) are preserved without splitting.
  - M20-R3-02 / M20-R3-03: Annotation Token Order Preservation & Multi-Token Annotations — replaced end-of-line dumping with position-aware relative horizontal ordering of chords, barlines (`|`), and parenthesized performance annotations. Adjacent parenthesized tokens are consolidated (`(cresce marcando)`). Single barlines are preserved.
  - M20-R3-04: Non-Chord Token Discard & Warning Emission — unrecognized chord-like tokens on chord lines emit `UNKNOWN_CHORD_TOKEN` warning with offending token, while preserving the token wrapped in brackets. Ordinary lyrics remain warning-free.
  - M20-R3-05: Single Barline Preservation in Chord-Over-Lyric Lines — measure barlines (`|`) occurring on chord-over-lyric lines are preserved inline without dropping.
  - M20-R3-06: Unlabeled First Lyric Line Preservation — eliminated speculative `lineIdx === 1` artist consumption. Unlabeled line 1 is only recognized as artist when preceded by title and supported by subsequent key metadata (`Tom:` / `Key:`); otherwise preserved in musical body.
  - Added synthetic regression tests 18–26 in `smart_chord_pdf_extractor.test.ts`.
- [x] Stage 11: M20-P1-R4 HIGH Findings Remediation (`M20-R4-01`, `M20-R4-02`):
  - M20-R4-01: First Lyric Swallowed as Artist — eliminated speculative `hasSubsequentKeyMeta` artist inference on visual line 1. Visual line 1 is only treated as an artist if explicitly labeled (`Artista:`, `Artist:`, `Banda:`, `Por:`, `By:`, `Intérprete:`, `Compositor:`) or separated by spaced dash on title line. Plain lyric lines on visual line 1 are preserved in the musical content with `artist_name = null`. Added synthetic tests 27–31 covering Cases A through E.
  - M20-R4-02: Multi-Word Annotations Diluting Chord Line Classification — updated tokenizers in `smart_chord_normalizer.ts` and `smart_chord_pdf_extractor.ts` to treat parenthesized expressions `\([^()]*\)` and bracketed expressions `\[[^[\]]*\]` as atomic tokens. Multi-word parenthesized performance annotations (e.g., `(cresce marcando)`, `(violão solo)`, `(marca/corte)`) are recognized as single annotation tokens, properly discounted from non-chord counts in `isChordLine`, and preserved intact during chord projection. Complex chords with parentheses (`Cm7(5-)`, `F#m7(b5)`) remain recognized as chords. Added 4 normalizer unit tests and synthetic tests 32–35.
- [x] Stage 12: M20-P1 Web Import Authentication Hotfix:
  - Discovered defect: `importSmartChordPdf` in `web/src/api.ts` line 1430 mistakenly read `localStorage.getItem('token')` instead of the canonical `praise_auth_token` key used across the rest of the application.
  - Remediation: introduced `getAuthHeaders()` in `web/src/api.ts` returning `Authorization: Bearer <praise_auth_token>` and `Accept: application/json` without forcing `Content-Type: application/json`, preserving browser-generated multipart boundary for `FormData`.
  - Added regression test suite in `web/src/api.test.ts` (canonical auth only, missing token 401 rejection, expired token rejection, text import auth).
  - Added UI negative test cases in `SmartChordImportModal.test.tsx` (Scenario E: 401 rejection handling, Scenario F: cross-session draft leakage protection).
  - Real browser reacceptance executed via Playwright with legitimate UI login (`musician_m20@louvaio.test`) and zero synthetic legacy token injection.

## Verification Evidence
- **Backend Build & Tests**:
  - `npm --prefix backend run build` — PASS (zero errors).
  - Normalizer: 15/15 tests pass (`smart_chord_normalizer.test.ts`).
  - PDF Extractor: 35/35 tests pass (`smart_chord_pdf_extractor.test.ts`).
  - Feature & Relinking: 63/63 tests pass (`smart_chord.feature.test.ts`, `smart_chord_repertoire_link.test.ts`).
  - All 113 smart chords feature tests pass (100% pass).
  - Security & Repertoire Regression: 23/23 tests pass (`RepertoireRepository.test.ts`, `idor-security.test.ts`).
  - Middleware & Anti-IDOR: 18/18 tests pass (`auth-security.test.ts`, `quota-enforcement.test.ts`).
  - Real PDF Validation (`Certeza.pdf`):
    - Title: `Certeza (Canção de Jó)` — PASS
    - Artist: `Héber Bragança` — PASS
    - Repeat blocks preserved: 4/4 (`||:`, `|`, `%`, `:||`) — PASS
    - Inline annotations preserved: 9 total (`(todos)`, `(riff viol)`, `(violão/pad)`, `(marca/corte)`, `(cresce marcando)`, `(gaita)`, `(cresc/corte)`, `(Violao/Perc marcando)`, `(volta crescendo todos)`) — PASS
    - Chord occurrences preserved: 108/108 (100%) — PASS
    - Expected warnings emitted: `REPEAT_STRUCTURE_AMBIGUOUS`, `CHORD_ALIGNMENT_UNCERTAIN` — PASS
    - Zero `UNKNOWN_CHORD_TOKEN` or `METADATA_AMBIGUOUS` on canonical PDF — PASS
- **Web Build & Tests**:
  - `npm --prefix web run build` — PASS (Vite production build succeeds).
  - Import modal & Workspace: `SmartChordImportModal.test.tsx` (13 tests, including Scenarios A-F), `SmartChordsWorkspace.test.tsx` (9 tests).
  - API Client Regression: `api.test.ts` (31 tests, including canonical auth & 401 negative cases).
  - Full Web Test Suite: 25 test files passed, 424 tests passed (100% pass, up from 418).
  - Real Browser Reacceptance: PASS (clean UI login, zero synthetic token injection, authenticated PDF extraction, safe cancel without writes, personal chord creation, transposition in workspace).
- **Mobile Analyzer & Tests**:
  - `flutter analyze` in `mobile/` — `No issues found! (0 errors, 0 warnings, 0 infos)`.
  - Transposition safety: `smart_chord_parser_transposition_safety_test.dart` (4 tests pass).
  - Import controller: `smart_chord_import_controller_test.dart` (7 tests pass).
  - Import screen widget: `smart_chord_import_screen_test.dart` (2 tests pass).
  - Full Smart Chords Mobile Suite: `flutter test test/features/smart_chords/` — 111 tests passed (100% pass).
  - Full Mobile Test Suite: `flutter test` — 773 tests passed (100% pass).
- **Repository Integrity**:
  - `git diff --check` — PASS (clean).


## R4-M7 — Blocking findings remediation (2026-10-25)

Scope: fix the four independent R4-M6 blockers without changing public API/Firestore contracts, PDF algorithms, M19 ownership, billing, WhatsApp, or Phase 2 scope.

- [x] Normalizer: preserve annotated/structural/unknown musical lines separately from lyrics, preserving tokens and spacing; warn about ambiguous alignment; add exact regression assertions.
- [x] Android lifecycle: auto-dispose import notifier, reset fresh entry and explicit discard, bind user/ministry context, discard stale save results rather than returning a created object to UI.
- [x] Android errors/disposal: input-stage errors, controlled PT-BR messages, checks after asynchronous picker/read/extract/save/dialog operations, route-exit fencing.
- [x] Web: fence extraction/save/link/skip with generation, mounted state, authoritative user/ministry and canonical credential; propagate current user from App through Workspace.
- [x] Add deferred-operation, identity-switch, retry, lifecycle and losslessness regression tests using mocks/fakes only.
- [x] Complete local targeted Backend/Web tests, builds and diff review.
- [ ] Execute Flutter analyzer and focused tests in supported controlled CI (local macOS 12 cannot run required SDK).
- [ ] Independent recheck and subsequent physical Android/PWA acceptance.

Remote-write semantics: invalidation suppresses local state/callbacks/navigation/link prompts. It does not cancel a create/link request already sent, roll back a saved chord, or retry an uncertain mutation.

Validation executed locally:
- Backend: `npm test -- src/features/smart_chords/smart_chord_normalizer.test.ts --testTimeout=10000` — 28/28 PASS.
- Web: `npm test -- src/components/SmartChordImportModal.test.tsx src/api.test.ts src/components/SmartChordsWorkspace.test.tsx --testTimeout=10000` — 94/94 PASS (24 modal, 39 API, 31 workspace).
- Backend `npm run build` — PASS (final run bounded to 120 seconds).
- Web `npm run build` — PASS; existing mixed-import/chunk-size warnings remain. Final `tsc --noEmit` — PASS (bounded to 120 seconds).
- `git diff --check` — PASS; final diff reviewed. No PDF algorithm or shared classifier changes, so PDF regression suite was not rerun in R4-M7. No full Backend suite executed.
- Flutter: tests expanded (12 controller cases, 14 widget cases), NOT EXECUTED locally. Required SDK cannot run on local macOS 12. Analyzer, widget runtime, platform file picker and physical Android/PWA behavior: Unknown / Not yet verified.

Controlled CI follow-up (not executed/authorized here), from `mobile/`:
```
flutter analyze
flutter test test/features/smart_chords/presentation/controllers/smart_chord_import_controller_test.dart test/features/smart_chords/presentation/views/smart_chord_import_screen_test.dart --timeout 30s
```
Widget tests use fake auth/ministry/repositories; PDF error presentation is injected at the notifier/repository boundary without opening the platform file picker. Actual picker behavior still requires device acceptance. CI must pass before declaring Android validation complete.

No known implementation blocker remains from R4-M6; Flutter verification remains outstanding. Ready for independent code recheck and separately authorized controlled CI. No commit, push, deployment or live Firebase writes performed. This ExecPlan remains active pending CI and acceptance.


## R4-M9 revised — Canonical progressions and inline rendering

User contract supersedes the R4-M8 expected output: individually bracketed chords separated by bars normalize to ONE block `[ G | D ]`. The R4-M8 regression is retained with this corrected expectation. Inline section labels/annotations remain on their authored line. Chord-over-lyrics stays unchanged.

- [x] Canonical parser, idempotence and regression matrix.
- [x] Web readers/previews/editor: inline no-wrap progression and token safety.
- [x] Mobile shared progression tokens/widget used by reader (both fonts), editor and import preview.
- [x] Targeted tests, builds, diff review, scoped WIP commit/push and remote Flutter CI.
- Remote synchronization: inspected two remote CI commits; their net tree equals the old local HEAD. Fast-forward completed with local changes preserved.

R4-M9 implementation notes:
- Backend validates entire musical lines (including mixed brackets), flattens only validated chord groups, and emits one canonical `[ ... ]` block. Inline labels and leading performance annotations are retained. Attached syllabic text is never flattened. Normalization is idempotent; existing unsupported-token warnings remain.
- Web preserves the existing editable token renderer and uses non-wrapping horizontally scrollable progression rows in Import Preview, Workspace (including print preview), and SongDetail. Performance instructions tokenize atomically, so their embedded note names do not transpose.
- Mobile adds `progressionTokens` plus the reusable `MusicalProgressionLine` widget. Reader modes use the global font and transposition; editor/import previews use the same row. Long progressions scroll horizontally. Existing chord-over-lyrics layouts remain in use for ordinary lyrical lines.
- Actual component/widget assertions cover rendered row text, styles, editing/transposition, font modes and narrow scroll geometry, beyond normalization-only assertions.

Local R4-M9 validation: 40 normalizer tests + 35 PDF regressions PASS; 180 focused Web tests PASS (utilities, Import Modal, Workspace, SongDetail, API). Backend and Web builds PASS; final Backend rebuild after the annotation-token safety adjustment tracked during checkpoint. `git diff --check` PASS. Flutter is intentionally not run on macOS 12. CI must verify analyzer and tests before a final PASS.


CI attempt 1: https://github.com/henriquecesarth/praise-app/actions/runs/40205141963 (commit 162de5867fe11f6d438d6d1b9fa306ddd276fe72). Analyzer reported one `curly_braces_in_flow_control_structures` info in the multiline save guard; tests were not executed. Added the required braces without changing behavior, analyzer configuration or assertions. Follow-up CI pending.

CI attempt 2: https://github.com/henriquecesarth/praise-app/actions/runs/40205343897 (814c8bc92071305bf0a8cd1a8f44d0e6e1257898). Analyzer PASS; 543 tests PASS, 1 FAIL. All new reader/editor/import/narrow-width widgets passed. The exact-output transposition assertion exposed `parse()` trimming canonical block padding in `transposeSmartChord`. Fixed by transforming original bracket spans instead of serializing the syllabic layout model; assertions are unchanged. Follow-up CI pending.


### R4-M9 final evidence

- Validated implementation commit: `0122d10c1cf6cbe4d9743c4f479eda41493af878` (preceded by `162de5867fe11f6d438d6d1b9fa306ddd276fe72` and analyzer fix `814c8bc92071305bf0a8cd1a8f44d0e6e1257898`).
- CI: https://github.com/henriquecesarth/praise-app/actions/runs/40205619142 — SUCCESS; Ubuntu / Flutter 3.47.7 / Dart 3.13.5.
- `flutter analyze`: No issues found.
- Existing focused workflow suite: 544/544 tests PASS. No test skip markers. Smart Chords import controller 12/12 and import screen 15/15 PASS, including all original R4-M7 cases plus the new import rendering case.
- Rendering assertions PASS: saved reader monospace and Arial; editor preview; Import Preview; horizontal scrolling at 120 logical pixels in both font modes; canonical/legacy token representation; exact spacing and annotation-safe transposition.
- Local final targeted Backend tests: 75/75 PASS (40 normalizer + 35 PDF). Local focused Web tests: 180/180 PASS. Backend/Web builds PASS. Diff integrity PASS. No live Firebase writes; repositories/auth are faked or mocked in automated scenarios.
- Git WIP synchronized by fast-forward, followed only by normal scoped commits/pushes; no force push, reset or clean. Final evidence documentation may follow the validated source commit; it does not alter runtime files or trigger the mobile path-filtered workflow.
- Git-triggered Preview deployments for the validated source: `praise-app` and `praise-app-m7tn` SUCCESS; separate Vercel project `backend` ERROR. All inspected deployment targets are Preview (`target: null`). No Production promotion or manual deployment was performed. The separate Preview failure was not remediated outside this scope.
- Remaining acceptance: physical Android/PWA interactions, native PDF picker and device font availability are Unknown / Not yet verified. No APK generated. This overall M20 ExecPlan remains active until physical acceptance is complete.

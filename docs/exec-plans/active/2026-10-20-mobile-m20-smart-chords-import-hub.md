# M20 — Smart Chords Import Hub (Phase 1)

## Status
R4_M9_REVISED = PARTIAL — canonical blocks and inline renderers implemented; local checks passing, remote Flutter CI pending. R4-M7 protections preserved; physical acceptance pending.

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

### Deferred to Phase 2 / Future
- Android Share Intent (`ACTION_SEND` for `text/plain` and `application/pdf`).
- Cifra Club shared URL metadata assistant / guided clipboard assistant.
- Scanned PDF OCR / photo import.

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
- [ ] Targeted tests, builds, diff review, scoped WIP commit/push and remote Flutter CI.
- Remote synchronization: inspected two remote CI commits; their net tree equals the old local HEAD. Fast-forward completed with local changes preserved.

R4-M9 implementation notes:
- Backend validates entire musical lines (including mixed brackets), flattens only validated chord groups, and emits one canonical `[ ... ]` block. Inline labels and leading performance annotations are retained. Attached syllabic text is never flattened. Normalization is idempotent; existing unsupported-token warnings remain.
- Web preserves the existing editable token renderer and uses non-wrapping horizontally scrollable progression rows in Import Preview, Workspace (including print preview), and SongDetail. Performance instructions tokenize atomically, so their embedded note names do not transpose.
- Mobile adds `progressionTokens` plus the reusable `MusicalProgressionLine` widget. Reader modes use the global font and transposition; editor/import previews use the same row. Long progressions scroll horizontally. Existing chord-over-lyrics layouts remain in use for ordinary lyrical lines.
- Actual component/widget assertions cover rendered row text, styles, editing/transposition, font modes and narrow scroll geometry, beyond normalization-only assertions.

Local R4-M9 validation: 40 normalizer tests + 35 PDF regressions PASS; 180 focused Web tests PASS (utilities, Import Modal, Workspace, SongDetail, API). Backend and Web builds PASS; final Backend rebuild after the annotation-token safety adjustment tracked during checkpoint. `git diff --check` PASS. Flutter is intentionally not run on macOS 12. CI must verify analyzer and tests before a final PASS.


CI attempt 1: https://github.com/henriquecesarth/praise-app/actions/runs/40205141963 (commit 162de5867fe11f6d438d6d1b9fa306ddd276fe72). Analyzer reported one `curly_braces_in_flow_control_structures` info in the multiline save guard; tests were not executed. Added the required braces without changing behavior, analyzer configuration or assertions. Follow-up CI pending.

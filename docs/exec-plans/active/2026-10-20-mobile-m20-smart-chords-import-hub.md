# M20 — Smart Chords Import Hub (Phase 1)

## Status
PHASE_1_REMEDIATED_REAL_PDF_VERIFIED

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

## Verification Evidence
- **Backend Build & Tests**:
  - `npm --prefix backend run build` — PASS (zero errors).
  - Normalizer & PDF Extractor: 28/28 tests pass (`smart_chord_normalizer.test.ts`, `smart_chord_pdf_extractor.test.ts`).
  - Feature & Relinking: 63/63 tests pass (`smart_chord.feature.test.ts`, `smart_chord_repertoire_link.test.ts`).
  - All 91 smart chords feature tests pass (100% pass).
  - Security & Repertoire Regression: 23/23 tests pass (`RepertoireRepository.test.ts`, `idor-security.test.ts`).
  - Real PDF Validation (`Certeza.pdf`):
    - Title: `Certeza (Canção de Jó)` — PASS
    - Artist: `Héber Bragança` — PASS
    - Key: `A` — PASS
    - Repeat blocks preserved: 4/4 (`||:`, `|`, `%`, `:||`) — PASS
    - Inline annotations preserved: 7/7 (`(todos)`, `(violão/pad)`, `(marca/corte)`, `(cresce marcando)`, `(cresc/corte)`, `(riff viol)`, `(gaita)`) — PASS
    - Chord occurrences preserved: 108/108 (100%) — PASS
- **Web Build & Tests**:
  - `npm --prefix web run build` — PASS (Vite production build succeeds).
  - Import modal & Workspace: `SmartChordImportModal.test.tsx` (11 tests, including Scenarios A-D), `SmartChordsWorkspace.test.tsx` (9 tests).
  - Full Web Test Suite: 25 test files passed, 418 tests passed (100% pass).
- **Mobile Analyzer & Tests**:
  - `flutter analyze` in `mobile/` — `No issues found! (0 errors, 0 warnings, 0 infos)`.
  - Transposition safety: `smart_chord_parser_transposition_safety_test.dart` (4 tests pass).
  - Import controller: `smart_chord_import_controller_test.dart` (7 tests pass).
  - Import screen widget: `smart_chord_import_screen_test.dart` (2 tests pass).
  - Full Smart Chords Mobile Suite: `flutter test test/features/smart_chords/` — 111 tests passed (100% pass).
- **Repository Integrity**:
  - `git diff --check` — PASS (clean).


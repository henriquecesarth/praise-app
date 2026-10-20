# M20 — Smart Chords Import Hub (Phase 1)

## Status
PHASE 1 COMPLETE — VERIFIED (Phase 2 Deferred)

## Objective
Implement Phase 1 of M20: Smart Chords Import Hub across backend, Web, and Flutter mobile, enabling musicians to import digital text-based PDF chord sheets and plain-text (chords-over-lyrics or bracketed) chord sheets into their personal Smart Chords library with interactive preview, manual correction, and optional M19 Repertoire linking.

## Mandatory Invariants
- Personal SmartChord ownership (user_id = req.user.id); strictly private and portable across ministries.
- No automatic repertoire creation (AUTO_LINK_BY_TITLE = NO, IMPORTED_SMART_CHORD_SHARED = NO).
- Preview before persistence (parsing/extraction writes nothing to the database).
- Transposition safety: non-chord annotations (e.g., Baixo, Corte, Dedilhado, Fim) must never be transposed as chords.
- Vercel serverless bounds: MAX_PDF_FILE_SIZE = 3 MiB, MAX_PDF_PAGES = 10, no persistent server storage of uploaded PDFs.

## Scope
### In Scope (Phase 1) — DELIVERED
1. Shared format & golden synthetic PDF/text fixtures.
2. Plain-text chords-over-lyrics normalizer and chord grammar parser (Web, Mobile, Backend).
3. Transposition safety fix for annotations in Web and Mobile (`isMusicalChord` whitelist verification).
4. Authenticated backend endpoints `POST /api/v1/smart-chords/import/pdf` (Multer + coordinate-aware `pdfjs-dist`) and `POST /api/v1/smart-chords/import/text` (Zod schema).
5. Web Import Hub UX (`SmartChordImportModal.tsx`, `SmartChordsWorkspace.tsx`, preview, edit, save, optional M19 link).
6. Mobile Flutter Import Hub UX (`SmartChordImportScreen.dart`, `SmartChordImportController.dart`, providers, preview, edit, save, session fencing, post-save M19 linking dialog).
7. Partial success safety: if save succeeds and optional repertoire link fails, SmartChord remains saved.
8. Comprehensive test suites (Backend, Web, Flutter).

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

## Verification Evidence
- **Backend Build & Tests**:
  - `npm --prefix backend run build` — PASS (zero errors).
  - Normalizer & PDF Extractor: 18/18 tests pass (`smart_chord_normalizer.test.ts`, `smart_chord_pdf_extractor.test.ts`).
  - Feature & Relinking: 63/63 tests pass (`smart_chord.feature.test.ts`, `smart_chord_repertoire_link.test.ts`).
  - All 81 feature unit & integration tests pass.
- **Web Build & Tests**:
  - `npm --prefix web run build` — PASS (Vite production build succeeds).
  - Import modal & Workspace: `SmartChordImportModal.test.tsx` (7 tests), `SmartChordsWorkspace.test.tsx` (9 tests).
  - Full Web Test Suite: 25 test files passed, 414 tests passed (100% pass).
- **Mobile Analyzer & Tests**:
  - `flutter analyze` in `mobile/` — `No issues found! (0 errors, 0 warnings, 0 infos)`.
  - Transposition safety: `smart_chord_parser_transposition_safety_test.dart` (4 tests pass).
  - Import controller: `smart_chord_import_controller_test.dart` (7 tests pass).
  - Import screen widget: `smart_chord_import_screen_test.dart` (2 tests pass).
  - Full Smart Chords Mobile Suite: `flutter test test/features/smart_chords/` — 111 tests passed (100% pass).
- **Repository Integrity**:
  - `git diff --check` — PASS (no trailing whitespace or conflict markers).


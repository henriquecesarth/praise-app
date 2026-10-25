# R4-M10 — Android Smart Chords reader layout

Status: COMPLETE — code and CI validation passed; ready for separate physical Android retest.

Scope: Flutter reader presentation only. Preserve canonical progressions, persistence, authentication, personal ownership and import lifecycle. No Web/Backend source changes, manual deployments or APK generation.

- [x] Replace overflowing sticky toolbar with adaptive rows; preserve every action and SafeArea.
- [x] Measure chord/lyric fragments using the active font and text scale; group syllabic fragments by word, reserve width for both tiers, wrap proportional text at word boundaries and scroll oversized groups/monospace lines deliberately.
- [x] Widget geometry regressions at 320/360/393 logical pixels and 1.3 text scaling, plus -1/+2 transposition and R4-M9 progression regression.
- [x] Review diff; scoped WIP commit/push; existing remote Flutter analyzer and focused test suite.
- [x] Record evidence; Android physical retest remains separate. No local Flutter execution on macOS 12.

Contracts/collections: none changed. `SmartChordParser.parse`/`renderLine` inspected; reader layout will use the existing parsed associations without changing normalized/stored content. `MusicalProgressionLine` remains unchanged.

Implementation: reader uses a `LayoutBuilder` toolbar with a compact key/Original row and a second row for transposition/font icon controls below the wide-layout threshold, with body SafeArea. Existing pending-link label can wrap inside its row. A presentation-only `ChordLyricLine` measures active-font/text-scale extents, reserves a visual chord gap, keeps intra-word chord/lyric fragments together, and uses word wrapping or deliberate horizontal scrolling. Parser/persistence and `MusicalProgressionLine` are unchanged.

Local checks: `git diff --check` PASS. Flutter tests/analyzer are NOT run locally because the required SDK cannot run on macOS 12. Six real-reader toolbar geometry cases cover 320/360/393 at 1.0/1.3 text scale and safe insets; eight additional line-layout/progression widget cases cover both fonts, -1/+2, word associations, glyph separation, oversize-word scrolling and canonical labels. Existing assertions are retained. Remote execution pending.

CI attempt 1: https://github.com/henriquecesarth/praise-app/actions/runs/40209091918 (`4c71605da9a612ac71d76c982a11b099a433e350`). Analyzer PASS; 554 tests PASS / 4 FAIL. At 320 px the badge and Original/font row still exceeded their allocated widths. Narrow layout now places key/reset on row 1 and icon actions on row 2, with a vertical badge that can wrap text. Geometry assertions were updated to verify this grouping while retaining all control hit-testing, viewport containment, no-exception and transposition checks. The two monospace failures used glyph side bearings (0.125 px) for the anchor comparison; tests now compare the two tier layout anchors, retaining separate actual-glyph gap/containment assertions. Follow-up remote validation pending.

Remote synchronization: inspected two R4-M9 APK workflow commits (`59e80b9`, `e2e044e`) pushed concurrently; their net tree was unchanged. Rebased only the unpushed hotfix onto the remote tip and pushed normally. No force push/reset, and no APK workflow was triggered by this task.


## Final verification

- Validated runtime commit: `d11290cd28f8f89edab27448250d4335ab9e2b8b`.
- CI: https://github.com/henriquecesarth/praise-app/actions/runs/40209423099 — SUCCESS, Ubuntu / Flutter 3.47.7 / Dart 3.13.5.
- `flutter analyze`: No issues found (11.5 seconds).
- Existing focused suite: **558/558 PASS**, no test skip markers. All 14 new geometry scenarios passed: six toolbar cases (320/360/393 × 1.0/1.3), four long-chord association/gap cases (both fonts × -1/+2), one oversized-word horizontal-scroll case, and three canonical progression cases.
- Existing font-preference, transposition, reader isolation and Smart Chords import regressions passed without weakening existing assertions.
- `git diff --check` PASS. Flutter was never executed locally on macOS 12. No Web/Backend source, persistence, parser or progression-renderer changes; no live Firebase writes, manual deploys, Production changes or APK build.
- Source changes: `smart_chord_reader_screen.dart`, new `chord_lyric_line.dart`; test changes: reader screen tests and new chord/lyric widget tests. This execution plan is archived separately after code validation.
- Remaining verification: appearance with real Android fonts and user-provided imported content on device is **Unknown / Not yet verified** until physical retest. No known code/CI blocker remains.
